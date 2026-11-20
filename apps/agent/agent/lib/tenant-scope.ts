import { isOrganizationId, runInTenant } from "@crm/db/tenancy";
import { researchUser } from "./research/meter";
import { attribute } from "./session-purpose";

export const ORGANIZATION_ATTRIBUTE = "organizationId";

type SessionAttributes = Readonly<Record<string, string | readonly string[]>>;

type ScopedContext = {
	readonly session: {
		readonly auth: {
			readonly current: { readonly attributes: SessionAttributes } | null;
			readonly initiator: { readonly attributes: SessionAttributes } | null;
		};
	};
};

export class MissingOrganizationError extends Error {
	override readonly name = "MissingOrganizationError";
}

export function organizationOf(ctx: ScopedContext): string | null {
	const value = attribute(ctx, ORGANIZATION_ATTRIBUTE);
	return value && isOrganizationId(value) ? value : null;
}

export function requireOrganizationOf(ctx: ScopedContext): string {
	const organizationId = organizationOf(ctx);
	if (!organizationId) {
		throw new MissingOrganizationError(
			"This session does not say which workspace it works for, so it may not read or write CRM data.",
		);
	}
	return organizationId;
}

export async function inSessionTenant<T>(
	ctx: ScopedContext,
	fn: () => T | Promise<T>,
): Promise<T> {
	return researchUser.run(attribute(ctx, "userId"), () =>
		runInTenant(requireOrganizationOf(ctx), fn),
	);
}

export async function inSessionTenantOrSkip(
	ctx: ScopedContext,
	what: string,
	fn: () => Promise<void>,
): Promise<void> {
	const organizationId = organizationOf(ctx);
	if (!organizationId) {
		console.warn(
			`[agent] ${what} skipped: the session names no workspace, so it may not touch CRM data`,
		);
		return;
	}
	await runInTenant(organizationId, fn);
}
