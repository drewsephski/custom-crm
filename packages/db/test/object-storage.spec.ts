import { describe, expect, it } from "bun:test";
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
