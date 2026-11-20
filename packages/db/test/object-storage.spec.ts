import { describe, expect, it } from "bun:test";
import { objectKey } from "../src/blob";
import { objectStorageConfig, publicObjectUrl } from "../src/object-storage";

const COMPLETE = {
	AWS_ENDPOINT_URL_S3: "https://br-test.storage.c-8.us-east-2.aws.neon.tech/",
	AWS_ACCESS_KEY_ID: "key",
	AWS_SECRET_ACCESS_KEY: "secret",
	AWS_REGION: "us-east-2",
	S3_PUBLIC_BUCKET: "assets",
};

describe("objectStorageConfig", () => {
	it("is off on a bare install", () => {
		expect(objectStorageConfig({})).toBeNull();
	});

	it("is off when any one of the five is missing or blank", () => {
		for (const key of Object.keys(COMPLETE)) {
			expect(objectStorageConfig({ ...COMPLETE, [key]: undefined })).toBeNull();
			expect(objectStorageConfig({ ...COMPLETE, [key]: "  " })).toBeNull();
		}
	});

	it("builds the public URL path-style, without a doubled slash", () => {
		const config = objectStorageConfig(COMPLETE);
		if (!config) throw new Error("expected a complete config");

		expect(publicObjectUrl(config, "companies/c1/icon-9f8e.png")).toBe(
			"https://br-test.storage.c-8.us-east-2.aws.neon.tech/assets/companies/c1/icon-9f8e.png",
		);
	});
});

describe("objectKey", () => {
	it("puts a workspace's object under that workspace", () => {
		expect(objectKey("companies/c1/logo", "abc123", "png", "org_1")).toBe(
			"workspaces/org_1/companies/c1/logo-abc123.png",
		);
	});

	it("keeps two workspaces apart for the same record path", () => {
		const first = objectKey("companies/c1/logo", "abc123", "png", "org_1");
		const second = objectKey("companies/c1/logo", "abc123", "png", "org_2");

		expect(first).not.toBe(second);
		expect(first.startsWith("workspaces/org_1/")).toBe(true);
		expect(second.startsWith("workspaces/org_2/")).toBe(true);
	});

	it("leaves an install-wide object at the root", () => {
		expect(objectKey("users/u1/avatar", "abc123", "jpg", undefined)).toBe(
			"users/u1/avatar-abc123.jpg",
		);
	});
});
