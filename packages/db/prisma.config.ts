import "@crm/env/load";

import path from "node:path";
import { defineConfig, env } from "prisma/config";
import { directDatabaseUrl } from "./src/database-host";

export default defineConfig({
	schema: path.join("prisma", "schema.prisma"),
	migrations: {
		path: path.join("prisma", "migrations"),
		seed: "bun run prisma/seed.ts",
	},
	datasource: {
		url: directDatabaseUrl(env("DATABASE_URL")),
	},
});
