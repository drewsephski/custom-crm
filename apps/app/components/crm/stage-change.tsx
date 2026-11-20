"use client";

import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@crm/ui/components/dropdown-menu";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { Icon } from "@crm/ui/components/icon";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import { useMutation } from "@tanstack/react-query";
import { ChevronDownIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { useId, useState } from "react";
import { toast } from "sonner";
import {
	type BoardPlacement,
	CLOSE_REASON_CLEARED,
	closeReasonParams,
	closeReasonPlacement,
	closeReasonRequest,
} from "@/app/(app)/[slug]/deals/close-reason-state";
import { isLostStage, type StageLike } from "@/lib/deal-stage";
import { usePipeline } from "@/lib/pipeline";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import { DealStageIndicator } from "./deal-stage";

export function useCloseReason() {
	const [, setCloseParams] = useQueryStates(closeReasonParams);

	return (dealId: string, stageId: string, placement?: BoardPlacement) =>
		setCloseParams(closeReasonRequest(dealId, stageId, placement));
}

function useStageMutation(onDone?: () => void) {
	const trpc = useTRPC();
	const cache = useCrmCache();

	return useMutation(
		trpc.deals.setStage.mutationOptions({
			onSuccess: async (_, variables) => {
				await cache.deal(variables.id);
				onDone?.();
			},
			onError: (error) => toast.error(error.message),
		}),
	);
}

export function DealStageMenu({
	dealId,
	stage,
	variant = "inline",
}: {
	dealId: string;
	stage: StageLike & { id: string };
	variant?: "inline" | "control";
}) {
	const askWhy = useCloseReason();
	const setStage = useStageMutation();
	const { stages, stageById } = usePipeline();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				{variant === "control" ? (
					<Button
						variant="outline"
						size="sm"
						disabled={setStage.isPending}
						onClick={(event) => event.stopPropagation()}
					>
						<DealStageIndicator stage={stage} className="text-foreground" />
						<Icon icon={ChevronDownIcon} className="text-muted-foreground" />
					</Button>
				) : (
					<button
						type="button"
						onClick={(event) => event.stopPropagation()}
						disabled={setStage.isPending}
						className="flex max-w-full min-w-0 items-center text-left hover:text-foreground disabled:opacity-50"
					>
						<DealStageIndicator stage={stage} />
					</button>
				)}
			</DropdownMenuTrigger>
			<DropdownMenuContent
				align={variant === "control" ? "end" : "start"}
				className="min-w-52"
				onClick={(event) => event.stopPropagation()}
			>
				<DropdownMenuRadioGroup
					value={stage.id}
					onValueChange={(next) => {
						const chosen = stageById(next);
						if (!chosen || chosen.id === stage.id) return;
						if (isLostStage(chosen)) {
							void askWhy(dealId, chosen.id);
							return;
						}
						setStage.mutate({ id: dealId, stageId: chosen.id });
					}}
				>
					{stages.map((option) => (
						<DropdownMenuRadioItem key={option.id} value={option.id}>
							{option.label}
						</DropdownMenuRadioItem>
					))}
				</DropdownMenuRadioGroup>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export function CloseReasonDialog() {
	const reasonId = useId();
	const [closeValues, setCloseParams] = useQueryStates(closeReasonParams);
	const closing = closeValues[SEARCH_PARAM.dialog.closeDeal];
	const closingStage = closeValues[SEARCH_PARAM.dialog.closeStage];
	const [reason, setReason] = useState("");
	const { stageById } = usePipeline();

	const close = () => {
		setReason("");
		void setCloseParams(CLOSE_REASON_CLEARED);
	};

	const setStage = useStageMutation(() => {
		toast.success("Deal closed.");
		close();
	});

	const stage = stageById(closingStage);
	const open = Boolean(closing && stage);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && close()}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>
						{stage ? `Move to ${stage.label}` : "Close the deal"}
					</DialogTitle>
					<DialogDescription>
						Why did this deal not go ahead? The reason goes on the timeline, and
						this is the only place it is recorded.
					</DialogDescription>
				</DialogHeader>

				<form
					id="close-reason"
					className="px-4"
					onSubmit={(event) => {
						event.preventDefault();
						if (!closing || !stage) return;
						setStage.mutate({
							id: closing,
							stageId: stage.id,
							closedReason: reason,
							placement: closeReasonPlacement(closeValues),
						});
					}}
				>
					<Field>
						<FieldLabel htmlFor={reasonId}>Reason</FieldLabel>
						<Textarea
							id={reasonId}
							value={reason}
							onChange={(event) => setReason(event.target.value)}
							placeholder="Went with an incumbent vendor"
							rows={3}
						/>
					</Field>
				</form>

				<DialogFooter>
					<Button
						type="submit"
						form="close-reason"
						disabled={setStage.isPending || reason.trim() === ""}
					>
						{setStage.isPending ? <Spinner /> : null}
						Save
					</Button>
					<Button variant="outline" onClick={close}>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
