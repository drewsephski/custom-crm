import { db, type Prisma } from "@crm/db";
import { PRIORITY } from "@crm/db/agent-tasks";
import type { CrmEventType } from "@crm/db/crm-events";
import { z } from "zod";
import { CRM_CREATE } from "./crm-create-config";

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
		const slug = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(value)?.[1];
		if (!slug) {
			ctx.addIssue({
				code: "custom",
				message: `${value} is not a linkedin.com/in/ profile URL.`,
			});
			return z.NEVER;
		}
		return `https://www.linkedin.com/in/${slug.toLowerCase()}`;
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

type ResearchTask = Omit<Prisma.AgentTaskCreateManyInput, "dueAt">;

type CrmEvent = {
	type: CrmEventType;
	record: { kind: "company" | "contact"; id: string };
	occurredAt: Date;
	data: Prisma.InputJsonValue;
};

function fullName(person: { firstName: string; lastName: string | null }) {
	return [person.firstName, person.lastName].filter(Boolean).join(" ");
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

async function findContact(tx: Tx, person: NonNullable<CrmAddition["person"]>) {
	const matches = [
		...(person.email
			? [{ email: { equals: person.email, mode: "insensitive" as const } }]
			: []),
		...(person.linkedinUrl
			? [
					{
						linkedinUrl: {
							equals: person.linkedinUrl,
							mode: "insensitive" as const,
						},
					},
				]
			: []),
	];
	if (matches.length === 0) return null;
	return tx.contact.findFirst({
		where: { archivedAt: null, OR: matches },
		orderBy: { createdAt: "asc" },
		select: { id: true, firstName: true, lastName: true },
	});
}

async function queueFollowUps(
	tx: Tx,
	events: CrmEvent[],
	research: ResearchTask[],
) {
	const dueAt = new Date();
	await tx.agentTask.createMany({
		data: [
			...events.map((event) => ({
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
				budget: 1,
				dueAt,
			})),
			...research.map((task) => ({ ...task, dueAt })),
		],
	});
}

export async function addToCrm(
	addition: CrmAddition,
	ownerId: string,
): Promise<CrmAdditionResult> {
	if (!addition.person && !addition.company) {
		throw new Error("Name a person, a company, or both.");
	}

	return db.$transaction(async (tx) => {
		const events: CrmEvent[] = [];
		const research: ResearchTask[] = [];
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
						ownerId,
					},
					select: { id: true, name: true, domain: true, createdAt: true },
				});
				company = { id: created.id, name: created.name, created: true };
				events.push({
					type: "company.created",
					record: { kind: "company", id: created.id },
					occurredAt: created.createdAt,
					data: { name: created.name, domain: created.domain },
				});
				research.push(
					{
						companyId: created.id,
						kind: "brand",
						reason: CRM_CREATE.reason,
						priority: PRIORITY.brand,
						budget: 2,
					},
					{
						companyId: created.id,
						kind: "company-profile",
						reason: CRM_CREATE.reason,
						priority: PRIORITY.companyProfile,
						budget: 4,
					},
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
				research.push({
					contactId: created.id,
					kind: "identify",
					reason: CRM_CREATE.reason,
					priority: PRIORITY.identify,
					budget: 4,
				});
			}
		}

		await queueFollowUps(tx, events, research);
		return { company, contact };
	});
}
