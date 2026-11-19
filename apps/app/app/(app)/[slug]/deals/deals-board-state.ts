import type { RouterOutputs } from "@/lib/trpc/types";

export type DealBoard = RouterOutputs["deals"]["board"];

export type DealBoardColumn = DealBoard["columns"][number];

export type DealBoardCard = DealBoardColumn["deals"][number];

export type BoardMove = {
	dealId: string;
	toStageId: string;
	index: number;
};

export function findCard(
	board: DealBoard,
	dealId: string,
): { card: DealBoardCard; column: DealBoardColumn } | null {
	for (const column of board.columns) {
		const card = column.deals.find((deal) => deal.id === dealId);
		if (card) return { card, column };
	}
	return null;
}

export function moveCard(board: DealBoard, move: BoardMove): DealBoard {
	const found = findCard(board, move.dealId);
	if (!found) return board;

	const { card, column: from } = found;
	if (!board.columns.some((column) => column.stage.id === move.toStageId)) {
		return board;
	}

	const crossing = from.stage.id !== move.toStageId;
	const value = card.baseAmountCents ?? 0;

	return {
		...board,
		columns: board.columns.map((column) => {
			const leaving = column.stage.id === from.stage.id;
			const entering = column.stage.id === move.toStageId;
			if (!leaving && !entering) return column;

			const rest = column.deals.filter((deal) => deal.id !== move.dealId);
			if (!entering) {
				return {
					...column,
					deals: rest,
					count: column.count - 1,
					valueCents: column.valueCents - value,
				};
			}

			const index = Math.max(0, Math.min(move.index, rest.length));
			const deals = [...rest.slice(0, index), card, ...rest.slice(index)];
			return crossing
				? {
						...column,
						deals,
						count: column.count + 1,
						valueCents: column.valueCents + value,
					}
				: { ...column, deals };
		}),
	};
}
