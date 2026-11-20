import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "@crm/env";
import { z } from "zod";
import type { GuardSource } from "../src/database-guard";

const ROOT_ENV_FILES = [".env.local", ".env"] as const;

const manifest = z.object({ workspaces: z.unknown().optional() });

export function guardSources(): GuardSource[] {
	const sources: GuardSource[] = [
		{ from: "the environment", values: process.env },
	];

	const root = workspaceRoot();
	if (!root) return sources;

	for (const file of ROOT_ENV_FILES) {
		try {
			sources.push({
				from: file,
				values: parseEnv(readFileSync(join(root, file), "utf8")),
			});
		} catch {}
	}

	return sources;
}

function workspaceRoot(): string | null {
	let directory = process.cwd();

	while (true) {
		try {
			const parsed = manifest.safeParse(
				JSON.parse(readFileSync(join(directory, "package.json"), "utf8")),
			);
			if (parsed.success && parsed.data.workspaces) return directory;
		} catch {}

		const parent = dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}
