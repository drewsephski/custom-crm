import { StatusIndicator } from "@crm/ui/components/status-indicator";
import { type StageLike, stageTone } from "@/lib/deal-stage";

export function DealStageIndicator({
	stage,
	className,
}: {
	stage: StageLike;
	className?: string;
}) {
	return (
		<StatusIndicator
			tone={stageTone(stage)}
			label={stage.label}
			className={className}
		/>
	);
}
