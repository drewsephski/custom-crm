export const LANDING_PATH = "/";

export const SIGN_IN_PATH = "/sign-in";

export const GET_STARTED_PATH = "/get-started";

export const ENTRY_PATH = "/onboarding";

export const NEXT_PARAM = "next";

const NEXT_PATH = {
	maxLength: 512,
	firstPrintableCode: 0x20,
	deleteCode: 0x7f,
	probeOrigin: "http://next.invalid",
} as const;

function hasControlCharacter(value: string): boolean {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < NEXT_PATH.firstPrintableCode || code === NEXT_PATH.deleteCode) {
			return true;
		}
	}

	return false;
}

function isRelativePath(value: string): boolean {
	if (value.length === 0 || value.length > NEXT_PATH.maxLength) return false;
	if (!value.startsWith("/")) return false;
	if (value.includes("//") || value.includes("\\")) return false;

	return !hasControlCharacter(value);
}

function decoded(value: string): string | null {
	try {
		return decodeURIComponent(value);
	} catch {
		return null;
	}
}

function staysOnOrigin(value: string): boolean {
	try {
		return (
			new URL(value, NEXT_PATH.probeOrigin).origin === NEXT_PATH.probeOrigin
		);
	} catch {
		return false;
	}
}

export function isSafeNextPath(
	value: string | null | undefined,
): value is string {
	if (typeof value !== "string" || !isRelativePath(value)) return false;

	const plain = decoded(value);
	if (plain === null || !isRelativePath(plain)) return false;

	return staysOnOrigin(value);
}

export function safeNextPath(value: string | null | undefined): string {
	return isSafeNextPath(value) ? value : ENTRY_PATH;
}

export function signInPathFor(next: string): string {
	if (!isSafeNextPath(next)) return SIGN_IN_PATH;

	return `${SIGN_IN_PATH}?${new URLSearchParams({ [NEXT_PARAM]: next })}`;
}

export function withNext(path: string, next: string): string {
	if (next === ENTRY_PATH || !isSafeNextPath(next)) return path;

	return `${path}?${new URLSearchParams({ [NEXT_PARAM]: next })}`;
}
