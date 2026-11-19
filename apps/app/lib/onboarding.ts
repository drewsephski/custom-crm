import {
	NO_WORKSPACE_MESSAGE,
	WORKSPACE_HEADER,
} from "@crm/auth/workspace-header";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { API_URL } from "@/lib/env";

export const ONBOARDING_PATH = "/onboarding";

export const RESEARCH_PATH = "/onboarding/research";

const GATE_TIMEOUT_MS = 2_000;

const procedureResult = z
	.object({ result: z.object({ data: z.json() }).catch({ data: null }) })
	.catch({ result: { data: null } });

const procedureError = z
	.object({
		error: z
			.object({
				message: z.string().catch(""),
				data: z.object({ code: z.string().catch("") }).catch({ code: "" }),
			})
			.catch({ message: "", data: { code: "" } }),
	})
	.catch({ error: { message: "", data: { code: "" } } });

const workspaceAnswer = z.object({
	onboarded: z.boolean(),
	canRename: z.boolean(),
	slug: z.string().min(1),
});

export type WorkspaceGate =
	| { kind: "workspace"; slug: string; onboarded: boolean; canRename: boolean }
	| { kind: "no-workspace" }
	| { kind: "not-a-member" }
	| { kind: "unknown" };

export async function readWorkspaceGate(
	request: NextRequest,
	slug: string | null,
): Promise<WorkspaceGate> {
	const cookie = request.headers.get("cookie");
	if (!cookie) return { kind: "unknown" };

	try {
		const response = await fetch(`${API_URL}/api/trpc/workspace.get`, {
			headers: { cookie, ...(slug && { [WORKSPACE_HEADER]: slug }) },
			cache: "no-store",
			signal: AbortSignal.timeout(GATE_TIMEOUT_MS),
		});

		if (!response.ok) {
			const { error } = procedureError.parse(
				await response.json().catch(() => null),
			);
			if (error.message === NO_WORKSPACE_MESSAGE)
				return { kind: "no-workspace" };
			if (error.data.code === "FORBIDDEN") return { kind: "not-a-member" };
			return { kind: "unknown" };
		}

		const parsed = workspaceAnswer.safeParse(
			procedureResult.parse(await response.json()).result.data,
		);
		return parsed.success
			? { kind: "workspace", ...parsed.data }
			: { kind: "unknown" };
	} catch {
		return { kind: "unknown" };
	}
}
