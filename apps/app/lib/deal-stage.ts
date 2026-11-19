import type { StatusTone } from "@crm/ui/components/status-indicator";
import { type ChartColor, stageChartColor } from "@crm/ui/lib/chart-config";
import type { StageOutcome } from "@crm/validation/pipeline";

export type StageLike = { label: string; outcome: StageOutcome };

const OUTCOME_TONE = {
	OPEN: "info",
	WON: "success",
	LOST: "error",
} as const satisfies Record<StageOutcome, StatusTone>;

export function stageTone(stage: Pick<StageLike, "outcome">): StatusTone {
	return OUTCOME_TONE[stage.outcome];
}

export function isOpenStage(stage: Pick<StageLike, "outcome">): boolean {
	return stage.outcome === "OPEN";
}

export function isLostStage(stage: Pick<StageLike, "outcome">): boolean {
	return stage.outcome === "LOST";
}

export function dealStageChartColor(position: number): ChartColor {
	return stageChartColor(position);
}
