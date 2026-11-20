import type { ResearchSettings, WindowLimit } from "./research-config";

type Waiter = { grant: (acquired: boolean) => void };

class Semaphore {
	private active = 0;
	private readonly waiting: Waiter[] = [];

	constructor(
		private readonly width: number,
		private readonly maxQueue: number,
	) {}

	get idle(): boolean {
		return this.active === 0 && this.waiting.length === 0;
	}

	acquire(maxWaitMs: number): Promise<boolean> {
		if (this.active < this.width) {
			this.active += 1;
			return Promise.resolve(true);
		}

		if (this.waiting.length >= this.maxQueue || maxWaitMs <= 0) {
			return Promise.resolve(false);
		}

		return new Promise((resolve) => {
			const waiter: Waiter = {
				grant: (acquired) => {
					clearTimeout(timer);
					resolve(acquired);
				},
			};

			const timer = setTimeout(() => {
				const index = this.waiting.indexOf(waiter);
				if (index !== -1) this.waiting.splice(index, 1);
				resolve(false);
			}, maxWaitMs);

			this.waiting.push(waiter);
		});
	}

	release(): void {
		const next = this.waiting.shift();
		if (next) next.grant(true);
		else this.active = Math.max(0, this.active - 1);
	}
}

export type GateResult<T> =
	| { ran: true; value: T }
	| { ran: false; retryAfterMs: number };

export type Gate = {
	run<T>(
		workspace: string | null,
		task: () => Promise<T>,
	): Promise<GateResult<T>>;
};

export function createGate(settings: ResearchSettings["concurrency"]): Gate {
	const global = new Semaphore(settings.global, settings.maxQueue);
	const workspaces = new Map<string, Semaphore>();

	const workspaceSlot = (workspace: string): Semaphore => {
		const existing = workspaces.get(workspace);
		if (existing) return existing;

		const created = new Semaphore(settings.perWorkspace, settings.maxQueue);
		workspaces.set(workspace, created);
		return created;
	};

	return {
		async run(workspace, task) {
			const refused = { ran: false, retryAfterMs: settings.maxWaitMs } as const;
			const local = workspace === null ? null : workspaceSlot(workspace);

			if (local && !(await local.acquire(settings.maxWaitMs))) return refused;

			try {
				if (!(await global.acquire(settings.maxWaitMs))) return refused;

				try {
					return { ran: true, value: await task() };
				} finally {
					global.release();
				}
			} finally {
				if (local && workspace !== null) {
					local.release();
					if (local.idle) workspaces.delete(workspace);
				}
			}
		},
	};
}

export type ThrottleResult = { ok: true } | { ok: false; retryAfterMs: number };

export type Throttle = { take(key: string, now: Date): ThrottleResult };

export function createThrottle(limit: WindowLimit, maxKeys: number): Throttle {
	const hits = new Map<string, number[]>();

	return {
		take(key, now) {
			const at = now.getTime();
			const recent = (hits.get(key) ?? []).filter(
				(time) => time > at - limit.windowMs,
			);

			const oldest = recent[0];
			if (recent.length >= limit.limit && oldest !== undefined) {
				hits.set(key, recent);
				return { ok: false, retryAfterMs: oldest + limit.windowMs - at };
			}

			hits.delete(key);
			hits.set(key, [...recent, at]);

			while (hits.size > maxKeys) {
				const first = hits.keys().next();
				if (first.done) break;
				hits.delete(first.value);
			}

			return { ok: true };
		},
	};
}
