import { DATABASE_GUARD, guardDeployCommand } from "../src/database-guard";
import { guardSources } from "./guard-env";

const decisions = guardDeployCommand(guardSources());

if (decisions.length === 0) {
	console.error(
		"\n  db:deploy needs DATABASE_URL, and nothing set it." +
			"\n  Copy .env.example to .env at the repo root.\n",
	);
	process.exit(1);
}

const refused = decisions.find((decision) => !decision.allowed);

if (refused) {
	const { target, reason } = refused;
	console.error(
		[
			"",
			`  Refusing to run db:deploy against ${target.host}.`,
			`  The value came from ${target.from}.`,
			"",
			reason === "protected-branch"
				? `  ${DATABASE_GUARD.branchVariable} is "${target.branch}", a protected Neon branch.`
				: `  That host is listed in ${DATABASE_GUARD.protectedHostsVariable}.`,
			"  A release applies production migrations during the API build.",
			"",
			"  To apply them by hand, after a backup:",
			"",
			`    ${DATABASE_GUARD.allowProductionMigrateVariable}=1 bun run db:deploy`,
			"",
		].join("\n"),
	);
	process.exit(1);
}

for (const { target, reason } of decisions) {
	console.warn(
		reason === "unprotected"
			? `\n  db:deploy targets ${target.host}.\n`
			: `\n  ⚠ db:deploy targets the protected database ${target.host}.\n`,
	);
}
