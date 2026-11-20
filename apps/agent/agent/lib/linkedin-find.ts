import { z } from "zod";
import { CONTEXT } from "./context-config";
import { contextDev, describe } from "./context-dev";
import { linkedinProfileUrl, linkedinSlug } from "./linkedin";
import { namesMatch, normalise } from "./names";
import { type Person, personByProfileUrl } from "./people";
import { metered } from "./research/meter";
import { PROVIDER_PATHS } from "./research/provider";

export type LinkedinLookup = {
	firstName: string;
	lastName: string;
	company: string | null;
};

export type LinkedinCandidate = {
	profileUrl: string;
	fullName: string | null;
	location: string | null;
	currentRoles: { title: string | null; organisation: string | null }[];
	pastEmployers: string[];
	worksAtCompany: boolean | null;
};

export function searchedSlugs(
	lookup: LinkedinLookup,
	results: readonly { url: string | null; title: string | null }[],
): string[] {
	const last = normalise(lookup.lastName);
	return results.flatMap((result) => {
		const slug = linkedinSlug(result.url);
		if (!slug || !last) return [];
		const named =
			normalise(slug).includes(last) ||
			normalise(result.title ?? "").includes(last);
		return named ? [slug] : [];
	});
}

export function candidateSlugs(
	lookup: LinkedinLookup,
	searched: readonly string[],
): string[] {
	const fullName = normalise(`${lookup.firstName}${lookup.lastName}`);
	const exact = searched.filter((slug) => normalise(slug).startsWith(fullName));
	const ordered = [...exact, ...searched];
	return [...new Set(ordered)].slice(0, CONTEXT.linkedinFind.maxProfiles);
}

function employerMatches(employer: string | null, company: string): boolean {
	const a = normalise(employer ?? "");
	const b = normalise(company);
	return a !== "" && b !== "" && (a === b || a.includes(b) || b.includes(a));
}

export function candidateFrom(
	person: Person,
	lookup: LinkedinLookup,
	profileUrl: string,
): LinkedinCandidate | null {
	const name =
		person.fullName ??
		[person.firstName, person.lastName].filter(Boolean).join(" ");
	if (!namesMatch(name, `${lookup.firstName} ${lookup.lastName}`)) return null;

	const employers = person.experience.map((role) => role.organisation.name);
	return {
		profileUrl: person.profileUrl ?? profileUrl,
		fullName: name || null,
		location: person.location,
		currentRoles: person.currentRoles.map((role) => ({
			title: role.title,
			organisation: role.organisation.name,
		})),
		pastEmployers: [
			...new Set(
				person.experience
					.filter((role) => !role.isCurrent)
					.flatMap((role) =>
						role.organisation.name ? [role.organisation.name] : [],
					),
			),
		],
		worksAtCompany: lookup.company
			? employers.some((employer) =>
					employerMatches(employer, lookup.company ?? ""),
				)
			: null,
	};
}

async function searchLinkedin(query: string) {
	const api = contextDev();
	if (!api) return [];
	try {
		const response = await metered(
			{ operation: "people.search", key: query },
			() =>
				api.post(PROVIDER_PATHS.peopleSearch, {
					body: { query, mode: "fast" },
				}),
		);
		const people = z
			.object({
				results: z.array(
					z.object({
						name: z.string().nullable(),
						profiles: z.array(z.string()),
					}),
				),
			})
			.parse(response);
		return people.results.flatMap((person) =>
			person.profiles.map((url) => ({ url, title: person.name })),
		);
	} catch (error) {
		console.warn(`[agent] LinkedIn search failed: ${describe(error)}`);
		return [];
	}
}

export async function findLinkedinProfiles(
	lookup: LinkedinLookup,
): Promise<{ candidates: LinkedinCandidate[]; read: number }> {
	const name = `${lookup.firstName} ${lookup.lastName}`;
	const results = await searchLinkedin(
		lookup.company ? `${name} at ${lookup.company}` : name,
	);
	const slugs = candidateSlugs(lookup, searchedSlugs(lookup, results));

	const read = await Promise.all(
		slugs.map(async (slug) => {
			const url = linkedinProfileUrl(slug);
			const match = await personByProfileUrl(url);
			return match.outcome === "found"
				? candidateFrom(match.person, lookup, url)
				: null;
		}),
	);

	const unique = new Map<string, LinkedinCandidate>();
	for (const candidate of read) {
		if (candidate) unique.set(candidate.profileUrl.toLowerCase(), candidate);
	}
	const candidates = [...unique.values()].sort(
		(left, right) =>
			Number(right.worksAtCompany === true) -
			Number(left.worksAtCompany === true),
	);
	return { candidates, read: slugs.length };
}
