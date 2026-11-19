import { readFileSync } from "node:fs";
import { MCP_AUTH } from "@crm/auth/mcp-config";
import { createMcpSecretBox } from "@crm/auth/mcp-crypto";
import { db } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { E2E } from "./e2e-config";

const AGENT_URL = process.env.AGENT_URL ?? E2E.liveRun.agentUrl;
const API_URL = process.env.API_URL ?? E2E.mcpLive.apiUrl;
const SECRET = process.env.AGENT_BRIDGE_SECRET?.trim();
const LOG = process.env.MCP_LIVE_LOG ?? E2E.mcpLive.log;
const TOKEN_A = process.env.MCP_LIVE_TOKEN_A ?? E2E.mcpLive.tokenA;

if (process.env.E2E_LIVE_MODEL !== "1") {
	console.log("SKIP  live MCP run — set E2E_LIVE_MODEL=1 to spend credits.");
	process.exit(0);
}
if (!SECRET) throw new Error("AGENT_BRIDGE_SECRET is not set.");
const box = createMcpSecretBox();
if (!box) throw new Error("MCP_ENCRYPTION_KEY is not set or invalid.");

const suffix = Date.now().toString(36);
const NORTHSTAR = `mcp-live-northstar-${suffix}`;
const HARBOR = `mcp-live-harbor-${suffix}`;
const OWNERS = {
	[NORTHSTAR]: `${NORTHSTAR}-owner`,
	[HARBOR]: `${HARBOR}-owner`,
};
const LIST_FINGERPRINT = "1".repeat(64);
const DELETE_FINGERPRINT = "2".repeat(64);
const results: Array<{ name: string; ok: boolean; detail: string }> = [];

function check(name: string, ok: boolean, detail: string) {
	results.push({ name, ok, detail });
	console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

function manifest() {
	return {
		triggers: [
			{
				type: "MANUAL",
				name: "Run now",
				summary: "Started by a person",
				config: {},
			},
		],
		dataScope: { mode: "WORKSPACE", summary: "Workspace", resources: [] },
		actions: [
			{ type: "run.summary", provider: "crm", summary: "Summarize the run" },
		],
		mcp: [
			{
				platformSlug: "linear",
				summary: "Read Linear issues",
				tools: [
					{
						name: "list_issues",
						fingerprint: LIST_FINGERPRINT,
						callKind: "read",
						summary: "List issues",
					},
				],
			},
		],
	};
}

async function seedWorkspace(organizationId: string) {
	const ownerId = OWNERS[organizationId] ?? "";
	await runAsSystem("seed a live MCP workspace", async () => {
		await db.organization.create({
			data: {
				id: organizationId,
				name: organizationId,
				slug: organizationId,
				createdAt: new Date(),
			},
		});
		await db.user.create({
			data: { id: ownerId, name: ownerId, email: `${ownerId}@example.test` },
		});
		await db.member.create({
			data: {
				id: `${organizationId}-member`,
				organizationId,
				userId: ownerId,
				role: "owner",
				createdAt: new Date(),
			},
		});
	});

	return runInTenant(organizationId, async () => {
		const agent = await db.agentDefinition.create({
			data: {
				name: `${E2E.mcpLive.agentPrefix} ${organizationId}`,
				status: "LIVE",
				createdById: ownerId,
			},
			select: { id: true },
		});
		const version = await db.agentVersion.create({
			data: {
				agentId: agent.id,
				number: 1,
				status: "DEPLOYED",
				instructions:
					"Call the linear__list_issues tool exactly once. Then call finish_run. Put every issue title the tool returned, verbatim, in the summary. If no Linear tool is available, call finish_run and say that no Linear tool was available.",
				manifest: manifest(),
				modelId: E2E.mcpLive.modelId,
				sandboxPolicy: {},
				createdById: ownerId,
				approvedAt: new Date(),
				deployedAt: new Date(),
			},
			select: { id: true },
		});
		await db.agentDefinition.update({
			where: { id: agent.id },
			data: { currentVersionId: version.id },
		});
		return { agentId: agent.id, versionId: version.id, ownerId };
	});
}

async function connectLinear(organizationId: string, token: string) {
	const registration = await runAsSystem("register the live MCP client", () =>
		db.mcpClientRegistration.create({
			data: {
				platformSlug: "linear",
				metadataFingerprint: `live-${organizationId}`,
				issuer: "https://mcp.linear.app",
				clientId: `live-${organizationId}`,
			},
			select: { id: true },
		}),
	);
	const connectionId = `${organizationId}-linear`;
	await runInTenant(organizationId, () =>
		db.mcpConnection.create({
			data: {
				id: connectionId,
				platformSlug: "linear",
				status: "CONNECTED",
				accessMode: "READ_WRITE",
				grantedScopes: ["read", "write"],
				registrationId: registration.id,
				connectedById: OWNERS[organizationId] ?? "",
				encryptedAccessToken: box?.encrypt(
					token,
					`mcp-connection:${connectionId}:access`,
				),
				toolSnapshots: {
					create: [
						{
							name: "list_issues",
							description: "List open issues in the workspace's tracker.",
							inputSchema: { type: "object", properties: {} },
							fingerprint: LIST_FINGERPRINT,
							callKind: "read",
							reviewState: "REVIEWED",
						},
						{
							name: "delete_issue",
							description: "Delete one issue.",
							inputSchema: { type: "object", properties: {} },
							fingerprint: DELETE_FINGERPRINT,
							callKind: "risky",
							reviewState: "REVIEWED",
						},
					],
				},
			},
		}),
	);
	return { connectionId, registrationId: registration.id };
}

async function queueRun(
	organizationId: string,
	seeded: { agentId: string; versionId: string; ownerId: string },
) {
	return runInTenant(organizationId, () =>
		db.agentRun.create({
			data: {
				agentId: seeded.agentId,
				versionId: seeded.versionId,
				initiatedById: seeded.ownerId,
				triggerType: "MANUAL",
				idempotencyKey: crypto.randomUUID(),
				correlationId: crypto.randomUUID(),
				events: { create: { sequence: 0, type: "run.queued", data: {} } },
			},
			select: { id: true },
		}),
	);
}

async function dispatch() {
	const response = await fetch(`${AGENT_URL}/internal/crm/agent-dispatch`, {
		method: "POST",
		headers: { authorization: `Bearer ${SECRET}` },
	});
	return response.status;
}

async function settle(organizationId: string, runId: string) {
	const deadline = Date.now() + E2E.liveRun.giveUpMs;
	while (Date.now() < deadline) {
		const run = await runInTenant(organizationId, () =>
			db.agentRun.findUniqueOrThrow({
				where: { id: runId },
				select: {
					status: true,
					summary: true,
					errorCode: true,
					errorMessage: true,
				},
			}),
		);
		if (["SUCCEEDED", "FAILED", "CANCELLED"].includes(run.status)) return run;
		await new Promise((resolve) => setTimeout(resolve, E2E.liveRun.pollMs));
		await dispatch().catch(() => 0);
	}
	return null;
}

function calls(): Array<{ tool?: string; token: string; refused?: boolean }> {
	try {
		return readFileSync(LOG, "utf8")
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line));
	} catch {
		return [];
	}
}

async function brokerStatus(connectionId: string, organizationId: string) {
	const response = await fetch(
		`${API_URL}/internal/mcp/connections/${connectionId}/token`,
		{
			headers: {
				authorization: `Bearer ${SECRET}`,
				[MCP_AUTH.token.organizationHeader]: organizationId,
			},
		},
	);
	return response.status;
}

async function cleanup(registrations: string[]) {
	await runAsSystem("remove the live MCP workspaces", async () => {
		await db.organization.deleteMany({
			where: { id: { in: [NORTHSTAR, HARBOR] } },
		});
		await db.mcpClientRegistration.deleteMany({
			where: { id: { in: registrations } },
		});
		await db.user.deleteMany({ where: { id: { in: Object.values(OWNERS) } } });
	});
}

const registrations: string[] = [];
try {
	const northstar = await seedWorkspace(NORTHSTAR);
	const harbor = await seedWorkspace(HARBOR);
	const linear = await connectLinear(NORTHSTAR, TOKEN_A);
	registrations.push(linear.registrationId);

	check(
		"token broker answers the connection's own workspace",
		(await brokerStatus(linear.connectionId, NORTHSTAR)) === 200,
		"Northstar asks for Northstar's connection",
	);
	check(
		"token broker refuses another workspace",
		(await brokerStatus(linear.connectionId, HARBOR)) === 404,
		"Harbor asks for Northstar's connection id",
	);

	const before = calls().length;
	const northstarRun = await queueRun(NORTHSTAR, northstar);
	const harborRun = await queueRun(HARBOR, harbor);
	console.log(`Queued ${northstarRun.id} and ${harborRun.id}. Dispatching…`);
	check("dispatch accepted", (await dispatch()) === 202, "agent-dispatch");

	const [northstarFinal, harborFinal] = await Promise.all([
		settle(NORTHSTAR, northstarRun.id),
		settle(HARBOR, harborRun.id),
	]);
	const made = calls().slice(before);
	console.log(`  Northstar run: ${JSON.stringify(northstarFinal)}`);
	console.log(`  Harbor run:    ${JSON.stringify(harborFinal)}`);
	console.log(`  MCP calls:     ${JSON.stringify(made)}`);

	check(
		"Northstar's deployed run succeeds",
		northstarFinal?.status === "SUCCEEDED",
		northstarFinal?.status ?? "never settled",
	);
	check(
		"the granted tool ran with Northstar's own token",
		made.some((call) => call.tool === "list_issues" && call.token === TOKEN_A),
		`${made.filter((call) => call.tool === "list_issues").length} list_issues call(s)`,
	);
	check(
		"the ungranted risky tool never ran",
		!made.some((call) => call.tool === "delete_issue"),
		"delete_issue is reviewed but not in the manifest",
	);
	check(
		"the run summary carries the tool result",
		(northstarFinal?.summary ?? "").includes(E2E.mcpLive.issueTitle),
		northstarFinal?.summary ?? "no summary",
	);
	check(
		"Harbor's run reaches no other workspace's MCP connection",
		harborFinal !== null &&
			made.every((call) => call.token === TOKEN_A) &&
			made.filter((call) => call.tool).length ===
				made.filter((call) => call.tool && call.token === TOKEN_A).length,
		`Harbor ${harborFinal?.status ?? "never settled"}: ${harborFinal?.summary ?? harborFinal?.errorMessage ?? ""}`,
	);
	const harborEvents = await runInTenant(HARBOR, () =>
		db.agentAction.count({
			where: { runId: harborRun.id, type: "mcp.tool.call" },
		}),
	);
	check(
		"Harbor recorded no MCP action",
		harborEvents === 0,
		`${harborEvents} mcp.tool.call action(s)`,
	);
} finally {
	await cleanup(registrations);
}

const ok = results.every((result) => result.ok);
console.log(ok ? "\nPASS  live MCP run" : "\nFAIL  live MCP run");
await db.$disconnect();
process.exit(ok ? 0 : 1);
