import net from "node:net";
import { RESEARCH_RESULT_LIMITS } from "@crm/validation/research-result";

const MAX_DOMAIN_CHARS = 253;

const INTERNAL_SUFFIXES = [
	"localhost",
	"local",
	"localdomain",
	"internal",
	"intranet",
	"lan",
	"home",
	"corp",
	"private",
	"test",
	"example",
	"invalid",
	"arpa",
	"onion",
] as const;

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const TOP_LEVEL = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/;

export function httpUrl(raw: string | null | undefined): string | null {
	const trimmed = raw?.trim();
	if (!trimmed || trimmed.length > RESEARCH_RESULT_LIMITS.url) return null;

	try {
		const url = new URL(trimmed);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.username || url.password || !url.hostname) return null;

		const text = url.toString();
		return text.length > RESEARCH_RESULT_LIMITS.url ? null : text;
	} catch {
		return null;
	}
}

export function httpUrls(
	values: readonly (string | null | undefined)[],
): string[] {
	const seen = new Set<string>();

	for (const value of values) {
		const url = httpUrl(value);
		if (url) seen.add(url);
	}

	return [...seen];
}

export function publicDomain(raw: string | null | undefined): string | null {
	const trimmed = raw?.trim().toLowerCase();
	if (!trimmed) return null;

	const candidate = /^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	let host: string;
	try {
		const url = new URL(candidate);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		if (url.username || url.password) return null;
		host = url.hostname;
	} catch {
		return null;
	}

	const bare = host.replace(/\.$/, "").replace(/^www\./, "");
	if (!bare || bare.length > MAX_DOMAIN_CHARS) return null;
	if (bare.startsWith("[") || net.isIP(bare) !== 0) return null;

	const labels = bare.split(".");
	if (labels.length < 2) return null;
	if (!labels.every((label) => LABEL.test(label))) return null;

	const topLevel = labels[labels.length - 1];
	if (!topLevel || !TOP_LEVEL.test(topLevel)) return null;
	if (INTERNAL_SUFFIXES.some((suffix) => suffix === topLevel)) return null;

	return bare;
}
