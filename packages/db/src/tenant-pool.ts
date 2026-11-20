import pg from "pg";
import { z } from "zod";
import { DB_POOL } from "./pool-config";
import { ORGANIZATION_SETTING, SCOPE_SQL, TENANT_ROLE } from "./scoped-adapter";
import { isOrganizationId } from "./tenancy";

const DEFERRED = Symbol("crm.deferredBegin");

type FusedClient = pg.PoolClient & { [DEFERRED]?: boolean };

const EMPTY: pg.QueryResult = {
	command: "BEGIN",
	rowCount: 0,
	oid: 0,
	rows: [],
	fields: [],
};

const statementText = z.union([
	z.string(),
	z.object({ text: z.string() }).transform((statement) => statement.text),
]);

const scopeStatement = z.object({
	text: z.literal(SCOPE_SQL),
	values: z.tuple([
		z.union([
			z.literal(""),
			z.string().refine(isOrganizationId, "not a workspace id"),
		]),
	]),
});

function fusedScopeSql(client: pg.PoolClient, organizationId: string): string {
	return `BEGIN; SELECT set_config('role', '${TENANT_ROLE}', true), set_config('${ORGANIZATION_SETTING}', ${client.escapeLiteral(organizationId)}, true)`;
}

export function fuseScopeIntoBegin(client: pg.PoolClient): void {
	const fused = client as FusedClient;
	const query = client.query.bind(client) as (
		...args: unknown[]
	) => Promise<pg.QueryResult | pg.QueryResult[]>;

	const replacement = (...args: unknown[]) => {
		if (args.length !== 1) return query(...args);
		const [config] = args;

		const parsedText = statementText.safeParse(config);
		const text = parsedText.success ? parsedText.data : null;
		if (text === "BEGIN" && !fused[DEFERRED]) {
			fused[DEFERRED] = true;
			return Promise.resolve(EMPTY);
		}
		if (!fused[DEFERRED]) return query(...args);

		fused[DEFERRED] = false;
		if (text === "COMMIT" || text === "ROLLBACK") {
			return Promise.resolve({ ...EMPTY, command: text });
		}

		const scope = scopeStatement.safeParse(config);
		if (scope.success) {
			const [organizationId] = scope.data.values;
			return query(fusedScopeSql(client, organizationId)).then((results) =>
				Array.isArray(results) ? (results.at(-1) ?? EMPTY) : results,
			);
		}

		return query("BEGIN").then(() => query(...args));
	};

	client.query = replacement as typeof client.query;
	client.on("end", () => {
		fused[DEFERRED] = false;
	});
}

function positiveInteger(name: string, fallback: number): number {
	const value = Number(process.env[name]);
	return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function createTenantPool(connectionString: string): pg.Pool {
	const pool = new pg.Pool({
		connectionString,
		max: positiveInteger(DB_POOL.env.max, DB_POOL.max),
		idleTimeoutMillis: positiveInteger(
			DB_POOL.env.idleTimeoutMs,
			DB_POOL.idleTimeoutMs,
		),
		connectionTimeoutMillis: positiveInteger(
			DB_POOL.env.connectionTimeoutMs,
			DB_POOL.connectionTimeoutMs,
		),
	});
	pool.on("connect", fuseScopeIntoBegin);
	pool.on("release", (_error, client) => {
		(client as FusedClient)[DEFERRED] = false;
	});
	return pool;
}
