import type { CompanyUpdateInput } from "../companies/companies.contracts";
import type { ContactUpdateInput } from "../contacts/contacts.contracts";

export type ResearchRecordKind = "company" | "contact";

export const COMPANY_ACCEPT_COLUMNS = {
	website: "website",
	description: "description",
	industry: "industry",
	city: "city",
	stateCode: "stateCode",
	country: "country",
	phone: "phone",
	email: "email",
	linkedinUrl: "linkedinUrl",
} as const satisfies Record<string, keyof CompanyUpdateInput>;

export const CONTACT_ACCEPT_COLUMNS = {
	title: "title",
	phone: "phone",
	linkedinUrl: "linkedinUrl",
	twitterUrl: "twitterUrl",
	githubUrl: "githubUrl",
} as const satisfies Record<string, keyof ContactUpdateInput>;

export type CompanyAcceptColumn =
	(typeof COMPANY_ACCEPT_COLUMNS)[keyof typeof COMPANY_ACCEPT_COLUMNS];

export type ContactAcceptColumn =
	(typeof CONTACT_ACCEPT_COLUMNS)[keyof typeof CONTACT_ACCEPT_COLUMNS];

export const COMPANY_ACCEPT_SELECT = {
	website: true,
	description: true,
	industry: true,
	city: true,
	stateCode: true,
	country: true,
	phone: true,
	email: true,
	linkedinUrl: true,
} as const satisfies Record<CompanyAcceptColumn, true>;

export const CONTACT_ACCEPT_SELECT = {
	title: true,
	phone: true,
	linkedinUrl: true,
	twitterUrl: true,
	githubUrl: true,
} as const satisfies Record<ContactAcceptColumn, true>;

const COMPANY_COLUMN_BY_FIELD = new Map<string, CompanyAcceptColumn>(
	Object.entries(COMPANY_ACCEPT_COLUMNS),
);

const CONTACT_COLUMN_BY_FIELD = new Map<string, ContactAcceptColumn>(
	Object.entries(CONTACT_ACCEPT_COLUMNS),
);

export function companyAcceptColumn(
	field: string,
): CompanyAcceptColumn | undefined {
	return COMPANY_COLUMN_BY_FIELD.get(field);
}

export function contactAcceptColumn(
	field: string,
): ContactAcceptColumn | undefined {
	return CONTACT_COLUMN_BY_FIELD.get(field);
}

export function canAcceptField(
	kind: ResearchRecordKind | null,
	field: string,
): boolean {
	if (kind === "company") return COMPANY_COLUMN_BY_FIELD.has(field);
	if (kind === "contact") return CONTACT_COLUMN_BY_FIELD.has(field);
	return false;
}

export function sameValue(
	left: string | null | undefined,
	right: string | null | undefined,
): boolean {
	return (left ?? "").trim() === (right ?? "").trim();
}
