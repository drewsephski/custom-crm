export type SlackBackfillCandidate = {
	organizationId: string;
	grantTeamId: string | null;
	connected: boolean;
};

export type SlackBackfillDecision =
	| { kind: "assign"; organizationId: string }
	| { kind: "skip"; reason: string };

export function chooseSlackOrganization(
	teamId: string,
	candidates: readonly SlackBackfillCandidate[],
): SlackBackfillDecision {
	const open = candidates.filter((candidate) => !candidate.connected);
	const sameTeam = open.filter((candidate) => candidate.grantTeamId === teamId);
	if (sameTeam.length === 1 && sameTeam[0]) {
		return { kind: "assign", organizationId: sameTeam[0].organizationId };
	}
	if (sameTeam.length > 1) {
		return {
			kind: "skip",
			reason: `${sameTeam.length} workspaces hold a grant for this Slack team`,
		};
	}

	const unclaimed = open.filter((candidate) => candidate.grantTeamId === null);
	if (unclaimed.length === 1 && unclaimed[0]) {
		return { kind: "assign", organizationId: unclaimed[0].organizationId };
	}

	return {
		kind: "skip",
		reason:
			unclaimed.length === 0
				? "no workspace of this installer is waiting for this Slack team"
				: `${unclaimed.length} workspaces of this installer could own this token`,
	};
}
