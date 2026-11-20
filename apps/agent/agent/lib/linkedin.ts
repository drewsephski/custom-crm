const PROFILE_PATH =
	/(?<![a-z0-9-])(?:[a-z0-9-]+\.)*linkedin\.com\/in\/([^/?#\s]+)/i;

const TRAILING_PUNCTUATION = /[.,;:!?)\]}>'"]+$/;

const BARE_SLUG = /^[A-Za-z0-9_-]+$/;

function decoded(slug: string): string {
	try {
		return decodeURIComponent(slug);
	} catch {
		return slug;
	}
}

function canonical(slug: string): string | null {
	const value = decoded(slug.replace(TRAILING_PUNCTUATION, ""))
		.normalize("NFC")
		.toLowerCase();

	return value.length > 0 ? value : null;
}

export function linkedinSlug(value: string | null | undefined): string | null {
	if (!value) return null;

	const slug = PROFILE_PATH.exec(value)?.[1];
	return slug ? canonical(slug) : null;
}

export function linkedinSlugOrHandle(value: string): string | null {
	const trimmed = value.trim();
	return (
		linkedinSlug(trimmed) ??
		(BARE_SLUG.test(trimmed) ? canonical(trimmed) : null)
	);
}

export function linkedinProfileUrl(slug: string): string {
	return `https://www.linkedin.com/in/${encodeURIComponent(slug)}`;
}
