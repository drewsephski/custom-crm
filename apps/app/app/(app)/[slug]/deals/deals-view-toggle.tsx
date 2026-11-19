"use client";

import { ToggleGroup, ToggleGroupItem } from "@crm/ui/components/toggle-group";
import { ColumnsIcon, ListIcon } from "lucide-react";
import { useQueryStates } from "nuqs";
import { SEARCH_PARAM } from "@/lib/search-param-keys";
import { DEAL_VIEWS, type DealView, dealViewParsers } from "./deals-view";

function viewOf(value: string): DealView | null {
	return DEAL_VIEWS.find((view) => view === value) ?? null;
}

export function DealsViewToggle() {
	const [state, setState] = useQueryStates(dealViewParsers);
	const view = state[SEARCH_PARAM.deals.view];

	return (
		<ToggleGroup
			type="single"
			variant="outline"
			size="sm"
			spacing={0}
			aria-label="Deals layout"
			value={view}
			onValueChange={(next) => {
				const chosen = viewOf(next);
				if (chosen) void setState({ [SEARCH_PARAM.deals.view]: chosen });
			}}
		>
			<ToggleGroupItem value="board" aria-label="Board">
				<ColumnsIcon data-icon="inline-start" />
				Board
			</ToggleGroupItem>
			<ToggleGroupItem value="table" aria-label="Table">
				<ListIcon data-icon="inline-start" />
				Table
			</ToggleGroupItem>
		</ToggleGroup>
	);
}
