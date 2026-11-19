"use client";

import { Alert, AlertDescription, AlertTitle } from "@crm/ui/components/alert";
import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@crm/ui/components/dialog";
import { Field, FieldLabel } from "@crm/ui/components/field";
import { MetaRow } from "@crm/ui/components/meta-row";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { Spinner } from "@crm/ui/components/spinner";
import { IndicatorDot } from "@crm/ui/components/status-indicator";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { stageTone } from "@/lib/deal-stage";
import { useCrmCache } from "@/lib/trpc/cache";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

type Plan = RouterOutputs["workspaceConfig"]["pipelinePlan"];

type PlannedStage = Plan["stages"][number];

const CHANGE_LABEL = {
	create: "New",
	rename: "Renamed",
	update: "Changed",
	keep: null,
} as const satisfies Record<PlannedStage["change"], string | null>;

function dealsLabel(count: number): string {
	return `${count} ${count === 1 ? "deal" : "deals"}`;
}

export function PipelinePlanDialog({
	versionId,
	open,
	onOpenChange,
}: {
	versionId: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const trpc = useTRPC();
	const cache = useCrmCache();
	const [chosen, setChosen] = useState<Record<string, string>>({});

	const plan = useQuery({
		...trpc.workspaceConfig.pipelinePlan.queryOptions({ versionId }),
		enabled: open,
		staleTime: 0,
	});

	const apply = useMutation(
		trpc.workspaceConfig.apply.mutationOptions({
			onSuccess: async (result) => {
				await cache.pipeline();
				onOpenChange(false);
				setChosen({});
				toast.success(
					result.alreadyApplied
						? "That version is already live."
						: `Applied. The Deals page now uses this pipeline. ${result.stagesCreated} stages added, ${result.stagesUpdated} changed, ${result.stagesRemoved} removed, ${result.dealsMoved} deals moved.`,
				);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const data = plan.data;
	const needsTarget = (data?.removed ?? []).filter(
		(stage) => stage.dealCount > 0,
	);
	const targetOf = (stage: Plan["removed"][number]) =>
		chosen[stage.stageId] ??
		(stage.targets.length === 1 ? stage.targets[0]?.key : undefined);
	const mapping = Object.fromEntries(
		needsTarget.flatMap((stage) => {
			const target = targetOf(stage);
			return target ? [[stage.stageId, target]] : [];
		}),
	);
	const ready =
		data !== undefined &&
		data.blocked.length === 0 &&
		needsTarget.every((stage) => mapping[stage.stageId]);

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>Review the pipeline before it goes live</DialogTitle>
					<DialogDescription>
						Every deal keeps its stage unless you move it here. Nothing changes
						until you apply.
					</DialogDescription>
				</DialogHeader>

				<div className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto px-4">
					{plan.isError ? (
						<Alert variant="destructive">
							<AlertTitle>The preview did not load</AlertTitle>
							<AlertDescription>{plan.error.message}</AlertDescription>
						</Alert>
					) : null}

					{!data && !plan.isError ? (
						<span className="flex items-center gap-2 text-muted-foreground text-sm">
							<Spinner /> Comparing with the live pipeline
						</span>
					) : null}

					{data?.blocked.map((message) => (
						<Alert key={message} variant="destructive">
							<AlertTitle>This change is not safe</AlertTitle>
							<AlertDescription>{message}</AlertDescription>
						</Alert>
					))}

					{data ? (
						<section className="flex flex-col gap-2">
							<h3 className="font-medium text-sm">
								{data.inSync
									? "The live pipeline already matches"
									: "The pipeline after you apply"}
							</h3>
							<ol className="flex flex-col">
								{data.stages.map((stage) => (
									<li
										key={stage.key}
										className="flex items-center gap-2 border-t py-2 text-sm first:border-t-0"
									>
										<IndicatorDot tone={stageTone(stage)} aria-hidden />
										<span className="min-w-0 flex-1 truncate">
											{stage.label}
											{stage.previousLabel ? (
												<span className="text-muted-foreground">
													, was {stage.previousLabel}
												</span>
											) : null}
										</span>
										<MetaRow>
											{stage.isDefault ? <span>Default</span> : null}
											{stage.dealCount > 0 ? (
												<span>{dealsLabel(stage.dealCount)} stay</span>
											) : null}
										</MetaRow>
										{CHANGE_LABEL[stage.change] ? (
											<Badge variant="secondary">
												{CHANGE_LABEL[stage.change]}
											</Badge>
										) : null}
									</li>
								))}
							</ol>
						</section>
					) : null}

					{data && data.removed.length > 0 ? (
						<section className="flex flex-col gap-3">
							<h3 className="font-medium text-sm">Stages that go away</h3>
							{data.removed.map((stage) =>
								stage.dealCount === 0 ? (
									<p
										key={stage.stageId}
										className="text-13 text-muted-foreground"
									>
										{stage.label} is empty and is removed.
									</p>
								) : (
									<Field key={stage.stageId}>
										<FieldLabel htmlFor={`map-${stage.stageId}`}>
											Move {dealsLabel(stage.dealCount)} from {stage.label} to
										</FieldLabel>
										{stage.targets.length === 0 ? (
											<p className="text-13 text-destructive">
												The new pipeline has no {stage.outcome.toLowerCase()}{" "}
												stage to hold them.
											</p>
										) : (
											<Select
												value={targetOf(stage) ?? ""}
												onValueChange={(next) =>
													setChosen((current) => ({
														...current,
														[stage.stageId]: next,
													}))
												}
											>
												<SelectTrigger id={`map-${stage.stageId}`}>
													<SelectValue placeholder="Choose a stage" />
												</SelectTrigger>
												<SelectContent>
													{stage.targets.map((target) => (
														<SelectItem key={target.key} value={target.key}>
															{target.label}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										)}
									</Field>
								),
							)}
						</section>
					) : null}
				</div>

				<DialogFooter>
					<Button
						disabled={!ready || apply.isPending}
						onClick={() => apply.mutate({ versionId, stageMapping: mapping })}
					>
						{apply.isPending ? <Spinner data-icon="inline-start" /> : null}
						Apply this setup
					</Button>
					<Button variant="outline" onClick={() => onOpenChange(false)}>
						Cancel
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
