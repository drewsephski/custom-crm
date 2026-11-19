export const DEFAULT_PIPELINE_NAME = "Sales pipeline";

export const DEFAULT_PIPELINE_STAGES = [
	{ key: "new_inquiry", label: "New Inquiry", outcome: "OPEN", probability: 5 },
	{ key: "qualified", label: "Qualified", outcome: "OPEN", probability: 20 },
	{ key: "discovery", label: "Discovery", outcome: "OPEN", probability: 35 },
	{
		key: "proposal_sent",
		label: "Proposal Sent",
		outcome: "OPEN",
		probability: 55,
	},
	{
		key: "negotiation",
		label: "Negotiation",
		outcome: "OPEN",
		probability: 75,
	},
	{ key: "won", label: "Won", outcome: "WON", probability: 100 },
	{ key: "lost", label: "Lost", outcome: "LOST", probability: 0 },
] as const;
