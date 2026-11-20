import { AsyncLocalStorage } from "node:async_hooks";

export type TenantScope = {
	kind: "tenant";
	organizationId: string;
};

export type SystemScope = {
	kind: "system";
	reason: string;
};

export type DbScope = TenantScope | SystemScope;

const ORGANIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;

const UNSCOPED: unique symbol = Symbol.for("crm.unscoped");

type StoredScope = DbScope | typeof UNSCOPED;

type TenancyState = {
	storage: AsyncLocalStorage<StoredScope>;
	testFallback: TenantScope | undefined;
};

declare global {
	var crmTenancy: TenancyState | undefined;
}

globalThis.crmTenancy ??= {
	storage: new AsyncLocalStorage<StoredScope>(),
	testFallback: undefined,
};

const state: TenancyState = globalThis.crmTenancy;

const storage = state.storage;

export class TenancyError extends Error {
	override readonly name = "TenancyError";
}

export function isOrganizationId(value: string): boolean {
	return ORGANIZATION_ID.test(value);
}

function tenantScope(organizationId: string): TenantScope {
	if (!isOrganizationId(organizationId)) {
		throw new TenancyError(
			`"${organizationId.slice(0, 40)}" is not an organization id.`,
		);
	}
	return { kind: "tenant", organizationId };
}

export function currentScope(): DbScope | undefined {
	const stored = storage.getStore();
	if (stored === UNSCOPED) return undefined;
	return stored ?? state.testFallback;
}

export function currentOrganizationId(): string | undefined {
	const scope = currentScope();
	return scope?.kind === "tenant" ? scope.organizationId : undefined;
}

export function useTestFallbackTenant(organizationId: string | null): void {
	if (process.env.NODE_ENV !== "test") {
		throw new TenancyError(
			"A fallback tenant exists only for the test suite. Production code must scope every query explicitly.",
		);
	}
	state.testFallback = organizationId ? tenantScope(organizationId) : undefined;
}

export function requireOrganizationId(): string {
	const organizationId = currentOrganizationId();
	if (!organizationId) {
		throw new TenancyError(
			"This code reads tenant data but runs outside an organization scope. Wrap the caller in runInTenant().",
		);
	}
	return organizationId;
}

export async function runInTenant<T>(
	organizationId: string,
	fn: () => T | Promise<T>,
): Promise<T> {
	return storage.run(tenantScope(organizationId), async () => await fn());
}

export async function runAsSystem<T>(
	reason: string,
	fn: () => T | Promise<T>,
): Promise<T> {
	return storage.run({ kind: "system", reason }, async () => await fn());
}

export async function runUnscoped<T>(fn: () => T | Promise<T>): Promise<T> {
	return storage.run(UNSCOPED, async () => await fn());
}

export function runInScope<T>(scope: DbScope | undefined, fn: () => T): T {
	return storage.run(scope ?? UNSCOPED, fn);
}

export function scopeKey(scope: DbScope | undefined): string {
	if (!scope) return "none";
	return scope.kind === "tenant" ? `tenant:${scope.organizationId}` : "system";
}
