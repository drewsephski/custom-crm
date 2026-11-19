import { describe, expect, it } from "bun:test";
import {
	type DealBoard,
	findCard,
	moveCard,
} from "../app/(app)/[slug]/deals/deals-board-state";

function card(id: string, baseAmountCents: number | null) {
	return {
		id,
		name: id,
		currency: "USD",
		company: {
			id: "company",
			name: "Lakeside Dental",
			domain: null,
			iconUrl: null,
			iconDarkUrl: null,
			iconTone: null,
			logoUrl: null,
		},
		owner: { id: "owner", name: "Owner", email: "o@example.test", image: null },
		amountCents: baseAmountCents,
		baseAmountCents,
		expectedCloseDate: null,
		stageChangedAt: "2026-11-01T00:00:00.000Z",
		lastActivityAt: null,
	};
}

function stage(id: string, outcome: "OPEN" | "WON" | "LOST", position: number) {
	return { id, key: id, label: id, outcome, position, probability: null };
}

const BOARD: DealBoard = {
	reportingCurrency: "USD",
	unconverted: { count: 0, currencies: [] },
	columns: [
		{
			stage: stage("inquiry", "OPEN", 0),
			count: 2,
			valueCents: 300,
			deals: [card("a", 100), card("b", 200)],
		},
		{
			stage: stage("proposal", "OPEN", 1),
			count: 1,
			valueCents: 500,
			deals: [card("c", 500)],
		},
		{ stage: stage("won", "WON", 2), count: 0, valueCents: 0, deals: [] },
	],
};

const ids = (board: DealBoard) =>
	board.columns.map((column) => column.deals.map((deal) => deal.id));

describe("moving a card on the deals board", () => {
	it("moves a card to another stage and carries its value", () => {
		const next = moveCard(BOARD, {
			dealId: "a",
			toStageId: "proposal",
			index: 1,
		});

		expect(ids(next)).toEqual([["b"], ["c", "a"], []]);
		expect(next.columns.map((column) => column.count)).toEqual([1, 2, 0]);
		expect(next.columns.map((column) => column.valueCents)).toEqual([
			200, 600, 0,
		]);
	});

	it("reorders inside a stage without changing its totals", () => {
		const next = moveCard(BOARD, {
			dealId: "a",
			toStageId: "inquiry",
			index: 1,
		});

		expect(ids(next)).toEqual([["b", "a"], ["c"], []]);
		expect(next.columns[0]?.count).toBe(2);
		expect(next.columns[0]?.valueCents).toBe(300);
	});

	it("clamps an index past the end of the column", () => {
		const next = moveCard(BOARD, { dealId: "c", toStageId: "won", index: 9 });

		expect(ids(next)).toEqual([["a", "b"], [], ["c"]]);
	});

	it("leaves the board alone for a card or a stage it does not have", () => {
		expect(
			moveCard(BOARD, { dealId: "missing", toStageId: "won", index: 0 }),
		).toBe(BOARD);
		expect(
			moveCard(BOARD, { dealId: "a", toStageId: "missing", index: 0 }),
		).toBe(BOARD);
	});

	it("does not mutate the board it was given", () => {
		moveCard(BOARD, { dealId: "a", toStageId: "won", index: 0 });

		expect(ids(BOARD)).toEqual([["a", "b"], ["c"], []]);
		expect(findCard(BOARD, "a")?.column.stage.id).toBe("inquiry");
	});
});
