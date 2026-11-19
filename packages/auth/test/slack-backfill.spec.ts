import { describe, expect, it } from "bun:test";
import { chooseSlackOrganization } from "../src/slack-backfill";

describe("choosing the workspace of an old Slack token", () => {
	it("picks the one workspace whose grant names the same Slack team", () => {
		expect(
			chooseSlackOrganization("T1", [
				{ organizationId: "a", grantTeamId: "T1", connected: false },
				{ organizationId: "b", grantTeamId: "T2", connected: false },
			]),
		).toEqual({ kind: "assign", organizationId: "a" });
	});

	it("picks the only workspace of the installer with no Slack at all", () => {
		expect(
			chooseSlackOrganization("T1", [
				{ organizationId: "a", grantTeamId: null, connected: false },
				{ organizationId: "b", grantTeamId: "T2", connected: false },
			]),
		).toEqual({ kind: "assign", organizationId: "a" });
	});

	it("refuses to guess between two workspaces of one installer", () => {
		expect(
			chooseSlackOrganization("T1", [
				{ organizationId: "a", grantTeamId: null, connected: false },
				{ organizationId: "b", grantTeamId: null, connected: false },
			]).kind,
		).toBe("skip");
	});

	it("never overwrites a workspace that is already connected", () => {
		expect(
			chooseSlackOrganization("T1", [
				{ organizationId: "a", grantTeamId: "T1", connected: true },
			]).kind,
		).toBe("skip");
	});
});
