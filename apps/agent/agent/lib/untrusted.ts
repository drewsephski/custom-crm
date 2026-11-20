import { UNTRUSTED } from "./untrusted-config";

const INVISIBLE = /[​-‍⁠﻿]/g;

const MARKER_LOOKALIKE = /untrusted[\s_-]*web[\s_-]*content/gi;

type KeyOfUnion<T> = T extends T ? keyof T : never;

function neutralised(text: string): string {
	return text
		.replace(INVISIBLE, "")
		.replace(MARKER_LOOKALIKE, UNTRUSTED.removedMarker);
}

function capped(text: string): string {
	return text.length > UNTRUSTED.maxChars
		? `${text.slice(0, UNTRUSTED.maxChars)}\n${UNTRUSTED.truncated}`
		: text;
}

export function untrusted(source: string, content: unknown): string {
	const text = typeof content === "string" ? content : JSON.stringify(content);

	return [
		`${UNTRUSTED.open} source="${neutralised(source).replace(/"/g, "'")}">`,
		UNTRUSTED.notice,
		capped(neutralised(text ?? "")),
		UNTRUSTED.close,
	].join("\n");
}

export function untrustedOutput<T extends object>(
	output: T,
	sources: { readonly [Key in KeyOfUnion<T> & string]?: string },
) {
	const labels = new Map<string, string | undefined>(Object.entries(sources));

	return {
		type: "json" as const,
		value: Object.fromEntries(
			Object.entries(output).map(([key, field]) => {
				const source = labels.get(key);
				return [
					key,
					source && field !== null && field !== undefined
						? untrusted(source, field)
						: field,
				];
			}),
		),
	};
}
