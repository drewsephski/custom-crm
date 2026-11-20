import {
	DATABASE_GUARD,
	type GuardDecision,
	guardDevelopmentCommand,
} from "../src/database-guard";
import { guardSources } from "./guard-env";

const command = process.argv[2] ?? "this command";
const decisions = guardDevelopmentCommand(guardSources());

if (decisions.length === 0) {
	console.error(
		`\n  ${command} needs DATABASE_URL, and nothing set it.` +
			"\n  Copy .env.example to .env at the repo root.\n",
	);
	process.exit(1);
}

const refused = decisions.find((decision) => !decision.allowed);

if (refused) {
	console.error(refusal(refused));
	process.exit(1);
}

for (const decision of decisions) {
	if (decision.reason === "development") {
		console.warn(
			`\n  ${command} is running against ${decision.target.host}, a development database named in ${DATABASE_GUARD.devHostsVariable}.\n`,
		);
	}
	if (decision.reason === "override") {
		console.warn(
			`\n  ⚠ ${command} is running against ${decision.target.host} — not local.\n`,
		);
	}
}

function refusal({ reason, target }: GuardDecision): string {
	const head = [
		"",
		`  Refusing to run ${command} against ${target.host}.`,
		`  The value came from ${target.from}.`,
		"",
	];

	if (reason === "protected-branch") {
		return [
			...head,
			`  ${DATABASE_GUARD.branchVariable} is "${target.branch}", a protected Neon branch.`,
			`  ${command} can rewrite or drop schemas. No override exists for it.`,
			"",
			"  Work on a development branch instead:",
			"",
			"    neon checkout development",
			"",
			"  Migrations reach production through `bun run db:deploy` on a release.",
			"",
		].join("\n");
	}

	if (reason === "protected-host") {
		return [
			...head,
			`  That host is listed in ${DATABASE_GUARD.protectedHostsVariable}.`,
			`  ${command} can rewrite or drop schemas. No override exists for it.`,
			"",
		].join("\n");
	}

	return [
		...head,
		`  That is not a local database, and ${command} can rewrite or drop schemas.`,
		"",
		target.from.endsWith(".env.local")
			? [
					"  `.env.local` overrides `.env`, and `vercel env pull` writes",
					"  production credentials into it. Either remove DATABASE_URL from",
					"  that file, or pull Vercel's environment somewhere inert:",
					"",
					"    vercel env pull .env.vercel",
				].join("\n")
			: "  Check which file is winning:  grep -m1 DATABASE_URL .env .env.local",
		"",
		"  If this host is a development database, name it in .env:",
		"",
		`    ${DATABASE_GUARD.devHostsVariable}="${target.host}"`,
		"",
		"  To do this deliberately anyway:",
		"",
		`    ${DATABASE_GUARD.allowRemoteVariable}=1 bun run ${command}`,
		"",
	].join("\n");
}
