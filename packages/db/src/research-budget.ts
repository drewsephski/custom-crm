import type { Prisma } from "./generated/prisma/client";

const MINUTE_MS = 60_000;

export const RESEARCH_BUDGET = {
	workspaceVariable: "RESEARCH_WORKSPACE_MONTHLY_CREDITS",
	platformVariable: "RESEARCH_PLATFORM_MONTHLY_CREDITS",
	defaultWorkspaceCredits: 500,
	defaultPlatformCredits: 20_000,
	reservationTtlMs: 10 * MINUTE_MS,
	warnRatio: 0.8,
} as const;

type UsageReader = Pick<Prisma.TransactionClient, "researchResult">;

export type ResearchCreditUsage = {
	period: string;
	limit: number;
	used: number;
	reserved: number;
	remaining: number;
	exhausted: boolean;
};

function configuredCredits(variable: string, fallback: number): number {
	const raw = process.env[variable]?.trim();
	if (!raw) return fallback;

	const value = Number(raw);
	return Number.isInteger(value) && value >= 0 ? value : fallback;
}

export function researchPeriod(now: Date = new Date()): string {
	const month = String(now.getUTCMonth() + 1).padStart(2, "0");
	return `${now.getUTCFullYear()}-${month}`;
}

export function researchPeriodStart(now: Date = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export function researchPeriodEnd(now: Date = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function workspaceCreditLimit(
	override: number | null | undefined,
): number {
	if (override !== null && override !== undefined && override >= 0) {
		return override;
	}

	return configuredCredits(
		RESEARCH_BUDGET.workspaceVariable,
		RESEARCH_BUDGET.defaultWorkspaceCredits,
	);
}

export function platformCreditLimit(): number {
	return configuredCredits(
		RESEARCH_BUDGET.platformVariable,
		RESEARCH_BUDGET.defaultPlatformCredits,
	);
}

export async function workspaceCreditUsage(
	tx: UsageReader,
	limit: number,
	now: Date = new Date(),
): Promise<ResearchCreditUsage> {
	const start = researchPeriodStart(now);
	const reservedSince = new Date(
		now.getTime() - RESEARCH_BUDGET.reservationTtlMs,
	);

	const [settled, open] = await Promise.all([
		tx.researchResult.aggregate({
			where: { createdAt: { gte: start }, settledAt: { not: null } },
			_sum: { creditsUsed: true },
		}),
		tx.researchResult.aggregate({
			where: { settledAt: null, createdAt: { gte: reservedSince } },
			_sum: { creditsReserved: true },
		}),
	]);

	const used = settled._sum.creditsUsed ?? 0;
	const reserved = open._sum.creditsReserved ?? 0;
	const remaining = Math.max(0, limit - used - reserved);

	return {
		period: researchPeriod(now),
		limit,
		used,
		reserved,
		remaining,
		exhausted: remaining <= 0,
	};
}
