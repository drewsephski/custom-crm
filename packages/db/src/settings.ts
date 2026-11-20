import { defaultModel } from "./ai-models";
import type { Db } from "./client";
import {
	DEFAULT_REPORTING_CURRENCY,
	isCurrencyCode,
	normalizeCurrency,
} from "./currency";
import { requireOrganizationId } from "./tenancy";

export function settingsKey() {
	return { organizationId: requireOrganizationId() };
}

export const DEFAULT_AGENT_MODEL = {
	get id(): string {
		return defaultModel().id;
	},
	get contextWindowTokens(): number {
		return defaultModel().contextWindowTokens;
	},
} as const;

export interface AgentModelSetting {
	id: string;
	contextWindowTokens: number;
	isDefault: boolean;
}

export function configuredAgentModel(): AgentModelSetting {
	const model = defaultModel();
	return {
		id: model.id,
		contextWindowTokens: model.contextWindowTokens,
		isDefault: !process.env.ANTHROPIC_MODEL,
	};
}

export async function readReportingCurrency(db: Db): Promise<string> {
	const row = await db.appSetting.findUnique({
		where: settingsKey(),
		select: { reportingCurrency: true },
	});

	const stored = normalizeCurrency(row?.reportingCurrency);

	return isCurrencyCode(stored) ? stored : DEFAULT_REPORTING_CURRENCY;
}

export async function writeReportingCurrency(
	db: Db,
	code: string,
): Promise<string> {
	const reportingCurrency = normalizeCurrency(code);

	await db.appSetting.upsert({
		where: settingsKey(),
		create: { ...settingsKey(), reportingCurrency },
		update: { reportingCurrency },
	});

	return reportingCurrency;
}

export async function readRatesRefreshedAt(db: Db): Promise<Date | null> {
	const row = await db.appSetting.findUnique({
		where: settingsKey(),
		select: { ratesRefreshedAt: true },
	});

	return row?.ratesRefreshedAt ?? null;
}

export async function writeRatesRefreshedAt(
	db: Db,
	ratesRefreshedAt: Date,
): Promise<void> {
	await db.appSetting.upsert({
		where: settingsKey(),
		create: { ...settingsKey(), ratesRefreshedAt },
		update: { ratesRefreshedAt },
	});
}

export const DEFAULT_ARCHIVE_RETENTION_DAYS = 180;

export const MIN_ARCHIVE_RETENTION_DAYS = 1;

export const MAX_ARCHIVE_RETENTION_DAYS = 3650;

export async function readArchiveRetentionDays(db: Db): Promise<number> {
	const row = await db.appSetting.findUnique({
		where: settingsKey(),
		select: { archiveRetentionDays: true },
	});

	return row?.archiveRetentionDays ?? DEFAULT_ARCHIVE_RETENTION_DAYS;
}

export async function writeArchiveRetentionDays(
	db: Db,
	days: number,
): Promise<number> {
	const archiveRetentionDays = Math.min(
		Math.max(Math.round(days), MIN_ARCHIVE_RETENTION_DAYS),
		MAX_ARCHIVE_RETENTION_DAYS,
	);

	await db.appSetting.upsert({
		where: settingsKey(),
		create: { ...settingsKey(), archiveRetentionDays },
		update: { archiveRetentionDays },
	});

	return archiveRetentionDays;
}
