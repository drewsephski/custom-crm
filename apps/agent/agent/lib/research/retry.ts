import { classifyFailure, type ProviderFailure } from "./failure";
import type { CallOptions } from "./provider";
import type { ResearchSettings } from "./research-config";

export type RetryPolicy = ResearchSettings["retry"] & { timeoutMs: number };

export type RetryEnvironment = {
	now: () => Date;
	sleep: (ms: number) => Promise<void>;
	random: () => number;
	signal?: AbortSignal | undefined;
};

export type CallOutcome =
	| { ok: true; raw: unknown; attempts: number }
	| { ok: false; failure: ProviderFailure; attempts: number };

export function backoffMs(
	attempt: number,
	policy: RetryPolicy,
	random: () => number,
	retryAfter: number | null,
): number {
	const exponential = Math.min(
		policy.maxDelayMs,
		policy.baseDelayMs * 2 ** (attempt - 1),
	);
	const jittered = exponential * (1 - policy.jitter * random());

	return Math.ceil(Math.max(jittered, retryAfter ?? 0));
}

function aborted(signal: AbortSignal): Promise<never> {
	return new Promise((_, reject) => {
		const fail = () =>
			reject(new DOMException("The request timed out.", "TimeoutError"));

		if (signal.aborted) fail();
		else signal.addEventListener("abort", fail, { once: true });
	});
}

export async function callWithRetry(
	invoke: (options: CallOptions) => PromiseLike<unknown>,
	policy: RetryPolicy,
	environment: RetryEnvironment,
): Promise<CallOutcome> {
	const outer = environment.signal;
	const limit = Math.max(1, policy.maxAttempts);

	for (let attempt = 1; ; attempt += 1) {
		const timeout = AbortSignal.timeout(policy.timeoutMs);
		const signal = outer ? AbortSignal.any([outer, timeout]) : timeout;

		try {
			const raw = await Promise.race([
				invoke({ signal, timeout: policy.timeoutMs, maxRetries: 0 }),
				aborted(signal),
			]);

			return { ok: true, raw, attempts: attempt };
		} catch (cause) {
			const classified = classifyFailure(cause, environment.now());
			const failure: ProviderFailure = outer?.aborted
				? { ...classified, kind: "aborted", retryable: false }
				: classified;

			const overlong =
				failure.retryAfterMs !== null &&
				failure.retryAfterMs > policy.maxRetryAfterMs;

			if (!failure.retryable || attempt >= limit || overlong) {
				return { ok: false, failure, attempts: attempt };
			}

			await environment.sleep(
				backoffMs(attempt, policy, environment.random, failure.retryAfterMs),
			);

			if (outer?.aborted) {
				return {
					ok: false,
					failure: { ...failure, kind: "aborted", retryable: false },
					attempts: attempt,
				};
			}
		}
	}
}
