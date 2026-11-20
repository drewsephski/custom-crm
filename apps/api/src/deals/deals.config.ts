export const BOARD = {
	column: { defaultLimit: 50, maxLimit: 100 },
	position: { step: 1, minGap: 1e-6 },
	lock: { prefix: "deal-board" },
	move: { attempts: 3 },
} as const;
