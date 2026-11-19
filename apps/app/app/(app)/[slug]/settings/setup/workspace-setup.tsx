"use client";

import { Badge } from "@crm/ui/components/badge";
import { Button } from "@crm/ui/components/button";
import { Field, FieldDescription, FieldLabel } from "@crm/ui/components/field";
import { Input } from "@crm/ui/components/input";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@crm/ui/components/select";
import { SettingsCard } from "@crm/ui/components/settings-card";
import { Spinner } from "@crm/ui/components/spinner";
import { Textarea } from "@crm/ui/components/textarea";
import type {
	AgencyType,
	BusinessProfile,
	EngagementModel,
	WorkspaceConfig,
} from "@crm/validation/workspace-config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { XIcon } from "lucide-react";
import { useId, useState } from "react";
import { toast } from "sonner";
import { useTRPC } from "@/lib/trpc/client";
import { PipelinePlanDialog } from "./pipeline-plan-dialog";

const POLL_MS = 2_000;

const AGENCY_TYPES = [
	{ value: "web", label: "Web development" },
	{ value: "marketing", label: "Digital marketing" },
	{ value: "ai", label: "AI and automation" },
	{ value: "mixed", label: "A mix of these" },
] as const satisfies readonly { value: AgencyType; label: string }[];

const ENGAGEMENTS = [
	{ value: "one-time", label: "One-time projects" },
	{ value: "recurring", label: "Recurring retainers" },
	{ value: "both", label: "Both" },
] as const satisfies readonly { value: EngagementModel; label: string }[];

function agencyTypeOf(value: string): AgencyType | null {
	return AGENCY_TYPES.find((option) => option.value === value)?.value ?? null;
}

function engagementOf(value: string): EngagementModel | null {
	return ENGAGEMENTS.find((option) => option.value === value)?.value ?? null;
}

export function WorkspaceSetup() {
	const trpc = useTRPC();
	const state = useQuery({
		...trpc.workspaceConfig.state.queryOptions(),
		refetchInterval: (query) =>
			query.state.data?.proposals.some((p) => p.status === "GENERATING")
				? POLL_MS
				: false,
	});

	if (!state.data) return null;

	const { canConfigure, aiAvailable, applied, proposals, pipelineInSync } =
		state.data;

	return (
		<div className="flex flex-col gap-6">
			{applied ? (
				<SettingsCard
					title={`Version ${applied.version} is live`}
					description={
						pipelineInSync
							? `Applied ${new Date(applied.appliedAt ?? applied.createdAt).toLocaleString()} from the ${applied.source === "AI" ? "AI proposal" : "agency template"}.`
							: "The Deals page still uses the earlier stages. Review the stage changes to put this pipeline live."
					}
					status={
						pipelineInSync ? null : <Badge variant="secondary">Not live</Badge>
					}
					action={
						!pipelineInSync && canConfigure ? (
							<ReviewStagesButton versionId={applied.id} />
						) : null
					}
				>
					<PipelinePreview config={applied.config} />
				</SettingsCard>
			) : null}

			{canConfigure ? (
				<ProfileForm aiAvailable={aiAvailable} />
			) : (
				<p className="text-muted-foreground text-sm">
					Only an owner or an admin can change how this workspace is set up.
				</p>
			)}

			{proposals.map((proposal) =>
				proposal.status === "GENERATING" ? (
					<SettingsCard
						key={proposal.id}
						title="Designing your workspace"
						description="Claude is reading your description. The template below is ready now if you would rather not wait."
						status={<Spinner />}
					/>
				) : proposal.status === "FAILED" ? (
					<SettingsCard
						key={proposal.id}
						title="The AI proposal did not finish"
						description={`${proposal.error ?? "It stopped without a reason."} The agency template is still available.`}
						tone="destructive"
					/>
				) : proposal.config ? (
					<ProposalEditor
						key={proposal.id}
						id={proposal.id}
						version={proposal.version}
						source={proposal.source}
						config={proposal.config}
						canConfigure={canConfigure}
					/>
				) : null,
			)}
		</div>
	);
}

function ReviewStagesButton({ versionId }: { versionId: string }) {
	const [reviewing, setReviewing] = useState(false);

	return (
		<>
			<Button size="sm" onClick={() => setReviewing(true)}>
				Review stage changes
			</Button>
			<PipelinePlanDialog
				versionId={versionId}
				open={reviewing}
				onOpenChange={setReviewing}
			/>
		</>
	);
}

function PipelinePreview({ config }: { config: WorkspaceConfig | null }) {
	if (!config) return null;
	return (
		<div className="flex flex-wrap gap-2">
			{config.pipeline.map((stage) => (
				<Badge
					key={stage.key}
					variant={stage.outcome === "open" ? "secondary" : "outline"}
				>
					{stage.label}
				</Badge>
			))}
		</div>
	);
}

function ProfileForm({ aiAvailable }: { aiAvailable: boolean }) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const workspace = useQuery(trpc.workspace.get.queryOptions());
	const ids = {
		type: useId(),
		description: useId(),
		services: useId(),
		engagement: useId(),
	};
	const [agencyType, setAgencyType] = useState<AgencyType>("mixed");
	const [engagement, setEngagement] = useState<EngagementModel>("both");
	const [description, setDescription] = useState("");
	const [services, setServices] = useState("");

	const propose = useMutation(
		trpc.workspaceConfig.propose.mutationOptions({
			onSuccess: async () => {
				await queryClient.invalidateQueries({
					queryKey: trpc.workspaceConfig.state.queryKey(),
				});
				toast.success("Your proposal is ready to review below.");
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const serviceList = services
		.split(",")
		.map((entry) => entry.trim())
		.filter(Boolean);

	return (
		<SettingsCard
			title="Describe your agency"
			description={
				aiAvailable
					? "Claude proposes a setup from your answers. A ready-made agency template appears at once, so you are never waiting on it."
					: "AI proposals are not available right now: they need ANTHROPIC_API_KEY and a running agent. You get the ready-made agency template for your type of work."
			}
			action={
				<Button
					type="submit"
					form="business-profile"
					size="sm"
					disabled={
						propose.isPending ||
						description.trim().length < 10 ||
						serviceList.length === 0
					}
				>
					{propose.isPending ? <Spinner data-icon="inline-start" /> : null}
					Propose a setup
				</Button>
			}
		>
			<form
				id="business-profile"
				className="flex flex-col gap-4"
				onSubmit={(event) => {
					event.preventDefault();
					const profile: BusinessProfile = {
						agencyName: workspace.data?.name ?? "Agency",
						website: workspace.data?.website ?? null,
						agencyType,
						description: description.trim(),
						services: serviceList,
						engagement,
					};
					propose.mutate(profile);
				}}
			>
				<div className="flex flex-col gap-4 sm:flex-row">
					<Field className="flex-1">
						<FieldLabel htmlFor={ids.type}>What you do</FieldLabel>
						<Select
							value={agencyType}
							onValueChange={(value) => {
								const next = agencyTypeOf(value);
								if (next) setAgencyType(next);
							}}
						>
							<SelectTrigger id={ids.type}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{AGENCY_TYPES.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field className="flex-1">
						<FieldLabel htmlFor={ids.engagement}>How clients pay</FieldLabel>
						<Select
							value={engagement}
							onValueChange={(value) => {
								const next = engagementOf(value);
								if (next) setEngagement(next);
							}}
						>
							<SelectTrigger id={ids.engagement}>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{ENGAGEMENTS.map((option) => (
									<SelectItem key={option.value} value={option.value}>
										{option.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
				</div>
				<Field>
					<FieldLabel htmlFor={ids.description}>
						How your agency works
					</FieldLabel>
					<Textarea
						id={ids.description}
						value={description}
						onChange={(event) => setDescription(event.target.value)}
						placeholder="We build websites and AI automations for local businesses. We charge upfront project fees and monthly maintenance plans."
						rows={4}
					/>
				</Field>
				<Field>
					<FieldLabel htmlFor={ids.services}>Services you sell</FieldLabel>
					<Input
						id={ids.services}
						value={services}
						onChange={(event) => setServices(event.target.value)}
						placeholder="Website development, AI automation, Monthly maintenance"
					/>
					<FieldDescription>Separate them with commas.</FieldDescription>
				</Field>
			</form>
		</SettingsCard>
	);
}

function ProposalEditor({
	id,
	version,
	source,
	config: initial,
	canConfigure,
}: {
	id: string;
	version: number;
	source: "TEMPLATE" | "AI";
	config: WorkspaceConfig;
	canConfigure: boolean;
}) {
	const trpc = useTRPC();
	const queryClient = useQueryClient();
	const [config, setConfig] = useState(initial);
	const [stepIds] = useState(() =>
		initial.onboardingChecklist.map(() => crypto.randomUUID()),
	);
	const refresh = () =>
		queryClient.invalidateQueries({
			queryKey: trpc.workspaceConfig.state.queryKey(),
		});

	const [reviewing, setReviewing] = useState(false);
	const edit = useMutation(
		trpc.workspaceConfig.edit.mutationOptions({
			onSuccess: async () => {
				await Promise.all([
					refresh(),
					queryClient.invalidateQueries({
						queryKey: trpc.workspaceConfig.pipelinePlan.queryKey({
							versionId: id,
						}),
					}),
				]);
				setReviewing(true);
			},
			onError: (error) => toast.error(error.message),
		}),
	);

	const busy = edit.isPending;

	const setStage = (index: number, label: string) =>
		setConfig((current) => ({
			...current,
			pipeline: current.pipeline.map((stage, i) =>
				i === index ? { ...stage, label } : stage,
			),
		}));
	const setField = (index: number, label: string) =>
		setConfig((current) => ({
			...current,
			fields: current.fields.map((field, i) =>
				i === index ? { ...field, label } : field,
			),
		}));
	const dropField = (index: number) =>
		setConfig((current) => ({
			...current,
			fields: current.fields.filter((_, i) => i !== index),
		}));
	const setStep = (index: number, label: string) =>
		setConfig((current) => ({
			...current,
			onboardingChecklist: current.onboardingChecklist.map((step, i) =>
				i === index ? label : step,
			),
		}));

	return (
		<SettingsCard
			title={`Proposal ${version}`}
			description={
				source === "AI"
					? "Proposed by Claude from your description. Nothing changes until you apply it."
					: "The agency template for your type of work. Nothing changes until you apply it."
			}
			status={
				<Badge variant="secondary">{source === "AI" ? "AI" : "Template"}</Badge>
			}
			action={
				canConfigure ? (
					<>
						<Button
							size="sm"
							disabled={busy}
							onClick={() => edit.mutate({ versionId: id, config })}
						>
							{busy ? <Spinner data-icon="inline-start" /> : null}
							Review and apply
						</Button>
						<PipelinePlanDialog
							versionId={id}
							open={reviewing}
							onOpenChange={setReviewing}
						/>
					</>
				) : null
			}
		>
			<div className="flex flex-col gap-6">
				<section className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">Pipeline stages</h3>
					<div className="grid gap-2 sm:grid-cols-2">
						{config.pipeline.map((stage, index) => (
							<Input
								key={stage.key}
								aria-label={`Stage ${index + 1}`}
								value={stage.label}
								disabled={!canConfigure || busy}
								onChange={(event) => setStage(index, event.target.value)}
							/>
						))}
					</div>
				</section>

				<section className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">Custom fields</h3>
					<ul className="flex flex-col gap-2">
						{config.fields.map((field, index) => (
							<li
								key={`${field.entity}:${field.key}`}
								className="flex items-center gap-2"
							>
								<Input
									aria-label={`Field ${index + 1}`}
									value={field.label}
									disabled={!canConfigure || busy}
									onChange={(event) => setField(index, event.target.value)}
								/>
								<Badge variant="outline">{field.entity.toLowerCase()}</Badge>
								<Button
									variant="ghost"
									size="icon"
									aria-label={`Remove ${field.label}`}
									disabled={!canConfigure || busy}
									onClick={() => dropField(index)}
								>
									<XIcon aria-hidden />
								</Button>
							</li>
						))}
					</ul>
				</section>

				<section className="flex flex-col gap-2">
					<h3 className="font-medium text-sm">Client onboarding checklist</h3>
					<div className="flex flex-col gap-2">
						{stepIds.map((stepId, index) => (
							<Input
								key={stepId}
								aria-label={`Onboarding step ${index + 1}`}
								value={config.onboardingChecklist[index] ?? ""}
								disabled={!canConfigure || busy}
								onChange={(event) => setStep(index, event.target.value)}
							/>
						))}
					</div>
				</section>

				<section className="flex flex-col gap-2 text-sm">
					<h3 className="font-medium">Views, services and follow-ups</h3>
					<p className="text-muted-foreground">
						{config.views.map((view) => view.name).join(" · ")}
					</p>
					<p className="text-muted-foreground">
						{config.services.map((service) => service.label).join(" · ")}
					</p>
					<ul className="text-muted-foreground">
						{config.followUps.map((rule) => (
							<li key={rule.key}>
								{rule.label}: {rule.action}
							</li>
						))}
					</ul>
				</section>
			</div>
		</SettingsCard>
	);
}
