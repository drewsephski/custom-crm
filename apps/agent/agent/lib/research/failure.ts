import {
	APIConnectionError,
	APIConnectionTimeoutError,
	APIError,
	APIUserAbortError,
} from "context.dev/core/error";
import { z } from "zod";
import { creditsFromHeaders } from "./provider";

const SECOND_MS = 1_000;

export const FAILURE_KINDS = [
	"rate-limited",
	"timeout",
	"connection",
	"server",
	"conflict",
	"rejected",
	"unauthorized",
	"provider-credits-exhausted",
	"not-found",
	"aborted",
	"unexpected",
] as const;

export type FailureKind = (typeof FAILURE_KINDS)[number];

export type ProviderFailure = {
	kind: FailureKind;
	status: number | null;
	code: string | null;
	retryable: boolean;
	retryAfterMs: number | null;
	creditsUsed: number | null;
};

const errorBody = z
	.object({ error_code: z.string().trim().max(80).optional().catch(undefined) })
	.catch({});

const CREDIT_CODES = /(usage|credit|quota|allowance|billing)/i;

const TIMEOUT_NAMES = ["TimeoutError", "AbortError"];

function failure(
	kind: FailureKind,
	retryable: boolean,
	extra: Partial<ProviderFailure> = {},
): ProviderFailure {
	return {
		kind,
		retryable,
		status: null,
		code: null,
		retryAfterMs: null,
		creditsUsed: null,
		...extra,
	};
}

export function retryAfterMs(
	headers: Headers | null | undefined,
	now: Date,
): number | null {
	const millis = Number(headers?.get("retry-after-ms"));
	if (
		headers?.has("retry-after-ms") &&
		Number.isFinite(millis) &&
		millis >= 0
	) {
		return Math.ceil(millis);
	}

	const raw = headers?.get("retry-after")?.trim();
	if (!raw) return null;

	const seconds = Number(raw);
	if (Number.isFinite(seconds) && seconds >= 0) {
		return Math.ceil(seconds * SECOND_MS);
	}

	const at = Date.parse(raw);
	return Number.isNaN(at) ? null : Math.max(0, at - now.getTime());
}

export function classifyFailure(cause: unknown, now: Date): ProviderFailure {
	if (cause instanceof APIUserAbortError) return failure("timeout", true);
	if (cause instanceof APIConnectionTimeoutError)
		return failure("timeout", true);
	if (cause instanceof APIConnectionError) return failure("connection", true);

	if (!(cause instanceof APIError)) {
		const timedOut =
			cause instanceof Error && TIMEOUT_NAMES.includes(cause.name);
		return timedOut ? failure("timeout", true) : failure("unexpected", false);
	}

	const status = cause.status ?? null;
	if (status === null) return failure("connection", true);

	const code = errorBody.parse(cause.error).error_code ?? null;
	const extra = {
		status,
		code,
		creditsUsed: creditsFromHeaders(cause.headers),
	};

	if (status === 429) {
		return failure("rate-limited", true, {
			...extra,
			retryAfterMs: retryAfterMs(cause.headers, now),
		});
	}

	if (status === 408) return failure("timeout", true, extra);
	if (status === 409) return failure("conflict", true, extra);
	if (status >= 500) return failure("server", true, extra);

	if (status === 402 || (status === 403 && code && CREDIT_CODES.test(code))) {
		return failure("provider-credits-exhausted", false, extra);
	}

	if (status === 401 || status === 403) {
		return failure("unauthorized", false, extra);
	}

	if (status === 404) return failure("not-found", false, extra);

	return failure("rejected", false, extra);
}

export function failureLabel(value: ProviderFailure): string {
	return value.status === null
		? value.kind
		: `${value.kind} (provider status ${value.status})`;
}
