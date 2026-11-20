import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";
import { directDatabaseUrl } from "./src/database-host";

function migrationUrl() {
	const runtime = new URL(directDatabaseUrl(env("DATABASE_URL")));
	const configured = process.env.DATABASE_URL_UNPOOLED?.trim();
	if (!configured) return runtime.toString();
	const direct = new URL(configured);
	if (
		direct.host !== runtime.host ||
		direct.pathname !== runtime.pathname ||
		direct.protocol !== runtime.protocol
	)
		throw new Error(
			"DATABASE_URL_UNPOOLED must identify the same database and direct endpoint as DATABASE_URL.",
		);
	return direct.toString();
}

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: migrationUrl(),
	},
});
