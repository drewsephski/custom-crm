const SETUP_SEGMENTS = new Set([
	"onboarding",
	"get-started",
	"invitations",
	"grant-access",
	"sign-in",
]);

export function slugFromPathname(pathname: string): string | null {
	const first = pathname.slice(1).split("/")[0] ?? "";
	if (!first || SETUP_SEGMENTS.has(first)) return null;
	return /^[a-z0-9-]{1,64}$/.test(first) ? first : null;
}
