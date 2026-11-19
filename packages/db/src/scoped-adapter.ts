import type {
	IsolationLevel,
	SqlDriverAdapter,
	SqlMigrationAwareDriverAdapterFactory,
	SqlQuery,
	SqlResultSet,
	Transaction,
} from "@prisma/driver-adapter-utils";
import { currentScope, type DbScope, runInScope, scopeKey } from "./tenancy";

export const TENANT_ROLE = "crm_tenant";

export const ORGANIZATION_SETTING = "crm.organization_id";

const control = (sql: string): SqlQuery => ({ sql, args: [], argTypes: [] });

export const SCOPE_SQL = `SELECT set_config('role', '${TENANT_ROLE}', true), set_config('${ORGANIZATION_SETTING}', $1, true)`;

function scopeStatement(scope: DbScope | undefined): SqlQuery {
	return {
		sql: SCOPE_SQL,
		args: [scope?.kind === "tenant" ? scope.organizationId : ""],
		argTypes: [{ scalarType: "string", arity: "scalar" }],
	};
}

function bypassesRowSecurity(scope: DbScope | undefined): boolean {
	return scope?.kind === "system";
}

async function scopedTransaction(
	inner: SqlDriverAdapter,
	scope: DbScope | undefined,
	isolationLevel?: IsolationLevel,
): Promise<Transaction> {
	const tx = await inner.startTransaction(isolationLevel);
	if (bypassesRowSecurity(scope)) return tx;

	try {
		await tx.executeRaw(scopeStatement(scope));
	} catch (error) {
		await abandon(tx);
		throw error;
	}
	return tx;
}

async function abandon(tx: Transaction): Promise<void> {
	try {
		await tx.executeRaw(control("ROLLBACK"));
	} finally {
		await tx.rollback();
	}
}

async function inOwnTransaction<T>(
	inner: SqlDriverAdapter,
	run: (queryable: SqlDriverAdapter | Transaction) => Promise<T>,
): Promise<T> {
	const scope = currentScope();
	if (bypassesRowSecurity(scope)) return run(inner);

	const tx = await scopedTransaction(inner, scope);
	let result: T;
	try {
		result = await run(tx);
	} catch (error) {
		await abandon(tx);
		throw error;
	}
	try {
		await tx.executeRaw(control("COMMIT"));
	} catch (error) {
		await abandon(tx);
		throw error;
	}
	await tx.commit();
	return result;
}

function scopedAdapter(inner: SqlDriverAdapter): SqlDriverAdapter {
	return {
		provider: inner.provider,
		adapterName: inner.adapterName,
		queryRaw: (query: SqlQuery): Promise<SqlResultSet> =>
			inOwnTransaction(inner, (queryable) => queryable.queryRaw(query)),
		executeRaw: (query: SqlQuery): Promise<number> =>
			inOwnTransaction(inner, (queryable) => queryable.executeRaw(query)),
		executeScript: (script: string) => inner.executeScript(script),
		startTransaction: (isolationLevel?: IsolationLevel) =>
			scopedTransaction(inner, currentScope(), isolationLevel),
		getConnectionInfo: inner.getConnectionInfo
			? () => inner.getConnectionInfo?.() ?? { supportsRelationJoins: true }
			: undefined,
		dispose: () => inner.dispose(),
	};
}

export function scopedAdapterFactory(
	inner: SqlMigrationAwareDriverAdapterFactory,
): SqlMigrationAwareDriverAdapterFactory {
	return {
		provider: inner.provider,
		adapterName: inner.adapterName,
		connect: async () => scopedAdapter(await inner.connect()),
		connectToShadowDb: async () =>
			scopedAdapter(await inner.connectToShadowDb()),
	};
}

const SCOPE = Symbol("crm.dbScope");

type QueuedRequest = { [SCOPE]?: DbScope | undefined };

type LoaderOptions = {
	batchBy: (request: QueuedRequest) => string | undefined;
	singleLoader: (request: QueuedRequest) => Promise<unknown>;
	batchLoader: (requests: QueuedRequest[]) => Promise<unknown>;
};

type ClientInternals = {
	_requestHandler?: { dataloader?: { options?: Partial<LoaderOptions> } };
};

function loaderOptions(client: object): LoaderOptions {
	const options = (client as ClientInternals)._requestHandler?.dataloader
		?.options;

	if (
		typeof options?.batchBy !== "function" ||
		typeof options.singleLoader !== "function" ||
		typeof options.batchLoader !== "function"
	) {
		throw new Error(
			"Prisma's request batcher is not where @crm/db expects it. Tenant isolation depends on keeping batched queries in their own scope, so the client refuses to start. Check packages/db/src/scoped-adapter.ts against the installed Prisma version.",
		);
	}

	return options as LoaderOptions;
}

export function isolateBatchesByScope(client: object): void {
	const options = loaderOptions(client);
	const { batchBy, singleLoader, batchLoader } = options;

	options.batchBy = (request) => {
		request[SCOPE] = currentScope();
		const key = batchBy(request);
		return key === undefined ? undefined : `${key}#${scopeKey(request[SCOPE])}`;
	};
	options.singleLoader = (request) =>
		runInScope(request[SCOPE], () => singleLoader(request));
	options.batchLoader = (requests) =>
		runInScope(requests[0]?.[SCOPE], () => batchLoader(requests));
}
