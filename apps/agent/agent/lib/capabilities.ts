import "@crm/env/load";

import { blobEnabled } from "@crm/db/blob";
import { CONTEXT } from "./context-config";

export const CONTEXT_DEV = "CONTEXT_DEV";

export const CONTEXT_DEV_PEOPLE = "CONTEXT_DEV_PEOPLE";

export const CONTEXT_DEV_SEARCH = "CONTEXT_DEV_SEARCH";

export const PERPLEXITY = "PERPLEXITY_API_KEY";

export type Capability = {
	readonly id: string;
	readonly label: string;
	readonly gives: string;
	readonly enabled: boolean;
	readonly from: string;
};

function fromEnv(variable: string, id: string = variable) {
	return {
		id,
		from: variable,
		enabled: Boolean(process.env[variable]?.trim()),
	};
}

export function capabilities(): readonly Capability[] {
	return [
		{
			...fromEnv(PERPLEXITY),
			label: "Web research",
			gives:
				"open-web context with citations, and the search that finds a LinkedIn slug in the first place",
		},
		{
			...fromEnv(CONTEXT.keyVariable, CONTEXT_DEV),
			label: "Company brand data",
			gives: "a company's logo, industry, location and socials from its domain",
		},
		{
			...fromEnv(CONTEXT.keyVariable, CONTEXT_DEV_PEOPLE),
			label: "LinkedIn",
			gives:
				"a person read back from a LinkedIn URL you already hold — their real name, bio, current title and employer, every earlier role with its dates, their education and their other public profiles, all self-reported and so authoritative on identity",
		},
		{
			...fromEnv(CONTEXT.keyVariable, CONTEXT_DEV_SEARCH),
			label: "Web search",
			gives:
				"open-web search results with the text of each page, through research_person when Perplexity is not set. You read the pages yourself and cite the URL behind every claim",
		},
		{
			id: "BLOB_READ_WRITE_TOKEN",
			from: "BLOB_READ_WRITE_TOKEN or S3_PUBLIC_BUCKET",
			enabled: blobEnabled(),
			label: "Picture storage",
			gives:
				"somewhere to keep a logo or a profile photo. Without it a record has no picture at all, because the URLs these sources hand back expire and are never stored as they are",
		},
	];
}

export function enabled(id: string): boolean {
	return capabilities().some(
		(capability) => capability.id === id && capability.enabled,
	);
}

export type UnavailableCapability = {
	ok: false;
	configured: false;
	reason: string;
};

export function unavailable(id: string): UnavailableCapability {
	const label =
		capabilities().find((capability) => capability.id === id)?.label ??
		"That source";

	return {
		ok: false,
		configured: false,
		reason:
			`${label} is not configured on this install, so that source is unavailable. This is not a failure and retrying will not help — ` +
			"use what the CRM already knows, and say in your write-up what you could not check.",
	};
}

export function bootLines(): string[] {
	return capabilities().map(
		(capability) =>
			`[agent] ${capability.enabled ? "on " : "off"}  ${capability.label} (${capability.from})`,
	);
}

export function logCapabilities(): void {
	for (const line of bootLines()) console.log(line);
}

export function capabilitiesMarkdown(): string {
	return markdownFor(capabilities());
}

export function markdownFor(all: readonly Capability[]): string {
	const on = all.filter((capability) => capability.enabled);
	const off = all.filter((capability) => !capability.enabled);

	const lines = ["## What you can use here", ""];

	if (on.length === 0) {
		lines.push(
			"No outside sources are configured on this install. Everything you can",
			"learn is already in the CRM — email threads, meetings, signature",
			"blocks — and `read_crm_history` reads all of it for free. That is",
			"often enough to settle who somebody is. Record what it shows, and",
			"leave the rest empty.",
		);
		return lines.join("\n");
	}

	lines.push("Available:");
	for (const capability of on) {
		lines.push(`- **${capability.label}** — ${capability.gives}.`);
	}

	if (off.length > 0) {
		lines.push("", "Not configured here, so do not plan around them:");
		for (const capability of off) {
			lines.push(`- ${capability.label}`);
		}
		lines.push(
			"",
			"Their tools will tell you the same thing if you call them. Note what",
			"you could not check rather than guessing at it.",
		);
	}

	return lines.join("\n");
}
