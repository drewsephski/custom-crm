import { defineTool } from "eve/tools";
import { z } from "zod";
import { CONTEXT_DEV_PEOPLE, enabled, unavailable } from "../lib/capabilities";
import { CONTEXT } from "../lib/context-config";
import { spend } from "../lib/focus";
import { findLinkedinProfiles } from "../lib/linkedin-find";
import { inSessionTenant } from "../lib/tenant-scope";
import { untrustedOutput } from "../lib/untrusted";

export default defineTool({
	description:
		"Find a person's LinkedIn profile from their name, and their employer when the user gave one. It searches LinkedIn, tries the usual profile addresses, reads the likeliest profiles and returns only the ones whose name matches, each with current roles, past employers and whether they work or worked at the company. Use it before research_person when the goal is to identify someone. Several matches mean several people share the name: ask the user which one.",
	inputSchema: z.object({
		firstName: z.string().trim().min(1),
		lastName: z.string().trim().min(1),
		company: z
			.string()
			.trim()
			.min(1)
			.optional()
			.describe("The employer the user named, if any."),
	}),
	async execute({ firstName, lastName, company }, ctx) {
		return inSessionTenant(ctx, async () => {
			if (!enabled(CONTEXT_DEV_PEOPLE)) {
				return { found: false as const, ...unavailable(CONTEXT_DEV_PEOPLE) };
			}

			const charge = spend(2 * CONTEXT.linkedinFind.maxProfiles);
			if (!charge.ok) return { found: false as const, reason: charge.reason };

			const { candidates, read } = await findLinkedinProfiles({
				firstName,
				lastName,
				company: company ?? null,
			});

			if (candidates.length === 0) {
				return {
					found: false as const,
					reason: `Read ${read} likely profiles and none was a ${firstName} ${lastName}. Ask the user for a LinkedIn URL, an email address or another detail.`,
				};
			}

			return {
				found: true as const,
				candidates,
				note: "Each candidate's name matches. Check its roles against what the user said before treating it as the person they mean.",
			};
		});
	},
	toModelOutput(output) {
		return untrustedOutput(output, { candidates: "LinkedIn profiles" });
	},
});
