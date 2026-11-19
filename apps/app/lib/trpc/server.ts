import "server-only";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { createTRPCClient, httpBatchLink, type TRPCClient } from "@trpc/client";
import {
	createTRPCOptionsProxy,
	type TRPCOptionsProxy,
} from "@trpc/tanstack-react-query";
import type { AppRouter } from "api/app-router";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import { API_URL } from "@/lib/env";
import { makeQueryClient } from "./query-client";

export const getServerQueryClient = cache(makeQueryClient);

export function getServerTrpcClient(): TRPCClient<AppRouter> {
	return createTRPCClient<AppRouter>({
		links: [
			httpBatchLink({
				url: `${API_URL}/api/trpc`,
				headers: async () => {
					const cookie = (await cookies()).toString();
					const workspace = (await headers()).get(WORKSPACE_HEADER);
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
