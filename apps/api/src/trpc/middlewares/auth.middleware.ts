import {
	NO_WORKSPACE_MESSAGE,
	WORKSPACE_HEADER,
} from "@crm/auth/workspace-header";
import type { Db } from "@crm/db";
import { runInTenant } from "@crm/db/tenancy";
import { Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";
import { InjectDatabase } from "../../database/database.constants";
import {
	setRequestOrganizationId,
	setRequestUserId,
} from "../../logging/request-context";
import { sessionOrganizationId } from "../../tenancy/session-organization";
import {
	readRequestedSlug,
	resolveWorkspace,
} from "../../tenancy/workspace-resolver";
import type {
	AuthedTrpcContext,
	BaseTrpcContext,
	UserTrpcContext,
} from "../context.types";

function signedInUser(ctx: BaseTrpcContext) {
	const user = ctx.session?.user;
	if (!user) throw new TRPCError({ code: "UNAUTHORIZED" });
	setRequestUserId(user.id);
	return user;
}

@Injectable()
export class UserMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const nextCtx: UserTrpcContext = { ...ctx, user: signedInUser(ctx) };
		return opts.next({ ctx: nextCtx });
	}
}

@Injectable()
export class AuthMiddleware implements TRPCMiddleware {
	constructor(@InjectDatabase() private readonly db: Db) {}

	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const ctx = opts.ctx as BaseTrpcContext;
		const user = signedInUser(ctx);

		const resolution = await resolveWorkspace(this.db, {
			userId: user.id,
			requestedSlug: readRequestedSlug(ctx.req?.headers[WORKSPACE_HEADER]),
			sessionOrganizationId: sessionOrganizationId(ctx.session),
		});

		if (resolution.kind === "no-workspace") {
			throw new TRPCError({
				code: "PRECONDITION_FAILED",
				message: NO_WORKSPACE_MESSAGE,
			});
		}

		if (resolution.kind === "not-a-member") {
			throw new TRPCError({
				code: "FORBIDDEN",
				message: "You are not a member of that workspace.",
			});
		}

		const { workspace } = resolution;
		setRequestOrganizationId(workspace.id);

		const nextCtx: AuthedTrpcContext = { ...ctx, user, workspace };
		return runInTenant(workspace.id, () => opts.next({ ctx: nextCtx }));
	}
}
