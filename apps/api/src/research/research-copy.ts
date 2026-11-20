import type { ResearchStatus } from "@crm/db";

export const RESEARCH_REFUSALS = [
	"budget-exhausted",
	"platform-budget-exhausted",
	"rate-limited",
	"other",
] as const;

export type ResearchRefusal = (typeof RESEARCH_REFUSALS)[number];

const REFUSAL_COPY = {
	"budget-exhausted": "The research allowance for this month is used.",
	"platform-budget-exhausted":
		"Research is paused for a short time. Try again later.",
	"rate-limited": "Too many lookups ran at once. Try again in a few minutes.",
	other: "This lookup did not start. Try again later.",
} satisfies Record<ResearchRefusal, string>;

const FAILED_COPY = "The lookup did not finish. Try again later.";

const UNREADABLE_COPY =
	"This result is stored in a form the CRM cannot read. Run the research again.";

const KNOWN_REFUSALS = new Map<string, ResearchRefusal>(
	RESEARCH_REFUSALS.map((reason) => [reason, reason]),
);

export function researchRefusal(
	status: ResearchStatus,
	error: string | null,
): ResearchRefusal | null {
	if (status !== "REFUSED") return null;
	return KNOWN_REFUSALS.get(error?.trim() ?? "") ?? "other";
}

export function researchErrorCopy(
	status: ResearchStatus,
	refusal: ResearchRefusal | null,
	readable: boolean,
): string | null {
	if (refusal) return REFUSAL_COPY[refusal];
	if (status === "FAILED") return FAILED_COPY;
	if (!readable) return UNREADABLE_COPY;
	return null;
}
