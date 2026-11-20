import { defineTool } from "eve/tools";
import { z } from "zod";
import {
	CONTEXT_DEV_PEOPLE,
	CONTEXT_DEV_SOURCE,
	enabled,
	unavailable,
} from "../lib/capabilities";
import { spend } from "../lib/focus";
import { personByProfileUrl } from "../lib/people";
import { inSessionTenant } from "../lib/tenant-scope";

const profileUrl = z
	.string()
	.trim()
	.transform((value, ctx) => {
		const slug =
			/linkedin\.com\/in\/([^/?#\s]+)/i.exec(value)?.[1] ??
			(/^[A-Za-z0-9_-]+$/.test(value) ? value : null);
		if (!slug) {
			ctx.addIssue({
				code: "custom",
				message: "Pass a linkedin.com/in/<slug> URL or the slug alone.",
			});
			return z.NEVER;
		}
		return `https://www.linkedin.com/in/${slug}`;
	});

export default defineTool({
	description:
		"Read a public LinkedIn profile by its linkedin.com/in/ URL or slug: name, headline, location, current roles, full work history and education, all self-reported. Use it to confirm who a person is and where they work after a search turns up their profile. A name match alone does not prove the profile is the person the user means; check the employer, role or location the user gave.",
	inputSchema: z.object({
		profile: z
			.string()
			.describe("A linkedin.com/in/<slug> URL, or the slug alone."),
	}),
	async execute({ profile }, ctx) {
		return inSessionTenant(ctx, async () => {
			if (!(await enabled(CONTEXT_DEV_PEOPLE))) {
				return { found: false as const, ...unavailable(CONTEXT_DEV_SOURCE) };
			}

			const parsed = profileUrl.safeParse(profile);
			if (!parsed.success) {
				return {
					found: false as const,
					reason: parsed.error.issues[0]?.message ?? "Not a profile URL.",
				};
			}

			const charge = spend(2);
			if (!charge.ok) return { found: false as const, reason: charge.reason };

			const result = await personByProfileUrl(parsed.data);
			if (result.outcome !== "found") {
				return { found: false as const, reason: result.reason };
			}

			return {
				found: true as const,
				profile: result.person,
				sourceUrl: result.person.profileUrl ?? parsed.data,
			};
		});
	},
});
