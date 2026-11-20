import { createHash } from "node:crypto";
import { httpUrl, publicDomain } from "./urls";

export type KeyPart =
	| string
	| number
	| boolean
	| null
	| readonly KeyPart[]
	| { readonly [name: string]: KeyPart };

const LINKEDIN_HOST = "linkedin.com";
const SLUG = /^[\p{L}\p{N}%_.-]{1,200}$/u;

function isList(part: KeyPart): part is readonly KeyPart[] {
	return Array.isArray(part);
}

function canonical(part: KeyPart): string {
	if (part === null) return "null";
	if (isList(part)) return `[${part.map(canonical).join(",")}]`;

	if (part instanceof Object) {
		const fields = Object.keys(part)
			.sort()
			.map(
				(name) => `${JSON.stringify(name)}:${canonical(part[name] ?? null)}`,
			);
		return `{${fields.join(",")}}`;
	}

	return JSON.stringify(part);
}

export function requestKey(
	provider: string,
	operation: string,
	request: KeyPart,
): string {
	return createHash("sha256")
		.update(canonical([provider, operation, request]))
		.digest("hex");
}

export function normalizeQuery(raw: string): string {
	return raw.normalize("NFKC").replace(/\s+/g, " ").trim();
}

export function normalizeName(raw: string | null | undefined): string | null {
	const text = raw ? normalizeQuery(raw).toLowerCase() : "";
	return text.length > 0 ? text : null;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
	const text = raw?.trim().toLowerCase() ?? "";
	const at = text.indexOf("@");
	if (at <= 0 || at !== text.lastIndexOf("@")) return null;
	if (/\s/.test(text) || at === text.length - 1) return null;

	return text;
}

export function normalizeDomain(raw: string | null | undefined): string | null {
	return publicDomain(raw);
}

export function linkedinSlug(raw: string | null | undefined): string | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;

	if (!trimmed.includes("/")) return cleanSlug(trimmed);

	const candidate = /^https?:\/\//i.test(trimmed)
		? trimmed
		: `https://${trimmed}`;

	try {
		const url = new URL(candidate);
		const host = url.hostname.toLowerCase();
		if (host !== LINKEDIN_HOST && !host.endsWith(`.${LINKEDIN_HOST}`)) {
			return null;
		}

		const [section, slug] = url.pathname.split("/").filter(Boolean);
		return section === "in" && slug ? cleanSlug(slug) : null;
	} catch {
		return null;
	}
}

function cleanSlug(raw: string): string | null {
	let slug = raw;
	try {
		slug = decodeURIComponent(raw);
	} catch {
		slug = raw;
	}

	const text = slug.normalize("NFKC").trim().toLowerCase();
	return SLUG.test(text) ? text : null;
}

export function linkedinProfileUrl(slug: string): string {
	return `https://www.${LINKEDIN_HOST}/in/${encodeURIComponent(slug)}`;
}

export type ProfileIdentity = { key: string; url: string };

export function profileIdentity(
	raw: string | null | undefined,
): ProfileIdentity | null {
	const slug = linkedinSlug(raw);
	if (slug) return { key: `linkedin:${slug}`, url: linkedinProfileUrl(slug) };

	const url = httpUrl(raw);
	if (!url) return null;

	const parsed = new URL(url);
	const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
	const path = parsed.pathname.replace(/\/+$/, "");

	return { key: `url:${host}${path}`, url };
}
