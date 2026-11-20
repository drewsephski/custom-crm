export const BLOB_HOST_SUFFIX = ".blob.vercel-storage.com";

export const NEON_STORAGE_HOST =
	/^[a-z0-9-]+\.storage\.[a-z0-9-]+\.[a-z0-9-]+\.aws\.neon\.tech$/;

export const MIRROR_URL_MARKERS = [
	BLOB_HOST_SUFFIX,
	".aws.neon.tech/",
] as const;

export const COMPANY_IMAGE_FIELDS = [
	"logoUrl",
	"logoDarkUrl",
	"iconUrl",
	"iconDarkUrl",
] as const;

export type CompanyImageField = (typeof COMPANY_IMAGE_FIELDS)[number];

const OPTIMIZABLE = new Set(["jpg", "jpeg", "png", "webp", "avif", "gif"]);

export function isMirrored(url: string | null | undefined): boolean {
	if (!url) return false;
	try {
		const { hostname } = new URL(url);
		return (
			hostname.endsWith(BLOB_HOST_SUFFIX) || NEON_STORAGE_HOST.test(hostname)
		);
	} catch {
		return false;
	}
}

export function isOptimizable(url: string | null | undefined): boolean {
	if (!isMirrored(url) || !url) return false;

	try {
		const extension = new URL(url).pathname.split(".").pop()?.toLowerCase();
		return extension !== undefined && OPTIMIZABLE.has(extension);
	} catch {
		return false;
	}
}
