"use client";

import { Button } from "@crm/ui/components/button";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyTitle,
} from "@crm/ui/components/empty";
import { Kanban, KanbanSkeleton } from "@crm/ui/components/kanban";
import { MetaRow } from "@crm/ui/components/meta-row";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { IndicatorDot } from "@crm/ui/components/status-indicator";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import Link from "next/link";
import { parseAsBoolean, parseAsString, useQueryStates } from "nuqs";
import { toast } from "sonner";
import { usePrefetchRecord } from "@/components/crm/record-sheet/record-prefetch";
import { useOpenRecord } from "@/components/crm/record-sheet/record-stack";
import { useCloseReason } from "@/components/crm/stage-change";
import { ListSearch } from "@/components/data-table/list-search";
import { useTableQuery } from "@/components/data-table/use-table-query";
import { isLostStage, isOpenStage, stageTone } from "@/lib/deal-stage";
import { usePipeline } from "@/lib/pipeline";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { useWorkspaceUrl } from "@/lib/use-workspace-url";
import { DealCard } from "./deal-card";
import { type DealBoardColumn, findCard, moveCard } from "./deals-board-state";
import { dealsSearchParams } from "./deals-search-params";
import { DealsViewToggle } from "./deals-view-toggle";

const EVERYONE = "everyone";

const createParams = {
	[SEARCH_PARAM.dialog.create]: parseAsBoolean,
	[SEARCH_PARAM.dialog.createStage]: parseAsString,
};

export function DealsBoard() {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const cache = useCrmCache();
	const openRecord = useOpenRecord();
	const prefetchRecord = usePrefetchRecord();
	const askWhy = useCloseReason();
	const workspaceUrl = useWorkspaceUrl();
	const { stages } = usePipeline();
	const { query, input } = useTableQuery(dealsSearchParams);
	const [, setCreate] = useQueryStates(createParams);

	const options = trpc.deals.board.queryOptions({
		q: input.q,
		owner: input.owner,
	});
	const board = useQuery({
		...options,
		placeholderData: (previous) => previous,
	});
	const users = useQuery(trpc.users.list.queryOptions());

	const setStage = useMutation(
		trpc.deals.setStage.mutationOptions({
			onSettled: () => cache.deal(),
		}),
	);

	const toolbar = (
		<div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
				<ListSearch placeholder="Search deals…" />
				<Select
					value={input.owner[0] ?? EVERYONE}
					onValueChange={(next) =>
						query.setFilter("owner", next === EVERYONE ? [] : [next])
					}
				>
					<SelectTrigger aria-label="Owner">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						<SelectItem value={EVERYONE}>All owners</SelectItem>
						{(users.data ?? []).map((user) => (
							<SelectItem key={user.id} value={user.id}>
								{user.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>
			<DealsViewToggle />
		</div>
	);

	if (board.isError && !board.data) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				{toolbar}
				<Empty>
					<EmptyHeader>
						<EmptyTitle>The board did not load</EmptyTitle>
						<EmptyDescription>{board.error.message}</EmptyDescription>
					</EmptyHeader>
					<Button variant="outline" size="sm" onClick={() => board.refetch()}>
						Try again
					</Button>
				</Empty>
			</div>
		);
	}

	if (!board.data) {
		return (
			<div className="flex min-h-0 flex-1 flex-col gap-3">
				{toolbar}
				<span className="sr-only" role="status">
					Loading the pipeline
				</span>
				<KanbanSkeleton />
			</div>
		);
	}

	const data = board.data;
	const columnById = new Map<string, DealBoardColumn>(
		data.columns.map((column) => [column.stage.id, column]),
	);
	const total = data.columns.reduce((sum, column) => sum + column.count, 0);

	const move = (
		dealId: string,
		toStageId: string,
		index: number,
		placement?: { afterId: string | null; beforeId: string | null },
	) => {
		const found = findCard(data, dealId);
		const target = columnById.get(toStageId);
		if (!found || !target) return;

		if (found.column.stage.id !== toStageId && isLostStage(target.stage)) {
			void askWhy(dealId, toStageId);
			return;
		}

		const previous = queryClient.getQueryData(options.queryKey);
		void queryClient.cancelQueries({ queryKey: options.queryKey });
		queryClient.setQueryData(options.queryKey, (current) =>
			current ? moveCard(current, { dealId, toStageId, index }) : current,
		);

		setStage.mutate(
			{ id: dealId, stageId: toStageId, placement },
			{
				onError: (error) => {
					queryClient.setQueryData(options.queryKey, previous);
					toast.error(error.message);
				},
			},
		);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-3">
			{toolbar}
			<Kanban
				label="Deals pipeline"
				columns={data.columns.map((column) => ({
					id: column.stage.id,
					label: column.stage.label,
					itemIds: column.deals.map((deal) => deal.id),
				}))}
				itemLabel={(dealId) => findCard(data, dealId)?.card.name ?? "the deal"}
				onMove={(change) =>
					move(change.itemId, change.toColumnId, change.index, {
						afterId: change.afterId,
						beforeId: change.afterId ? null : change.beforeId,
					})
				}
				renderHeader={(stageId) => {
					const column = columnById.get(stageId);
					if (!column) return null;
					return (
						<>
							<div className="flex min-w-0 flex-1 flex-col gap-1">
								<h2 className="flex min-w-0 items-center gap-2 font-medium text-sm">
									<IndicatorDot tone={stageTone(column.stage)} aria-hidden />
									<span className="truncate">{column.stage.label}</span>
								</h2>
								<MetaRow>
									<span>
										{column.count} {column.count === 1 ? "deal" : "deals"}
									</span>
									<span className="tabular-nums">
										{formatMoney(column.valueCents, data.reportingCurrency)}
									</span>
								</MetaRow>
							</div>
							{isOpenStage(column.stage) ? (
								<Button
									variant="ghost"
									size="icon-xs"
									onClick={() =>
										setCreate({
											[SEARCH_PARAM.dialog.create]: true,
											[SEARCH_PARAM.dialog.createStage]: stageId,
										})
									}
								>
									<PlusIcon />
									<span className="sr-only">
										Add a deal in {column.stage.label}
									</span>
								</Button>
							) : null}
						</>
					);
				}}
				renderCard={(dealId) => {
					const found = findCard(data, dealId);
					if (!found) return null;
					const record = { kind: "deal" as const, id: dealId };
					return (
						<DealCard
							deal={found.card}
							stageId={found.column.stage.id}
							stages={stages}
							onPrefetch={() => prefetchRecord(record)}
							onOpen={() =>
								openRecord(
									record,
									found.column.deals.map((deal) => ({
										kind: "deal",
										id: deal.id,
									})),
								)
							}
							onMoveTo={(stageId) => move(dealId, stageId, 0)}
						/>
					);
				}}
				renderEmpty={() => (total === 0 ? "No deals yet" : "No deals here")}
				renderFooter={(stageId) => {
					const column = columnById.get(stageId);
					if (!column || column.count <= column.deals.length) return null;
					return (
						<Link
							href={`${workspaceUrl("/deals")}?${SEARCH_PARAM.deals.view}=table&stage=${stageId}`}
							className="text-muted-foreground hover:text-foreground hover:underline"
						>
							Show all {column.count} in the table
						</Link>
					);
				}}
			/>
			{data.unconverted.count > 0 ? (
				<MetaRow>
					<span>
						{data.unconverted.count} not counted in the totals (no{" "}
						{data.unconverted.currencies.join(", ")} rate)
					</span>
				</MetaRow>
			) : null}
		</div>
	);
}
