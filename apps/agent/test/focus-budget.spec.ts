import { describe, expect, it } from "bun:test";
import { budgetAllows } from "../agent/lib/focus";
import { FOCUS } from "../agent/lib/focus-config";

describe("the research budget", () => {
	it("is switched off, so research is never refused for budget", () => {
		expect(FOCUS.enforceBudget).toBe(false);
		expect(budgetAllows(40, 6, FOCUS.defaultBudget)).toBe(true);
	});

	it("still refuses an overspend when it is switched back on", () => {
		expect(budgetAllows(2, 2, 4, true)).toBe(true);
		expect(budgetAllows(4, 2, 4, true)).toBe(false);
	});
});
