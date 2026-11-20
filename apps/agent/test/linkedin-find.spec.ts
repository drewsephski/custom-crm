import { describe, expect, it } from "bun:test";
import { linkedinSlug } from "../agent/lib/linkedin";
import {
	candidateFrom,
	candidateSlugs,
	searchedSlugs,
} from "../agent/lib/linkedin-find";
import type { Person } from "../agent/lib/people";

const sam = { firstName: "Sam", lastName: "Stehno", company: "Oxy" };

function person(overrides: Partial<Person>): Person {
	return {
		firstName: "Sam",
		lastName: "Stehno",
		fullName: "Sam Stehno",
		bio: null,
		location: "Lubbock",
		email: null,
		photoUrl: null,
		profileUrl: "https://www.linkedin.com/in/sam-stehno",
		socialUrls: [],
		websiteUrls: [],
		skills: [],
		currentRoles: [],
		experience: [],
		education: [],
		...overrides,
	} as Person;
}

describe("finding a LinkedIn profile by name", () => {
	it("reads the slug from a profile URL and ignores company pages", () => {
		expect(linkedinSlug("https://www.linkedin.com/in/Sam-Stehno/?trk=x")).toBe(
			"sam-stehno",
		);
		expect(linkedinSlug("https://www.linkedin.com/company/oxy")).toBeNull();
	});

	it("keeps only search results that carry the surname", () => {
		expect(
			searchedSlugs(sam, [
				{
					url: "https://www.linkedin.com/in/sam-lewis-1/",
					title: "Sam Lewis - Oxy",
				},
				{ url: "https://www.linkedin.com/in/x-9/", title: "Sam Stehno - Oxy" },
				{ url: "https://www.linkedin.com/company/oxy", title: "Oxy" },
			]),
		).toEqual(["x-9"]);
	});

	it("tries an exact name slug first, and uses only returned profiles", () => {
		expect(candidateSlugs(sam, ["pavel-stehno-1", "sam-stehno-42"])).toEqual([
			"sam-stehno-42",
			"pavel-stehno-1",
		]);
	});

	it("drops a profile whose name does not match", () => {
		expect(
			candidateFrom(
				person({ firstName: "Pavel", fullName: "Pavel Stehno" }),
				sam,
				"https://www.linkedin.com/in/pavel-stehno",
			),
		).toBeNull();
	});

	it("says whether the person works at the company the user named", () => {
		const role = (name: string, isCurrent: boolean) => ({
			title: "Engineer",
			organisation: { name, domain: null },
			startDate: null,
			endDate: null,
			location: null,
			description: null,
			isCurrent,
		});
		const candidate = candidateFrom(
			person({
				currentRoles: [role("Oxy", true)],
				experience: [role("Oxy", true), role("Baker Hughes", false)],
			}),
			sam,
			"https://www.linkedin.com/in/sam-stehno",
		);

		expect(candidate).toMatchObject({
			fullName: "Sam Stehno",
			currentRoles: [{ title: "Engineer", organisation: "Oxy" }],
			pastEmployers: ["Baker Hughes"],
			worksAtCompany: true,
		});
		expect(
			candidateFrom(
				person({ experience: [role("Baker Hughes", false)] }),
				sam,
				"https://www.linkedin.com/in/sam-stehno",
			)?.worksAtCompany,
		).toBe(false);
	});
});
