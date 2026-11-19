"use client";

import { Button } from "@crm/ui/components/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Input } from "@crm/ui/components/input";
import { MetaRow } from "@crm/ui/components/meta-row";
import { formatMoney } from "@crm/ui/lib/format";
import { useMutation } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { CompanyCell } from "@/components/crm/company-cell";
import { OwnerCell } from "@/components/crm/owner-cell";
import { LocalDay } from "@/components/local-date-time";
import type { PipelineStage } from "@/lib/pipeline";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { DealBoardCard } from "./deals-board-state";

export function DealCard({
	deal,
	stageId,
	stages,
	onOpen,
	onPrefetch,
	onMoveTo,
}: {
	deal: DealBoardCard;
	stageId: string;
	stages: PipelineStage[];
	onOpen: () => void;
	onPrefetch: () => void;
	onMoveTo: (stageId: string) => void;
}) {
	return (
		<div className="flex flex-col gap-2">
			<div className="flex items-start gap-1">
				<button
					type="button"
					onClick={onOpen}
					onPointerEnter={onPrefetch}
					onFocus={onPrefetch}
					className="line-clamp-2 min-w-0 flex-1 rounded-sm text-left font-medium outline-none hover:underline focus-visible:shadow-focus"
				>
					{deal.name}
				</button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon-sm">
							<MoreHorizontalIcon />
							<span className="sr-only">Actions for {deal.name}</span>
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end" className="min-w-52">
						<DropdownMenuGroup>
							<DropdownMenuItem onSelect={onOpen}>Open deal</DropdownMenuItem>
						</DropdownMenuGroup>
						<DropdownMenuSeparator />
						<DropdownMenuLabel>Move to</DropdownMenuLabel>
						<DropdownMenuRadioGroup
							value={stageId}
							onValueChange={(next) => {
								if (next !== stageId) onMoveTo(next);
							}}
						>
							{stages.map((stage) => (
								<DropdownMenuRadioItem key={stage.id} value={stage.id}>
									{stage.label}
								</DropdownMenuRadioItem>
							))}
						</DropdownMenuRadioGroup>
					</DropdownMenuContent>
				</DropdownMenu>
			</div>

			<div className="text-13 text-muted-foreground">
				<CompanyCell company={deal.company} />
			</div>

			<MetaRow className="justify-between">
				<DealAmount deal={deal} />
				<span className="flex items-center gap-2">
					{deal.expectedCloseDate ? (
						<LocalDay date={deal.expectedCloseDate} />
					) : null}
					<OwnerCell owner={deal.owner} compact />
				</span>
			</MetaRow>
		</div>
	);
}

function DealAmount({ deal }: { deal: DealBoardCard }) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [draft, setDraft] = useState<string | null>(null);

	const update = useMutation(
		trpc.deals.update.mutationOptions({
			onSuccess: async () => {
				await cache.deal(deal.id);
				setDraft(null);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	if (draft === null) {
		return (
			<button
				type="button"
				onClick={() =>
					setDraft(
						deal.amountCents === null ? "" : String(deal.amountCents / 100),
					)
				}
				className="rounded-sm text-foreground tabular-nums outline-none hover:underline focus-visible:shadow-focus"
			>
				{deal.amountCents === null ? (
					<span className="text-muted-foreground">Add amount</span>
				) : (
					formatMoney(deal.amountCents, deal.currency)
				)}
				<span className="sr-only">, edit amount</span>
			</button>
		);
	}

	const save = () => {
		const trimmed = draft.trim();
		const parsed = Number.parseFloat(trimmed);
		if (trimmed !== "" && !Number.isFinite(parsed)) {
			toast.error("Enter the amount as a number.");
			return;
		}
		const amountCents = trimmed === "" ? null : Math.round(parsed * 100);
		if (amountCents === deal.amountCents) {
			setDraft(null);
			return;
		}
		update.mutate({ id: deal.id, data: { amountCents } });
	};

	return (
		<form
			className="w-28"
			onSubmit={(event) => {
				event.preventDefault();
				save();
			}}
		>
			<Input
				autoFocus
				inputMode="decimal"
				aria-label={`Amount for ${deal.name} in ${deal.currency}`}
				value={draft}
				disabled={update.isPending}
				onChange={(event) => setDraft(event.target.value)}
				onBlur={save}
				onMouseDown={(event) => event.stopPropagation()}
				onTouchStart={(event) => event.stopPropagation()}
				onKeyDown={(event) => {
					if (event.key === "Escape") {
						event.stopPropagation();
						setDraft(null);
					}
				}}
			/>
		</form>
	);
}
