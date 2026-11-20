import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	bootLines,
	CONTEXT_DEV,
	CONTEXT_DEV_PEOPLE,
	CONTEXT_DEV_SEARCH,
	capabilities,
	capabilitiesMarkdown,
	enabled,
	PERPLEXITY,
	unavailable,
} from "../agent/lib/capabilities";
import {
	contextDevClient,
	contextDevConfigured,
} from "../agent/lib/context-client";

const KEYS = [
	"PERPLEXITY_API_KEY",
	"CONTEXT_DEV_API_KEY",
	"BLOB_READ_WRITE_TOKEN",
	"S3_PUBLIC_BUCKET",
] as const;

const PLATFORM_KEY = "ctx-platform-key-0123456789";

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of KEYS) {
		saved[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of KEYS) {
		if (saved[key] === undefined) delete process.env[key];
		else process.env[key] = saved[key];
	}
});

const capability = (id: string) =>
	capabilities().find((entry) => entry.id === id);

describe("capabilities", () => {
	it("reports everything off on a bare install", () => {
		expect(capabilities().every((entry) => !entry.enabled)).toBe(true);
		expect(enabled(PERPLEXITY)).toBe(false);
	});

	it("turns one on without turning on the others", () => {
		process.env.PERPLEXITY_API_KEY = "pplx-test";

		expect(enabled(PERPLEXITY)).toBe(true);
		expect(enabled("BLOB_READ_WRITE_TOKEN")).toBe(false);
		expect(enabled(CONTEXT_DEV)).toBe(false);
	});

	it("treats blank and whitespace as unset", () => {
		process.env.PERPLEXITY_API_KEY = "   ";
		process.env.CONTEXT_DEV_API_KEY = "   ";

		expect(enabled(PERPLEXITY)).toBe(false);
		expect(enabled(CONTEXT_DEV)).toBe(false);
		expect(contextDevConfigured()).toBe(false);
		expect(contextDevClient()).toBeNull();
	});

	it("is read live, so a late-configured process is not stuck off", () => {
		expect(enabled(CONTEXT_DEV)).toBe(false);
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;
		expect(enabled(CONTEXT_DEV)).toBe(true);
		delete process.env.CONTEXT_DEV_API_KEY;
		expect(enabled(CONTEXT_DEV)).toBe(false);
	});

	it("is unknown for a variable that is not a capability", () => {
		process.env.SOMETHING_ELSE = "x";
		expect(enabled("SOMETHING_ELSE")).toBe(false);
		delete process.env.SOMETHING_ELSE;
	});
});

describe("the Context key is one platform variable", () => {
	it("turns the three Context sources on together", () => {
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;

		for (const id of [CONTEXT_DEV, CONTEXT_DEV_PEOPLE, CONTEXT_DEV_SEARCH]) {
			expect(enabled(id)).toBe(true);
		}
		expect(contextDevConfigured()).toBe(true);
		expect(contextDevClient()).not.toBeNull();
	});

	it("turns the three Context sources off together", () => {
		for (const id of [CONTEXT_DEV, CONTEXT_DEV_PEOPLE, CONTEXT_DEV_SEARCH]) {
			expect(enabled(id)).toBe(false);
		}
	});

	it("names the variable, and nothing reads Settings", () => {
		for (const id of [CONTEXT_DEV, CONTEXT_DEV_PEOPLE, CONTEXT_DEV_SEARCH]) {
			expect(capability(id)?.from).toBe("CONTEXT_DEV_API_KEY");
		}
		expect(JSON.stringify(capabilities())).not.toContain("Settings");
	});

	it("keeps the labels the instructions already use", () => {
		expect(capability(CONTEXT_DEV)?.label).toBe("Company brand data");
		expect(capability(CONTEXT_DEV_PEOPLE)?.label).toBe("LinkedIn");
		expect(capability(CONTEXT_DEV_SEARCH)?.label).toBe("Web search");
	});

	it("does not turn on Perplexity", () => {
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;

		expect(enabled(CONTEXT_DEV_SEARCH)).toBe(true);
		expect(enabled(PERPLEXITY)).toBe(false);
	});

	it("never puts the key value in a capability, a briefing or a boot line", () => {
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;

		const surfaces = [
			JSON.stringify(capabilities()),
			capabilitiesMarkdown(),
			bootLines().join("\n"),
			JSON.stringify(unavailable(CONTEXT_DEV)),
		];

		for (const surface of surfaces) {
			expect(surface).not.toContain(PLATFORM_KEY);
		}
	});
});

describe("the unavailable result", () => {
	it("says retrying will not help", () => {
		const result = unavailable(CONTEXT_DEV_PEOPLE);

		expect(result.ok).toBe(false);
		expect(result.configured).toBe(false);
		expect(result.reason).toContain("retrying will not help");
		expect(result.reason).toContain(
			"LinkedIn is not configured on this install",
		);
	});

	it("names no variable and no settings page", () => {
		for (const id of [
			PERPLEXITY,
			CONTEXT_DEV,
			CONTEXT_DEV_PEOPLE,
			CONTEXT_DEV_SEARCH,
		]) {
			const { reason } = unavailable(id);

			expect(reason).not.toContain("API_KEY");
			expect(reason).not.toContain("Settings");
		}
	});
});

describe("the capability briefing", () => {
	it("tells a bare install to work from the CRM alone", () => {
		const markdown = capabilitiesMarkdown();

		expect(markdown).toContain("No outside sources are configured");
		expect(markdown).toContain("read_crm_history");
	});

	it("lists what is on and what is off, separately", () => {
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;

		const markdown = capabilitiesMarkdown();

		expect(markdown).toContain("Available:");
		expect(markdown).toContain("LinkedIn");
		expect(markdown).toContain("Not configured here");
		expect(markdown).toContain("Web research");
		expect(markdown.indexOf("Company brand data")).toBeLessThan(
			markdown.indexOf("Not configured here"),
		);
	});

	it("does not warn about missing sources when everything is on", () => {
		for (const key of KEYS) process.env[key] = "key";

		expect(capabilitiesMarkdown()).not.toContain("Not configured here");
	});
});

describe("the boot log", () => {
	it("reports the Context sources on when the platform key is set", () => {
		process.env.CONTEXT_DEV_API_KEY = PLATFORM_KEY;

		const lines = bootLines();

		expect(lines).toContain(
			"[agent] on   Company brand data (CONTEXT_DEV_API_KEY)",
		);
		expect(lines).toContain("[agent] on   LinkedIn (CONTEXT_DEV_API_KEY)");
		expect(lines).toContain("[agent] off  Web research (PERPLEXITY_API_KEY)");
	});

	it("reports the Context sources off when the platform key is not set", () => {
		expect(bootLines()).toContain(
			"[agent] off  Company brand data (CONTEXT_DEV_API_KEY)",
		);
	});
});
