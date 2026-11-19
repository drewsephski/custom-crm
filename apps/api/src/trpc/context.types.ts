import type { Session, SessionUser } from "@crm/auth/auth";
import type { Request } from "express";
import type { ActiveWorkspace } from "../tenancy/workspace-resolver";

export type BaseTrpcContext = {
	req?: Request;
	session: Session | null;
};

export type UserTrpcContext = BaseTrpcContext & {
	user: SessionUser;
};

export type AuthedTrpcContext = UserTrpcContext & {
	workspace: ActiveWorkspace;
};
