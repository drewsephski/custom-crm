import { describe, expect, it } from "bun:test";
import {
	type GuardSource,
	guardDeployCommand,
	guardDevelopmentCommand,
	guardTargets,
} from "../src/database-guard";

const LOCAL = "postgresql://postgres:postgres@localhost:5432/crm?schema=public";
const DEV_POOLED =
	"postgresql://owner:secret@ep-dev-lab-1-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";
const DEV_HOST = "ep-dev-lab-1.c-8.us-east-2.aws.neon.tech";
const PROD_POOLED =
	"postgresql://owner:secret@ep-prod-bar-2-pooler.c-8.us-east-2.aws.neon.tech/neondb?sslmode=require";
const PROD_HOST = "ep-prod-bar-2.c-8.us-east-2.aws.neon.tech";

function file(values: Record<string, string>): GuardSource {
	return { from: ".env", values };
}

function shell(values: Record<string, string>): GuardSource {
	return { from: "the environment", values };
}

describe("guardDevelopmentCommand", () => {
	it("allows a local database", () => {
		const [decision] = guardDevelopmentCommand([file({ DATABASE_URL: LOCAL })]);

		expect(decision).toMatchObject({ allowed: true, reason: "local" });
	});

	it("allows a Neon development branch named in DEV_DATABASE_HOSTS", () => {
		const [decision] = guardDevelopmentCommand([
			file({
				DATABASE_URL: DEV_POOLED,
				NEON_BRANCH: "development",
				DEV_DATABASE_HOSTS: DEV_HOST,
			}),
		]);

		expect(decision).toMatchObject({ allowed: true, reason: "development" });
	});

	it("refuses an unlisted remote database", () => {
		const [decision] = guardDevelopmentCommand([
			file({ DATABASE_URL: DEV_POOLED, NEON_BRANCH: "development" }),
		]);

		expect(decision).toMatchObject({ allowed: false, reason: "remote" });
	});

	it("refuses the production branch even when its host is listed as development", () => {
		const [decision] = guardDevelopmentCommand([
			file({
				DATABASE_URL: PROD_POOLED,
				NEON_BRANCH: "production",
				DEV_DATABASE_HOSTS: PROD_HOST,
			}),
		]);

		expect(decision).toMatchObject({
			allowed: false,
			reason: "protected-branch",
		});
	});

	it("gives the production branch no override", () => {
		const [decision] = guardDevelopmentCommand([
			shell({ ALLOW_REMOTE_DB: "1" }),
			file({ DATABASE_URL: PROD_POOLED, NEON_BRANCH: "Production" }),
		]);

		expect(decision).toMatchObject({
			allowed: false,
			reason: "protected-branch",
		});
	});

	it("gives a protected host no override, in pooled or direct form", () => {
		const [decision] = guardDevelopmentCommand([
			shell({ ALLOW_REMOTE_DB: "1" }),
			file({
				DATABASE_URL: PROD_POOLED,
				PROTECTED_DATABASE_HOSTS: `ep-prod-bar-2-pooler.c-8.us-east-2.aws.neon.tech`,
				DEV_DATABASE_HOSTS: PROD_HOST,
			}),
		]);

		expect(decision).toMatchObject({
			allowed: false,
			reason: "protected-host",
		});
	});

	it("judges a URL exported in the shell, not only the file value", () => {
		const decisions = guardDevelopmentCommand([
			shell({ DATABASE_URL: PROD_POOLED }),
			file({
				DATABASE_URL: LOCAL,
				PROTECTED_DATABASE_HOSTS: PROD_HOST,
			}),
		]);

		expect(decisions).toHaveLength(2);
		expect(decisions.some((decision) => !decision.allowed)).toBe(true);
	});

	it("retains protection when the shell repeats a file's database URL", () => {
		const sources = [
			shell({ DATABASE_URL: PROD_POOLED, DEV_DATABASE_HOSTS: PROD_HOST }),
			file({ DATABASE_URL: PROD_POOLED, NEON_BRANCH: "production" }),
		];
		expect(guardDevelopmentCommand(sources)[0]?.allowed).toBe(false);
		expect(guardDeployCommand(sources)[0]?.allowed).toBe(false);
	});

	it("allows an unprotected remote database with the override", () => {
		const [decision] = guardDevelopmentCommand([
			shell({ ALLOW_REMOTE_DB: "1" }),
			file({ DATABASE_URL: DEV_POOLED }),
		]);

		expect(decision).toMatchObject({ allowed: true, reason: "override" });
	});

	it("finds no target when nothing sets DATABASE_URL", () => {
		expect(guardTargets([shell({}), file({})])).toEqual([]);
	});
});

describe("guardDeployCommand", () => {
	it("deploys to a development branch", () => {
		const [decision] = guardDeployCommand([
			file({ DATABASE_URL: DEV_POOLED, NEON_BRANCH: "development" }),
		]);

		expect(decision).toMatchObject({ allowed: true, reason: "unprotected" });
	});

	it("refuses the production branch from a laptop", () => {
		const [decision] = guardDeployCommand([
			file({ DATABASE_URL: PROD_POOLED, NEON_BRANCH: "production" }),
		]);

		expect(decision).toMatchObject({
			allowed: false,
			reason: "protected-branch",
		});
	});

	it("deploys to production on a release build", () => {
		const [decision] = guardDeployCommand([
			shell({ VERCEL_ENV: "production" }),
			file({ DATABASE_URL: PROD_POOLED, NEON_BRANCH: "production" }),
		]);

		expect(decision).toMatchObject({ allowed: true, reason: "release" });
	});

	it("deploys to production after an explicit confirmation", () => {
		const [decision] = guardDeployCommand([
			shell({ ALLOW_PRODUCTION_MIGRATE: "1" }),
			file({
				DATABASE_URL: PROD_POOLED,
				PROTECTED_DATABASE_HOSTS: PROD_HOST,
			}),
		]);

		expect(decision).toMatchObject({ allowed: true, reason: "confirmed" });
	});

	it("does not treat a preview build as a release", () => {
		const [decision] = guardDeployCommand([
			shell({ VERCEL_ENV: "preview" }),
			file({ DATABASE_URL: PROD_POOLED, NEON_BRANCH: "production" }),
		]);

		expect(decision).toMatchObject({ allowed: false });
	});
});
