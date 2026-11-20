import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseEnv } from "@crm/env";
import {
	DATABASE_HOST,
	databaseHost,
	isLocalHost,
	parseDevHosts,
} from "../src/database-host";

const ROOT_ENV_FILES = [".env.local", ".env"] as const;

const command = process.argv[2] ?? "this command";
const rootEnv = readRootEnv();
const resolved = resolveDatabaseUrl();

if (!resolved) {
	console.error(
		`\n  ${command} needs DATABASE_URL, and nothing set it.` +
			"\n  Copy .env.example to .env at the repo root.\n",
	);
	process.exit(1);
}

const host = databaseHost(resolved.url);

if (isLocalHost(host)) process.exit(0);

if (devHosts().includes(host.toLowerCase())) {
	console.warn(
		`\n  ${command} is running against ${host}, a development database named in ${DATABASE_HOST.devHostsVariable}.\n`,
	);
	process.exit(0);
}

if (process.env.ALLOW_REMOTE_DB === "1") {
	console.warn(`\n  ⚠ ${command} is running against ${host} — not local.\n`);
	process.exit(0);
}

console.error(
	[
		"",
		`  Refusing to run ${command} against ${host}.`,
		"",
		`  That is not a local database, and ${command} can rewrite or drop`,
		`  schemas. The value came from ${resolved.from}.`,
		"",
		resolved.from.endsWith(".env.local")
			? [
					"  `.env.local` overrides `.env`, and `vercel env pull` writes",
					"  production credentials into it. Either remove DATABASE_URL from",
					"  that file, or pull Vercel's environment somewhere inert:",
					"",
					"    vercel env pull .env.vercel",
				].join("\n")
			: "  Check which file is winning:  grep -m1 DATABASE_URL .env .env.local",
		"",
		"  To do this deliberately anyway:",
		"",
		`    ALLOW_REMOTE_DB=1 bun run ${command}`,
		"",
		"  If this host is a development database, name it in .env:",
		"",
		`    ${DATABASE_HOST.devHostsVariable}="${host}"`,
		"",
	].join("\n"),
);

process.exit(1);

type RootEnvFile = { file: string; values: Record<string, string> };

function readRootEnv(): RootEnvFile[] {
	const root = workspaceRoot();
	if (!root) return [];

	const files: RootEnvFile[] = [];
	for (const file of ROOT_ENV_FILES) {
		try {
			files.push({
				file,
				values: parseEnv(readFileSync(join(root, file), "utf8")),
			});
		} catch {}
	}
	return files;
}

function resolveDatabaseUrl(): { url: string; from: string } | null {
	for (const { file, values } of rootEnv) {
		if (values.DATABASE_URL) return { url: values.DATABASE_URL, from: file };
	}

	const fromEnvironment = process.env.DATABASE_URL;
	return fromEnvironment
		? { url: fromEnvironment, from: "the environment" }
		: null;
}

function devHosts(): string[] {
	const declared = rootEnv.find(
		({ values }) => values[DATABASE_HOST.devHostsVariable] !== undefined,
	);
	return parseDevHosts(declared?.values[DATABASE_HOST.devHostsVariable]);
}

function workspaceRoot(): string | null {
	let directory = process.cwd();

	while (true) {
		try {
			const manifest = JSON.parse(
				readFileSync(join(directory, "package.json"), "utf8"),
			) as { workspaces?: unknown };
			if (manifest.workspaces) return directory;
		} catch {}

		const parent = dirname(directory);
		if (parent === directory) return null;
		directory = parent;
	}
}
