import { describe, expect, it } from "bun:test";
import {
	CLOSE_REASON_CLEARED,
	closeReasonParams,
	closeReasonPlacement,
	closeReasonRequest,
} from "../app/(app)/[slug]/deals/close-reason-state";
import { dealViewParsers } from "../app/(app)/[slug]/deals/deals-view";
import {
	RESERVED_SEARCH_PARAM_KEYS,
	SEARCH_PARAM,
} from "../lib/search-param-keys";

describe("the lost reason dialog keeps where the card was dropped", () => {
	it("carries a drop after a card through the dialog", () => {
		const request = closeReasonRequest("deal", "lost", {
			afterId: "above",
			beforeId: null,
		});

		expect(request).toEqual({
			closeDeal: "deal",
			closeStage: "lost",
			closeAfter: "above",
			closeBefore: null,
		});
		expect(closeReasonPlacement(request)).toEqual({
			afterId: "above",
			beforeId: null,
		});
	});

	it("carries a drop at the top of a column through the dialog", () => {
		const request = closeReasonRequest("deal", "lost", {
			afterId: null,
			beforeId: "below",
		});

		expect(closeReasonPlacement(request)).toEqual({
			afterId: null,
			beforeId: "below",
		});
	});

	it("keeps one anchor when the drop names both neighbours", () => {
		const request = closeReasonRequest("deal", "lost", {
			afterId: "above",
			beforeId: "below",
		});

		expect(request.closeBefore).toBeNull();
		expect(closeReasonPlacement(request)).toEqual({
			afterId: "above",
			beforeId: null,
		});
	});

	it("sends no placement when a menu opens the dialog", () => {
		const request = closeReasonRequest("deal", "lost");

		expect(request.closeAfter).toBeNull();
		expect(request.closeBefore).toBeNull();
		expect(closeReasonPlacement(request)).toBeUndefined();
	});

	it("sends no placement for a drop into an empty column", () => {
		const request = closeReasonRequest("deal", "lost", {
			afterId: null,
			beforeId: null,
		});

		expect(closeReasonPlacement(request)).toBeUndefined();
	});

	it("drops an earlier placement when a menu opens the dialog next", () => {
		const dragged = closeReasonRequest("deal", "lost", {
			afterId: "above",
			beforeId: null,
		});
		const fromMenu = { ...dragged, ...closeReasonRequest("other", "lost") };

		expect(closeReasonPlacement(fromMenu)).toBeUndefined();
	});

	it("clears every key when the dialog closes", () => {
		expect(Object.keys(CLOSE_REASON_CLEARED).sort()).toEqual(
			Object.keys(closeReasonParams).sort(),
		);
		expect(Object.values(CLOSE_REASON_CLEARED)).toEqual([
			null,
			null,
			null,
			null,
		]);
		expect(closeReasonPlacement(CLOSE_REASON_CLEARED)).toBeUndefined();
	});

	it("reserves the placement keys so no table filter can take them", () => {
		expect(RESERVED_SEARCH_PARAM_KEYS.has(SEARCH_PARAM.dialog.closeAfter)).toBe(
			true,
		);
		expect(
			RESERVED_SEARCH_PARAM_KEYS.has(SEARCH_PARAM.dialog.closeBefore),
		).toBe(true);
	});
});

describe("the deals layout toggle", () => {
	it("asks the server to render the page again", () => {
		expect(dealViewParsers[SEARCH_PARAM.deals.view].shallow).toBe(false);
	});

	it("keeps the board as the layout with no value in the url", () => {
		expect(dealViewParsers[SEARCH_PARAM.deals.view].defaultValue).toBe("board");
		expect(dealViewParsers[SEARCH_PARAM.deals.view].parse("table")).toBe(
			"table",
		);
		expect(dealViewParsers[SEARCH_PARAM.deals.view].parse("grid")).toBeNull();
	});
});
