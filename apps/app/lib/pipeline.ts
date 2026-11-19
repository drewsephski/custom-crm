"use client";

import { useQuery } from "@tanstack/react-query";
import { useTRPC } from "@/lib/trpc/client";
import type { RouterOutputs } from "@/lib/trpc/types";

export type Pipeline = RouterOutputs["pipeline"]["active"];

export type PipelineStage = Pipeline["stages"][number];

const NO_STAGES: PipelineStage[] = [];

export function usePipeline() {
	const trpc = useTRPC();
	const pipeline = useQuery(trpc.pipeline.active.queryOptions());
	const stages = pipeline.data?.stages ?? NO_STAGES;

	return {
		stages,
		openStages: stages.filter((stage) => stage.outcome === "OPEN"),
		defaultStage:
			stages.find((stage) => stage.isDefault) ??
			stages.find((stage) => stage.outcome === "OPEN") ??
			null,
		isLoading: pipeline.isPending,
		isError: pipeline.isError,
		stageById: (id: string | null | undefined) =>
			stages.find((stage) => stage.id === id) ?? null,
	};
}
