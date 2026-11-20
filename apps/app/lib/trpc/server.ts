import "server-only";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { apiServiceUrl } from "@crm/env/service-urls";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import {
	createTRPCOptionsProxy,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { makeQueryClient } from "./query-client";

export const getServerQueryClient = cache(makeQueryClient);

export function getServerTrpcClient(scope?: {
	cookie: string;
	workspace: string;
}): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: apiServiceUrl("/api/trpc").href,
				headers: async () => {
					const cookie = scope?.cookie ?? (await cookies()).toString();
					const workspace =
						scope?.workspace ?? (await headers()).get(WORKSPACE_HEADER);
					return {
						...(cookie && { cookie }),
						...(workspace && { [WORKSPACE_HEADER]: workspace }),
					};
				},
			}),
		],
	});
}

export function getServerTrpc(): TRPCOptionsProxy<AppRouter> {
	const client = getServerTrpcClient();

	return createTRPCOptionsProxy<AppRouter>({
		client,
		queryClient: getServerQueryClient,
	});
}
