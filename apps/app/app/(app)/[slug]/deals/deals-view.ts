import { createLoader, parseAsStringLiteral } from "nuqs/server";
import { SEARCH_PARAM } from "@/lib/search-param-keys";

export const DEAL_VIEWS = ["board", "table"] as const;

export type DealView = (typeof DEAL_VIEWS)[number];

export const dealViewParsers = {
	[SEARCH_PARAM.deals.view]:
		parseAsStringLiteral(DEAL_VIEWS).withDefault("board"),
};

export const loadDealView = createLoader(dealViewParsers);
