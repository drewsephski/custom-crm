"use client";

import { useMountEffect } from "@crm/ui/hooks/use-mount-effect";
import {
	createRealtimeClient,
	type SealedLiveQuery,
} from "@neon/realtime/client";
import { RealtimeProvider, useLiveQuery } from "@neon/realtime-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type MembershipLive = NonNullable<RouterOutputs["workspace"]["membersLive"]>;

type MembershipSignal = { id: string; state: string };

function signature(
	rows: readonly MembershipSignal[] | undefined,
): string | null {
	if (rows === undefined) return null;

	return rows
		.map((row) => `${row.id}=${row.state}`)
		.sort()
		.join("|");
}

export function MembersLive() {
	const trpc = useTRPC();
	const live = useQuery({
		...trpc.workspace.membersLive.queryOptions(),
		staleTime: 0,
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
	});

	if (!live.data) return null;

	return <MembersLiveConnection key={live.data.url} live={live.data} />;
}

function MembersLiveConnection({ live }: { live: MembershipLive }) {
	const [client] = useState(() => createRealtimeClient({ url: live.url }));
	const [sealedQuery] = useState<SealedLiveQuery<MembershipSignal>>(
		() => live.sealedQuery,
	);

	return (
		<RealtimeProvider client={client}>
			<MembershipSubscription sealedQuery={sealedQuery} />
		</RealtimeProvider>
	);
}

function MembershipSubscription({
	sealedQuery,
}: {
	sealedQuery: SealedLiveQuery<MembershipSignal>;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const cache = useCrmCache();

	const { utils } = useLiveQuery(sealedQuery, {
		refreshQuery: async () => {
			const next = await queryClient.fetchQuery({
				...trpc.workspace.membersLive.queryOptions(),
				staleTime: 0,
			});
			if (!next) throw new Error("Live updates are off.");
			return next.sealedQuery;
		},
	});

	useMountEffect(() => {
		let previous = signature(utils.getSnapshot().data);

		return utils.onUpdate(() => {
			const next = signature(utils.getSnapshot().data);
			if (next === previous) return;

			const isFirstResult = previous === null;
			previous = next;
			if (isFirstResult) return;

			void cache.workspace();
			void queryClient.invalidateQueries({
				queryKey: trpc.workspace.invitations.queryKey(),
			});
		});
	});

	return null;
}
