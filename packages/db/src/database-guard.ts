import {
	DATABASE_HOST,
	databaseHost,
	isLocalHost,
	parseDevHosts,
} from "./database-host";

export const DATABASE_GUARD = {
	devHostsVariable: DATABASE_HOST.devHostsVariable,
	protectedHostsVariable: "PROTECTED_DATABASE_HOSTS",
	branchVariable: "NEON_BRANCH",
	allowRemoteVariable: "ALLOW_REMOTE_DB",
	allowProductionMigrateVariable: "ALLOW_PRODUCTION_MIGRATE",
	protectedBranches: ["production", "prod", "main", "live"],
} as const;

export type GuardSource = {
	from: string;
	values: Record<string, string | undefined>;
};

export type GuardTarget = {
	url: string;
	host: string;
	from: string;
	branch: string | null;
};

export type GuardVerdict =
	| { allowed: true; reason: "local" | "development" | "override" }
	| {
			allowed: false;
			reason: "protected-host" | "protected-branch" | "remote";
	  };

export type GuardDecision = GuardVerdict & { target: GuardTarget };

function setting(sources: GuardSource[], name: string): string | undefined {
	for (const { values } of sources) {
		const value = values[name];
		if (value !== undefined) return value;
	}
	return undefined;
}

export function guardTargets(sources: GuardSource[]): GuardTarget[] {
	const targets: GuardTarget[] = [];

	for (const { from, values } of sources) {
		const url = values.DATABASE_URL?.trim();
		if (!url) continue;

		const host = databaseHost(url).toLowerCase();
		const branch =
			values[DATABASE_GUARD.branchVariable]?.trim().toLowerCase() ||
			setting(sources, DATABASE_GUARD.branchVariable)?.trim().toLowerCase() ||
			null;
		const existing = targets.find((target) => target.host === host);
		if (existing) {
			if (isProtectedBranch(branch)) existing.branch = branch;
			continue;
		}

		targets.push({
			url,
			host,
			from,
			branch,
		});
	}

	return targets;
}

export function isProtectedBranch(branch: string | null): boolean {
	return (
		branch !== null &&
		DATABASE_GUARD.protectedBranches.some((name) => name === branch)
	);
}

export function isProtectedTarget(
	target: GuardTarget,
	sources: GuardSource[],
): "protected-host" | "protected-branch" | null {
	const protectedHosts = sources.flatMap(({ values }) =>
		parseDevHosts(values[DATABASE_GUARD.protectedHostsVariable]),
	);

	if (protectedHosts.includes(target.host)) return "protected-host";

	if (
		target.host.endsWith(DATABASE_HOST.neonSuffix) &&
		isProtectedBranch(target.branch)
	) {
		return "protected-branch";
	}

	return null;
}

function judge(target: GuardTarget, sources: GuardSource[]): GuardVerdict {
	if (isLocalHost(target.host)) return { allowed: true, reason: "local" };

	const protection = isProtectedTarget(target, sources);
	if (protection) return { allowed: false, reason: protection };

	const devHosts = parseDevHosts(
		setting(sources, DATABASE_GUARD.devHostsVariable),
	);
	if (devHosts.includes(target.host)) {
		return { allowed: true, reason: "development" };
	}

	if (setting(sources, DATABASE_GUARD.allowRemoteVariable) === "1") {
		return { allowed: true, reason: "override" };
	}

	return { allowed: false, reason: "remote" };
}

export function guardDevelopmentCommand(
	sources: GuardSource[],
): GuardDecision[] {
	return guardTargets(sources).map((target) => ({
		...judge(target, sources),
		target,
	}));
}

export type DeployVerdict =
	| { allowed: true; reason: "unprotected" | "release" | "confirmed" }
	| {
			allowed: false;
			reason: "protected-host" | "protected-branch" | "remote";
	  };

export type DeployDecision = DeployVerdict & { target: GuardTarget };

export function guardDeployCommand(sources: GuardSource[]): DeployDecision[] {
	const releasing = setting(sources, "VERCEL_ENV") === "production";
	const confirmed =
		setting(sources, DATABASE_GUARD.allowProductionMigrateVariable) === "1";

	return guardTargets(sources).map((target): DeployDecision => {
		const development = judge(target, sources);
		if (development.allowed && development.reason !== "override") {
			return { allowed: true, reason: "unprotected", target };
		}
		if (releasing) return { allowed: true, reason: "release", target };
		if (confirmed) return { allowed: true, reason: "confirmed", target };
		return {
			allowed: false,
			reason: development.allowed ? "remote" : development.reason,
			target,
		};
	});
}
