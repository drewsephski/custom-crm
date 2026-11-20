import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "@crm/db";
import {
	platformCreditLimit,
	researchPeriod,
	workspaceCreditLimit,
	workspaceCreditUsage,
} from "@crm/db/research-budget";
import {
	currentOrganizationId,
	requireOrganizationId,
	runAsSystem,
} from "@crm/db/tenancy";
import { APIPromise } from "context.dev/core/api-promise";
import {
	answerEvidence,
	brandEvidence,
	providerBrand,
	sourcedAnswer,
} from "./brand-evidence";
import { classifyFailure } from "./failure";
import { createGate, createThrottle } from "./limits";
import { personEvidence, providerPerson } from "./person-evidence";
import { creditMetadata, creditsFromHeaders } from "./provider";
import { RESEARCH, type ResearchOperation } from "./research-config";
import { recoverExpiredReservations } from "./reservations";
import { backoffMs } from "./retry";

export const researchUser = new AsyncLocalStorage<string | null>();
const users = createThrottle(
	RESEARCH.rate.user,
	RESEARCH.preview.maxTrackedUsers,
);
const gate = createGate(RESEARCH.concurrency);
const throttle = createThrottle(
	RESEARCH.rate.workspace,
	RESEARCH.preview.maxTrackedUsers,
);

type Target = { companyId?: string; contactId?: string };
type Options = {
	operation: ResearchOperation;
	key: string;
	estimate?: number;
	target?: Target;
	domain?: string;
	previewUser?: string;
};
const tasks = {
	"brand.retrieve": "brand",
	"people.enrich": "person-enrich",
	"people.search": "people-search",
	"web.search": "web-search",
	"web.extract": "web-extract",
	"web.answers": "answer",
} as const;

function requestKeyFor({ key, target }: Options) {
	return createHash("sha256")
		.update(
			target ? JSON.stringify([key, target.contactId, target.companyId]) : key,
		)
		.digest("hex");
}

function evidenceFor<T>(options: Options, value: T) {
	if (options.domain)
		return brandEvidence(providerBrand.parse(value), options.domain);
	if (options.operation === "web.answers")
		return answerEvidence(sourcedAnswer.parse(value));
	if (options.operation === "people.enrich" && options.target?.contactId)
		return personEvidence(providerPerson.parse(value));
	return {};
}

export async function metered<T>(
	options: Options,
	call: () => PromiseLike<T>,
): Promise<T> {
	const org = options.previewUser ? null : requireOrganizationId();
	const key = org ?? options.previewUser;
	const user = options.previewUser ?? researchUser.getStore();
	if (
		(user && !users.take(user, new Date()).ok) ||
		!key ||
		!throttle.take(key, new Date()).ok
	)
		throw new Error("rate-limited");
	const result = await gate.run(org, async () => {
		for (let attempt = 1; ; attempt++) {
			try {
				return await account(options, call);
			} catch (cause) {
				if (
					org &&
					cause instanceof Error &&
					["budget-exhausted", "platform-budget-exhausted"].includes(
						cause.message,
					)
				) {
					await db.researchResult.create({
						data: {
							organizationId: org,
							...options.target,
							operation: options.operation,
							provider: RESEARCH.provider,
							task: tasks[options.operation],
							requestKey: requestKeyFor(options),
							status: "REFUSED",
							error: cause.message,
							settledAt: new Date(),
						},
					});
				}
				const failure = classifyFailure(cause, new Date());
				if (
					!failure.retryable ||
					!failure.status ||
					attempt >= RESEARCH.retry.maxAttempts ||
					(failure.retryAfterMs ?? 0) > RESEARCH.retry.maxRetryAfterMs
				)
					throw cause;
				await delay(
					backoffMs(
						attempt,
						{
							...RESEARCH.retry,
							timeoutMs: RESEARCH.operations[options.operation].timeoutMs,
						},
						Math.random,
						failure.retryAfterMs,
					),
				);
			}
		}
	});
	if (!result.ran) throw new Error("rate-limited");
	return result.value;
}

export function cachedLookup<T>() {
	const entries = new Map<string, { expires: number; value: Promise<T> }>();
	return async (
		options: Options,
		call: () => PromiseLike<T>,
		fresh = false,
	) => {
		const org = options.previewUser ? null : requireOrganizationId();
		const key = JSON.stringify([
			org ?? options.previewUser,
			options.operation,
			options.key,
			options.target,
		]);
		const existing = entries.get(key);
		if (existing && existing.expires > Date.now() && !fresh) {
			const result = await existing.value;
			if (org) {
				const now = new Date();
				const evidence = evidenceFor(options, result);
				await db.researchResult.create({
					data: {
						organizationId: org,
						...options.target,
						provider: RESEARCH.provider,
						operation: options.operation,
						task: tasks[options.operation],
						requestKey: requestKeyFor(options),
						status: "COMPLETE",
						cacheHit: true,
						settledAt: now,
						retrievedAt: now,
						...evidence,
					},
				});
			}
			return result;
		}
		entries.delete(key);
		const entry = {
			expires: Date.now() + RESEARCH.operations[options.operation].ttlMs,
			value: metered(options, call),
		};
		entries.set(key, entry);
		if (entries.size > RESEARCH.cache.maxEntries) {
			const oldest = entries.keys().next();
			if (!oldest.done) entries.delete(oldest.value);
		}
		try {
			return await entry.value;
		} catch (error) {
			if (entries.get(key) === entry) entries.delete(key);
			throw error;
		}
	};
}

async function account<T>(
	options: Options,
	call: () => PromiseLike<T>,
): Promise<T> {
	const { operation, target, previewUser } = options;
	const organizationId = previewUser ? null : currentOrganizationId();
	const estimate =
		options.estimate ?? RESEARCH.operations[operation].estimateCredits;
	const now = new Date();
	const period = researchPeriod(now);
	const provider = RESEARCH.provider;
	const where = { period_provider: { period, provider } };
	const requestKey = requestKeyFor(options);
	await recoverExpiredReservations(
		now,
		organizationId ? { organizationId, operation, requestKey } : undefined,
	);
	const reserve = () =>
		db.$transaction(async (tx) => {
			await tx.platformResearchUsage.upsert({
				where,
				create: { period, provider },
				update: { requests: { increment: 0 } },
			});
			const platform = await tx.platformResearchUsage.update({
				where,
				data: { requests: { increment: 1 } },
			});
			if (
				platform.creditsUsed + platform.creditsReserved + estimate >
				platformCreditLimit()
			)
				throw new Error("platform-budget-exhausted");
			let id: string | null = null;
			if (organizationId) {
				const setting = await tx.appSetting.findUnique({
					where: { organizationId },
					select: { researchCreditLimit: true },
				});
				const usage = await workspaceCreditUsage(
					tx,
					workspaceCreditLimit(setting?.researchCreditLimit),
				);
				if (usage.remaining < estimate) throw new Error("budget-exhausted");
				const row = await tx.researchResult.create({
					data: {
						organizationId,
						...target,
						userId: researchUser.getStore(),
						task: tasks[operation],
						operation,
						provider,
						requestKey,
						createdAt: now,
						creditsUsed: estimate,
						attempts: 1,
					},
					select: { id: true },
				});
				id = row.id;
			}
			await tx.platformResearchUsage.update({
				where,
				data: { creditsUsed: { increment: estimate } },
			});
			return id;
		});
	const id = previewUser
		? await runAsSystem("reserve onboarding research", reserve)
		: await reserve();
	let used = estimate;
	let status: "COMPLETE" | "PARTIAL" | "FAILED" = "FAILED";
	let evidence: ReturnType<typeof evidenceFor> = {};
	try {
		const pending = call();
		const packet =
			pending instanceof APIPromise ? await pending.withResponse() : null;
		const result = packet ? packet.data : await pending;
		used =
			creditMetadata.parse(result) ??
			creditsFromHeaders(packet?.response.headers) ??
			estimate;
		evidence = evidenceFor(options, result);
		status = "partial" in evidence && evidence.partial ? "PARTIAL" : "COMPLETE";
		return result;
	} catch (cause) {
		const failure = classifyFailure(cause, new Date());
		if (failure.status !== null)
			used = failure.creditsUsed ?? (failure.status === 404 ? estimate : 0);
		throw cause;
	} finally {
		const settle = () =>
			db.$transaction(async (tx) => {
				await tx.platformResearchUsage.update({
					where,
					data: { creditsUsed: { increment: used - estimate } },
				});
				if (id)
					await tx.researchResult.updateMany({
						where: { id },
						data: {
							...evidence,
							error: null,
							status,
							creditsUsed: used,
							creditsReserved: 0,
							retrievedAt: new Date(),
							settledAt: new Date(),
						},
					});
			});
		if (previewUser) await runAsSystem("settle onboarding research", settle);
		else await settle();
	}
}
