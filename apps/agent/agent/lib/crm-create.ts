import { db, type Prisma } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import type { CrmEventType } from "@crm/db/crm-events";
import { lockIdempotencyKey } from "@crm/db/idempotency";
import {
	type FieldBackfillPayload,
	fieldBackfillPayload,
} from "@crm/validation/field-backfill";
import { z } from "zod";
import { CRM_CREATE } from "./crm-create-config";
import { type DispatchRequest, requestDispatch } from "./dispatch-request";
import { linkedinProfileUrl, linkedinSlug } from "./linkedin";

const optionalText = z
	.string()
	.trim()
	.max(CRM_CREATE.maxTextLength)
	.optional()
	.transform((value) => (value ? value : null));

const domain = z
	.string()
	.trim()
	.toLowerCase()
	.transform((value, ctx) => {
		const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(value)
			? value
			: `https://${value}`;
		const host = URL.parse(withScheme)?.hostname.replace(/^www\./, "") ?? "";
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(host)) {
			ctx.addIssue({ code: "custom", message: `${value} is not a domain.` });
			return z.NEVER;
		}
		return host;
	});

const linkedinUrl = z
	.string()
	.trim()
	.transform((value, ctx) => {
		const slug = linkedinSlug(value);
		if (!slug) {
			ctx.addIssue({
				code: "custom",
				message: `${value} is not a linkedin.com/in/ profile URL.`,
			});
			return z.NEVER;
		}
		return linkedinProfileUrl(slug);
	});

export const crmAddition = z.object({
	person: z
		.object({
			firstName: z.string().trim().min(1).max(CRM_CREATE.maxTextLength),
			lastName: optionalText,
			title: optionalText,
			email: z
				.email()
				.transform((value) => value.trim().toLowerCase())
				.optional()
				.transform((value) => value ?? null),
			linkedinUrl: linkedinUrl.optional().transform((value) => value ?? null),
		})
		.optional(),
	company: z
		.object({
			name: z.string().trim().min(1).max(CRM_CREATE.maxTextLength),
			domain: domain.optional().transform((value) => value ?? null),
		})
		.optional(),
});

export type CrmAddition = z.infer<typeof crmAddition>;

export type AddedRecord = { id: string; name: string; created: boolean };

export type CrmAdditionResult = {
	company: AddedRecord | null;
	contact: AddedRecord | null;
};

type Tx = Prisma.TransactionClient;

type Subject =
	| { contactId: string; companyId?: undefined }
	| { companyId: string; contactId?: undefined };

type FollowUp = Subject & {
	kind: string;
	priority: number;
	budget: number;
	lock: string;
	payload?: FieldBackfillPayload;
};

type CrmEvent = {
	type: CrmEventType;
	record: { kind: "company" | "contact"; id: string };
	occurredAt: Date;
	data: Prisma.InputJsonValue;
};

const CONTACT_MATCH = {
	id: true,
	firstName: true,
	lastName: true,
	createdAt: true,
} as const;

function fullName(person: { firstName: string; lastName: string | null }) {
	return [person.firstName, person.lastName].filter(Boolean).join(" ");
}

function researchLock(kind: string, subject: Subject): string {
	return `agent-task:${kind}:${subject.contactId ?? ""}:${subject.companyId ?? ""}:`;
}

function research(
	kind: string,
	subject: Subject,
	priority: number,
	budget: number,
): FollowUp {
	return {
		...subject,
		kind,
		priority,
		budget,
		lock: researchLock(kind, subject),
	};
}

function fieldBackfill(
	entity: FieldBackfillPayload["entity"],
	subject: Subject,
	keys: string[],
): FollowUp[] {
	if (keys.length === 0) return [];

	return [
		{
			...subject,
			kind: "field-backfill",
			priority: PRIORITY.fieldBackfill,
			budget: CRM_CREATE.budget.fieldBackfill,
			lock: `agent-task:field-backfill:${entity}:${subject.contactId ?? subject.companyId}`,
			payload: fieldBackfillPayload.parse({ entity, keys }),
		},
	];
}

async function agentFilledKeys(
	tx: Tx,
	entity: FieldBackfillPayload["entity"],
): Promise<string[]> {
	const definitions = await tx.fieldDefinition.findMany({
		where: { entity, archivedAt: null, agentFilled: true },
		select: { key: true },
	});

	return definitions.map((definition) => definition.key);
}

async function findCompany(
	tx: Tx,
	company: NonNullable<CrmAddition["company"]>,
) {
	return tx.company.findFirst({
		where: {
			archivedAt: null,
			OR: [
				...(company.domain ? [{ domain: company.domain }] : []),
				{ name: { equals: company.name, mode: "insensitive" as const } },
			],
		},
		orderBy: { createdAt: "asc" },
		select: { id: true, name: true },
	});
}

async function contactByEmail(tx: Tx, email: string | null) {
	if (!email) return null;

	return tx.contact.findFirst({
		where: {
			archivedAt: null,
			email: { equals: email, mode: "insensitive" },
		},
		orderBy: { createdAt: "asc" },
		select: CONTACT_MATCH,
	});
}

async function contactByProfile(tx: Tx, profileUrl: string | null) {
	const slug = linkedinSlug(profileUrl);
	if (!slug) return null;

	const needles = [...new Set([slug, encodeURIComponent(slug)])];
	const candidates = await tx.contact.findMany({
		where: {
			archivedAt: null,
			OR: needles.map((needle) => ({
				linkedinUrl: {
					contains: `/in/${needle}`,
					mode: "insensitive" as const,
				},
			})),
		},
		orderBy: { createdAt: "asc" },
		take: CRM_CREATE.linkedinCandidates,
		select: { ...CONTACT_MATCH, linkedinUrl: true },
	});

	return (
		candidates.find(
			(candidate) => linkedinSlug(candidate.linkedinUrl) === slug,
		) ?? null
	);
}

async function findContact(tx: Tx, person: NonNullable<CrmAddition["person"]>) {
	const byEmail = await contactByEmail(tx, person.email);
	const byProfile = await contactByProfile(tx, person.linkedinUrl);
	if (!byEmail || !byProfile) return byEmail ?? byProfile;

	return byProfile.createdAt.getTime() < byEmail.createdAt.getTime()
		? byProfile
		: byEmail;
}

async function queueEvents(tx: Tx, events: CrmEvent[], dueAt: Date) {
	if (events.length === 0) return;

	await tx.agentTask.createMany({
		data: events.map((event) => ({
			contactId: event.record.kind === "contact" ? event.record.id : null,
			companyId: event.record.kind === "company" ? event.record.id : null,
			kind: "agent-event",
			reason: event.type,
			payload: {
				type: event.type,
				record: event.record,
				occurredAt: event.occurredAt.toISOString(),
				data: event.data,
			},
			priority: PRIORITY.event,
			budget: CRM_CREATE.budget.event,
			dueAt,
		})),
	});
}

async function queueFollowUp(tx: Tx, task: FollowUp, dueAt: Date) {
	await lockIdempotencyKey(tx, task.lock);

	const pending = await tx.agentTask.findFirst({
		where: {
			kind: task.kind,
			finishedAt: null,
			contactId: task.contactId,
			companyId: task.companyId,
		},
		select: { id: true },
	});
	if (pending) return;

	await tx.agentTask.create({
		data: {
			contactId: task.contactId ?? null,
			companyId: task.companyId ?? null,
			kind: task.kind,
			reason: CRM_CREATE.reason,
			priority: task.priority,
			budget: task.budget,
			payload: task.payload,
			dueAt,
		},
	});
}

function dispatchQueued(dispatch: DispatchRequest): void {
	try {
		dispatch();
	} catch (error) {
		console.warn(
			`[agent] The dispatch request failed. The next dispatch tick starts the queued work: ${
				error instanceof Error ? error.message : String(error)
			}`,
		);
	}
}

export async function addToCrm(
	addition: CrmAddition,
	ownerId: string,
	dispatch: DispatchRequest = requestDispatch,
): Promise<CrmAdditionResult> {
	if (!addition.person && !addition.company) {
		throw new Error("Name a person, a company, or both.");
	}

	const added = await db.$transaction(async (tx) => {
		const events: CrmEvent[] = [];
		const followUps: FollowUp[] = [];
		let company: AddedRecord | null = null;
		let contact: AddedRecord | null = null;

		if (addition.company) {
			const existing = await findCompany(tx, addition.company);
			if (existing) {
				company = { ...existing, created: false };
			} else {
				const created = await tx.company.create({
					data: {
						name: addition.company.name,
						domain: addition.company.domain,
						website: addition.company.domain
							? `https://${addition.company.domain}`
							: null,
						ownerId,
					},
					select: { id: true, name: true, domain: true, createdAt: true },
				});
				const subject = { companyId: created.id };
				company = { id: created.id, name: created.name, created: true };
				events.push({
					type: "company.created",
					record: { kind: "company", id: created.id },
					occurredAt: created.createdAt,
					data: { name: created.name, domain: created.domain },
				});
				followUps.push(
					research("brand", subject, PRIORITY.brand, CRM_CREATE.budget.brand),
					research(
						"company-profile",
						subject,
						PRIORITY.companyProfile,
						CRM_CREATE.budget.companyProfile,
					),
					...fieldBackfill(
						"COMPANY",
						subject,
						await agentFilledKeys(tx, "COMPANY"),
					),
				);
			}
		}

		if (addition.person) {
			const existing = await findContact(tx, addition.person);
			if (existing) {
				contact = { id: existing.id, name: fullName(existing), created: false };
			} else {
				const created = await tx.contact.create({
					data: {
						firstName: addition.person.firstName,
						lastName: addition.person.lastName,
						title: addition.person.title,
						email: addition.person.email,
						linkedinUrl: addition.person.linkedinUrl,
						companyId: company?.id ?? null,
						ownerId,
					},
					select: {
						id: true,
						firstName: true,
						lastName: true,
						email: true,
						companyId: true,
						createdAt: true,
					},
				});
				const subject = { contactId: created.id };
				contact = { id: created.id, name: fullName(created), created: true };
				events.push({
					type: "contact.created",
					record: { kind: "contact", id: created.id },
					occurredAt: created.createdAt,
					data: {
						firstName: created.firstName,
						lastName: created.lastName,
						email: created.email,
						companyId: created.companyId,
					},
				});
				followUps.push(
					research(
						"identify",
						subject,
						PRIORITY.identify,
						CRM_CREATE.budget.identify,
					),
					...fieldBackfill(
						"CONTACT",
						subject,
						await agentFilledKeys(tx, "CONTACT"),
					),
				);
			}
		}

		const dueAt = new Date();
		await queueEvents(tx, events, dueAt);
		for (const task of followUps) await queueFollowUp(tx, task, dueAt);

		return { company, contact, queued: events.length + followUps.length > 0 };
	});

	if (added.queued) dispatchQueued(dispatch);

	return { company: added.company, contact: added.contact };
}
