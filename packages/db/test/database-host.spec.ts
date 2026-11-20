import { describe, expect, it } from "bun:test";
import {
	databaseHost,
	directDatabaseUrl,
	isLocalHost,
	parseDevHosts,
} from "../src/database-host";

const POOLED =
	"postgresql://owner:p%40ss@ep-cool-lab-123-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DIRECT =
	"postgresql://owner:p%40ss@ep-cool-lab-123.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";
const LOCAL = "postgresql://postgres:postgres@localhost:5432/crm?schema=public";

describe("directDatabaseUrl", () => {
	it("strips the pooler suffix from a Neon host and keeps the rest", () => {
		expect(directDatabaseUrl(POOLED)).toBe(DIRECT);
	});

	it("leaves a direct or local URL exactly as it was", () => {
		expect(directDatabaseUrl(DIRECT)).toBe(DIRECT);
		expect(directDatabaseUrl(LOCAL)).toBe(LOCAL);
	});

	it("does not touch a pooler suffix on another provider's host", () => {
		const other = "postgresql://u:p@db-pooler.example.com/app";
		expect(directDatabaseUrl(other)).toBe(other);
	});

	it("returns what it was given when that is not a URL", () => {
		expect(directDatabaseUrl("not a url")).toBe("not a url");
	});
});

describe("databaseHost", () => {
	it("names one host for the pooled and the direct URL", () => {
		expect(databaseHost(POOLED)).toBe(databaseHost(DIRECT));
	});

	it("knows a local host", () => {
		expect(isLocalHost(databaseHost(LOCAL))).toBe(true);
		expect(isLocalHost(databaseHost(DIRECT))).toBe(false);
	});
});

describe("parseDevHosts", () => {
	it("reads a comma-separated list, in either pooled or direct form", () => {
		expect(
			parseDevHosts(
				" EP-cool-lab-123-pooler.c-8.us-east-2.aws.neon.tech , dev.internal ",
			),
		).toEqual(["ep-cool-lab-123.c-8.us-east-2.aws.neon.tech", "dev.internal"]);
	});

	it("is empty when the variable is unset or blank", () => {
		expect(parseDevHosts(undefined)).toEqual([]);
		expect(parseDevHosts(" , ")).toEqual([]);
	});
});
