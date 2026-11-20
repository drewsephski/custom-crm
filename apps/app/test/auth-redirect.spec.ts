import { describe, expect, it } from "bun:test";
import {
	ENTRY_PATH,
	isSafeNextPath,
	safeNextPath,
	signInPathFor,
	withNext,
} from "../lib/auth-redirect";

describe("safeNextPath", () => {
	it("keeps a path on this site, with its query", () => {
		expect(safeNextPath("/invitations")).toBe("/invitations");
		expect(safeNextPath("/acme/companies?record=contact:abc&page=2")).toBe(
			"/acme/companies?record=contact:abc&page=2",
		);
		expect(safeNextPath("/")).toBe("/");
	});

	it("falls back to the entry path when there is nothing to return to", () => {
		expect(safeNextPath(null)).toBe(ENTRY_PATH);
		expect(safeNextPath(undefined)).toBe(ENTRY_PATH);
		expect(safeNextPath("")).toBe(ENTRY_PATH);
	});

	it("refuses another origin in every spelling", () => {
		for (const attack of [
			"//evil.com",
			"//evil.com/path",
			"/\\evil.com",
			"\\\\evil.com",
			"/\\/evil.com",
			"https://evil.com",
			"http://evil.com/acme",
			"HTTPS://evil.com",
			"/%2F%2Fevil.com",
			"/%2f%2fevil.com",
			"/%5Cevil.com",
			"/%5cevil.com",
			"javascript:alert(1)",
			"JavaScript:alert(1)",
			"data:text/html,<script>alert(1)</script>",
			"mailto:someone@evil.com",
			"evil.com",
			"acme/companies",
			" /acme",
			"/acme//evil.com",
			"/acme?next=//evil.com",
			"/acme?u=https://evil.com",
		]) {
			expect(isSafeNextPath(attack)).toBe(false);
			expect(safeNextPath(attack)).toBe(ENTRY_PATH);
		}
	});

	it("refuses control characters, raw and encoded", () => {
		for (const attack of [
			"/acme\n",
			"/acme\r\nSet-Cookie: a=b",
			"/\tevil.com",
			"/acme\u0000",
			"/acme\u007f",
			"/acme%0d%0aSet-Cookie:%20a=b",
			"/%09/evil.com",
			"/acme%00",
		]) {
			expect(safeNextPath(attack)).toBe(ENTRY_PATH);
		}
	});

	it("refuses a broken escape and an unbounded value", () => {
		expect(safeNextPath("/acme%")).toBe(ENTRY_PATH);
		expect(safeNextPath("/acme%zz")).toBe(ENTRY_PATH);
		expect(safeNextPath(`/${"a".repeat(600)}`)).toBe(ENTRY_PATH);
		expect(safeNextPath(`/${"a".repeat(400)}`)).toHaveLength(401);
	});
});

describe("signInPathFor", () => {
	it("carries the path a visitor asked for", () => {
		expect(signInPathFor("/acme/deals?stage=won")).toBe(
			"/sign-in?next=%2Facme%2Fdeals%3Fstage%3Dwon",
		);
	});

	it("drops a path it does not trust", () => {
		expect(signInPathFor("//evil.com")).toBe("/sign-in");
	});
});

describe("withNext", () => {
	it("adds nothing for the entry path", () => {
		expect(withNext("/sign-in", ENTRY_PATH)).toBe("/sign-in");
	});

	it("carries a trusted path and drops any other", () => {
		expect(withNext("/get-started", "/invitations")).toBe(
			"/get-started?next=%2Finvitations",
		);
		expect(withNext("/get-started", "https://evil.com")).toBe("/get-started");
	});
});
