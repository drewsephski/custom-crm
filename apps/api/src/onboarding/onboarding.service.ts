import {
	canRenameWorkspace,
	DEFAULT_WORKSPACE_NAME,
	membershipOf,
} from "@crm/auth/organization";
import { type Db, Prisma } from "@crm/db";
import { runAsSystem, runInTenant } from "@crm/db/tenancy";
import { completeOnboarding, isOnboarded } from "@crm/db/workspace";
import { InvalidInput } from "@crm/validation";
import {
	type BusinessTypeKey,
	type GoalKey,
	knownGoals,
	nextStep,
	type OnboardingContext,
	type OnboardingDetails,
	type OnboardingStep,
	onboardingProfile,
	parseOnboardingDetails,
	pipelineProblem,
	presetConfig,
	previousStep,
	publicDomain,
	withPipeline,
} from "@crm/validation/onboarding";
import type { BrandPreviewStatus } from "@crm/validation/onboarding-brand";
import type { WorkspaceConfig } from "@crm/validation/workspace-config";
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { InjectDatabase } from "../database/database.constants";
import { listMemberships } from "../tenancy/workspace-resolver";
import { WorkspaceService } from "../workspace/workspace.service";
import { WorkspaceConfigService } from "../workspace-config/workspace-config.service";
import { BrandPreviewClient } from "./brand-preview.client";
import { ONBOARDING } from "./onboarding.config";
import type {
	BrandView,
	FinishResult,
	OnboardingProgressView,
	OnboardingState,
	SaveBusinessInput,
	SaveBusinessTypeInput,
	SaveCustomizeInput,
	SaveGoalsInput,
} from "./onboarding.contracts";
import {
	brandView,
	type OnboardingSession,
	progressOf,
	readSession,
	SESSION_SELECT,
} from "./onboarding.session";

const STORED_BRAND_STATUS = {
	ready: "READY",
	not_found: "NOT_FOUND",
	unavailable: "UNAVAILABLE",
	limited: "UNAVAILABLE",
	failed: "FAILED",
} as const satisfies Record<BrandPreviewStatus, string>;

const NOT_A_WEBSITE = "That is not a website. Enter the domain, like acme.com.";

const NO_OPEN_SETUP = "Your setup is not open. Reload the page.";

type LegacyWorkspace = { id: string; name: string; website: string | null };

type SessionChange = Prisma.OnboardingSessionUncheckedUpdateInput;

type OpenFinish = {
	kind: "open";
	sessionId: string;
	organizationId: string;
	website: string | null;
	businessName: string;
	businessType: BusinessTypeKey;
	goals: GoalKey[];
	details: OnboardingDetails;
	config: WorkspaceConfig;
	configVersionId: string | null;
};

type FinishStart = OpenFinish | { kind: "done"; result: FinishResult };

function reviewed(
	preset: SaveCustomizeInput["presetKey"],
	context: OnboardingContext,
	pipeline: WorkspaceConfig["pipeline"],
): WorkspaceConfig {
	try {
		return withPipeline(presetConfig(preset, context), pipeline);
	} catch (error) {
		if (error instanceof InvalidInput) {
			throw new BadRequestException(error.message);
		}
		throw error;
	}
}

function rebuilt(
	session: OnboardingSession,
	context: { businessType: BusinessTypeKey | null; goals: GoalKey[] },
): SessionChange {
	if (!session.presetKey || !session.config || !context.businessType) return {};

	return {
		config: reviewed(
			session.presetKey,
			{ businessType: context.businessType, goals: context.goals },
			session.config.pipeline,
		),
		configVersionId: null,
	};
}

@Injectable()
export class OnboardingService {
	private readonly logger = new Logger(OnboardingService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly workspaces: WorkspaceService,
		private readonly configs: WorkspaceConfigService,
		private readonly agent: AgentTriggerService,
		private readonly brands: BrandPreviewClient,
	) {}

	async state(
		userId: string,
		activeOrganizationId: string | null,
		another: boolean,
	): Promise<OnboardingState> {
		const open = await this.openSession(userId);
		if (open) return this.wizard(userId, open);

		const memberships = await listMemberships(this.db, userId);
		const legacy = await this.legacyWorkspace(
			memberships
				.filter((membership) => canRenameWorkspace(membership.role))
				.map((membership) => membership.organizationId),
		);

		if (!legacy && !another) {
			const active =
				memberships.find(
					(membership) => membership.organizationId === activeOrganizationId,
				) ?? memberships[0];
			if (active) return { kind: "done", slug: active.slug };
		}

		return this.wizard(userId, await this.startSession(userId, legacy));
	}

	saveBusinessType(
		userId: string,
		input: SaveBusinessTypeInput,
	): Promise<OnboardingProgressView> {
		return this.change(userId, "business-type", (session) => ({
			businessType: input.businessType,
			...rebuilt(session, {
				businessType: input.businessType,
				goals: session.goals,
			}),
			step: input.advance ? nextStep("business-type") : undefined,
		}));
	}

	saveGoals(
		userId: string,
		input: SaveGoalsInput,
	): Promise<OnboardingProgressView> {
		const goals = knownGoals(input.goals);

		if (input.advance && goals.length === 0) {
			throw new BadRequestException("Choose at least one goal.");
		}

		return this.change(userId, "goals", (session) => ({
			goals,
			...rebuilt(session, { businessType: session.businessType, goals }),
			step: input.advance ? nextStep("goals") : undefined,
		}));
	}

	saveBusiness(
		userId: string,
		input: SaveBusinessInput,
	): Promise<OnboardingProgressView> {
		const domain = input.website ? publicDomain(input.website) : null;

		if (input.advance && !input.businessName) {
			throw new BadRequestException("Enter your business name.");
		}
		if (input.advance && input.website && !domain) {
			throw new BadRequestException(NOT_A_WEBSITE);
		}

		return this.change(userId, "business", (session) => ({
			businessName: input.businessName || null,
			website: (input.advance ? domain : input.website) || null,
			details: parseOnboardingDetails({
				description: input.description,
				industry: input.industry,
				location: input.location,
				logoUrl:
					input.useLogo && domain && session.brand.domain === domain
						? (session.brand.found?.logoUrl ?? null)
						: null,
			}),
			step: input.advance ? nextStep("business") : undefined,
		}));
	}

	saveCustomize(
		userId: string,
		input: SaveCustomizeInput,
	): Promise<OnboardingProgressView> {
		const problem = pipelineProblem(input.pipeline);
		if (problem) throw new BadRequestException(problem);

		return this.change(userId, "customize", (session) => {
			if (!session.businessType) {
				throw new BadRequestException("Answer the earlier steps first.");
			}

			return {
				presetKey: input.presetKey,
				config: reviewed(
					input.presetKey,
					{ businessType: session.businessType, goals: session.goals },
					input.pipeline,
				),
				configVersionId: null,
				step: input.advance ? nextStep("customize") : undefined,
			};
		});
	}

	goTo(userId: string, step: OnboardingStep): Promise<OnboardingProgressView> {
		return this.change(userId, step, () => ({ step }));
	}

	back(userId: string): Promise<OnboardingProgressView> {
		return this.change(userId, "business-type", (session) => ({
			step: previousStep(session.step),
		}));
	}

	async lookupBrand(userId: string, website: string): Promise<BrandView> {
		const domain = publicDomain(website);
		if (!domain) return brandView("not_found", null, null);

		const [user, session] = await Promise.all([
			runAsSystem(ONBOARDING.scope, () =>
				this.db.user.findUnique({
					where: { id: userId },
					select: { emailVerified: true },
				}),
			),
			this.openSession(userId),
		]);

		if (!session) throw new NotFoundException(NO_OPEN_SETUP);

		if (!user?.emailVerified || !this.brands.available()) {
			return brandView("unavailable", domain, null);
		}

		if (session.brand.domain === domain && session.brand.status !== "idle") {
			return brandView(session.brand.status, domain, session.brand.found);
		}

		const now = new Date();
		const reserved = await runAsSystem(ONBOARDING.scope, () =>
			this.db.onboardingSession.updateMany({
				where: {
					id: session.id,
					userId,
					completedAt: null,
					brandLookups: { lt: ONBOARDING.brand.maxLookups },
					OR: [
						{ brandLookupAt: null },
						{
							brandLookupAt: {
								lte: new Date(now.getTime() - ONBOARDING.brand.cooldownMs),
							},
						},
					],
				},
				data: { brandLookups: { increment: 1 }, brandLookupAt: now },
			}),
		);

		if (reserved.count === 0) return brandView("limited", domain, null);

		const answer = await this.brands.preview({ website: domain, userId });
		const found = answer.status === "ready" ? answer.brand : null;

		await runAsSystem(ONBOARDING.scope, () =>
			this.db.onboardingSession.updateMany({
				where: { id: session.id, userId, completedAt: null },
				data: {
					brandStatus: STORED_BRAND_STATUS[answer.status],
					brandDomain: domain,
					brand: found ?? Prisma.DbNull,
				},
			}),
		);

		this.logger.log({
			message: "Onboarding brand lookup answered",
			userId,
			status: answer.status,
		});

		return brandView(answer.status, domain, found);
	}

	async finish(
		userId: string,
		authSessionId: string | null,
	): Promise<FinishResult> {
		const start = await this.ensureWorkspace(userId);
		if (start.kind === "done") return start.result;

		const pipelineApplied = await this.ensureConfiguration(userId, start);

		if (start.website) {
			const website = start.website;
			await runInTenant(start.organizationId, () =>
				this.agent.workspaceChanged(
					website,
					"The company using this CRM said what its website is",
				),
			);
		}

		return this.complete(userId, authSessionId, start, pipelineApplied);
	}

	private ensureWorkspace(userId: string): Promise<FinishStart> {
		return runAsSystem(ONBOARDING.scope, () =>
			this.db.$transaction(async (tx): Promise<FinishStart> => {
				const session = await this.lockOpen(tx, userId);
				if (!session) {
					return { kind: "done", result: await this.lastFinished(tx, userId) };
				}

				const { businessType, config } = session;
				if (!session.reachable.includes("finish") || !businessType || !config) {
					throw new BadRequestException(
						"Answer every step before you create the workspace.",
					);
				}

				const website = session.website ? publicDomain(session.website) : null;
				if (session.website && !website) {
					throw new BadRequestException(NOT_A_WEBSITE);
				}

				const workspace = session.organizationId
					? await this.adopt(tx, userId, session.organizationId, {
							name: session.businessName,
							website,
						})
					: await this.workspaces.createWithin(tx, {
							userId,
							sessionId: null,
							name: session.businessName,
							website,
							onboarded: false,
						});

				if (!session.organizationId) {
					await tx.onboardingSession.update({
						where: { id: session.id },
						data: { organizationId: workspace.id },
						select: { id: true },
					});
					this.logger.log({
						message: "Onboarding workspace created",
						userId,
						organizationId: workspace.id,
					});
				}

				return {
					kind: "open",
					sessionId: session.id,
					organizationId: workspace.id,
					website,
					businessName: session.businessName,
					businessType,
					goals: session.goals,
					details: session.details,
					config,
					configVersionId: session.configVersionId,
				};
			}, ONBOARDING.transaction),
		);
	}

	private async adopt(
		tx: Prisma.TransactionClient,
		userId: string,
		organizationId: string,
		input: { name: string; website: string | null },
	): Promise<{ id: string }> {
		const membership = await membershipOf(userId, organizationId, tx);

		if (!canRenameWorkspace(membership?.role ?? null)) {
			throw new ForbiddenException(
				"Only an owner or an admin can finish the setup of this workspace.",
			);
		}

		return this.workspaces.renameWithin(tx, organizationId, input);
	}

	private ensureConfiguration(
		userId: string,
		start: OpenFinish,
	): Promise<boolean> {
		return runInTenant(start.organizationId, async () => {
			const versionId =
				start.configVersionId ?? (await this.storeConfiguration(userId, start));

			try {
				await this.configs.apply(userId, { versionId, stageMapping: {} });
				return true;
			} catch (error) {
				if (!(error instanceof BadRequestException)) throw error;

				this.logger.warn({
					message: "Onboarding pipeline needs a review before it goes live",
					userId,
					organizationId: start.organizationId,
					versionId,
				});
				return false;
			}
		});
	}

	private async storeConfiguration(
		userId: string,
		start: OpenFinish,
	): Promise<string> {
		const version = await this.configs.createReviewed(
			userId,
			onboardingProfile({
				businessName: start.businessName,
				website: start.website,
				businessType: start.businessType,
				goals: start.goals,
				details: start.details,
			}),
			start.config,
		);

		await runAsSystem(ONBOARDING.scope, () =>
			this.db.onboardingSession.updateMany({
				where: { id: start.sessionId, userId, completedAt: null },
				data: { configVersionId: version.id },
			}),
		);

		return version.id;
	}

	private complete(
		userId: string,
		authSessionId: string | null,
		start: OpenFinish,
		pipelineApplied: boolean,
	): Promise<FinishResult> {
		return runAsSystem(ONBOARDING.scope, () =>
			this.db.$transaction(async (tx) => {
				const session = await this.lockOpen(tx, userId);
				if (!session) return this.lastFinished(tx, userId);

				if (
					session.id !== start.sessionId ||
					session.organizationId !== start.organizationId
				) {
					throw new ConflictException(
						"Your setup changed in another tab. Reload the page.",
					);
				}

				const organization = await tx.organization.findUnique({
					where: { id: start.organizationId },
					select: { slug: true, metadata: true },
				});
				if (!organization) {
					throw new NotFoundException("That workspace does not exist.");
				}

				const at = new Date();
				await tx.organization.update({
					where: { id: start.organizationId },
					data: {
						metadata: completeOnboarding(organization.metadata, {
							at,
							businessType: start.businessType,
							goals: start.goals,
						}),
						...(start.details.logoUrl && { logo: start.details.logoUrl }),
					},
					select: { id: true },
				});

				if (authSessionId) {
					await tx.session.updateMany({
						where: { id: authSessionId, userId },
						data: { activeOrganizationId: start.organizationId },
					});
				}

				await tx.onboardingSession.update({
					where: { id: session.id },
					data: { completedAt: at, step: "finish" },
					select: { id: true },
				});

				this.logger.log({
					message: "Onboarding finished",
					userId,
					organizationId: start.organizationId,
					pipelineApplied,
				});

				return { slug: organization.slug, pipelineApplied };
			}, ONBOARDING.transaction),
		);
	}

	private async lastFinished(
		tx: Prisma.TransactionClient,
		userId: string,
	): Promise<FinishResult> {
		const finished = await tx.onboardingSession.findFirst({
			where: {
				userId,
				completedAt: { not: null },
				organization: { members: { some: { userId } } },
			},
			orderBy: { completedAt: "desc" },
			select: { organization: { select: { slug: true } } },
		});

		if (!finished?.organization) {
			throw new NotFoundException(NO_OPEN_SETUP);
		}

		return { slug: finished.organization.slug, pipelineApplied: true };
	}

	private change(
		userId: string,
		step: OnboardingStep,
		build: (session: OnboardingSession) => SessionChange,
	): Promise<OnboardingProgressView> {
		return runAsSystem(ONBOARDING.scope, () =>
			this.db.$transaction(async (tx) => {
				const session = await this.lockOpen(tx, userId);
				if (!session) throw new NotFoundException(NO_OPEN_SETUP);

				if (!session.reachable.includes(step)) {
					throw new BadRequestException("Answer the earlier steps first.");
				}

				const row = await tx.onboardingSession.update({
					where: { id: session.id },
					data: build(session),
					select: SESSION_SELECT,
				});

				return progressOf(readSession(row));
			}, ONBOARDING.transaction),
		);
	}

	private async lockOpen(
		tx: Prisma.TransactionClient,
		userId: string,
	): Promise<OnboardingSession | null> {
		const [locked] = await tx.$queryRaw<{ id: string }[]>`
			SELECT id FROM "onboardingSession"
			WHERE "userId" = ${userId} AND "completedAt" IS NULL
			FOR UPDATE
		`;
		if (!locked) return null;

		return readSession(
			await tx.onboardingSession.findUniqueOrThrow({
				where: { id: locked.id },
				select: SESSION_SELECT,
			}),
		);
	}

	private async openSession(userId: string): Promise<OnboardingSession | null> {
		const row = await runAsSystem(ONBOARDING.scope, () =>
			this.db.onboardingSession.findFirst({
				where: { userId, completedAt: null },
				select: SESSION_SELECT,
			}),
		);

		return row ? readSession(row) : null;
	}

	private async legacyWorkspace(
		administered: string[],
	): Promise<LegacyWorkspace | null> {
		if (administered.length === 0) return null;

		const rows = await runAsSystem(ONBOARDING.scope, () =>
			this.db.organization.findMany({
				where: { id: { in: administered } },
				orderBy: [{ createdAt: "asc" }, { id: "asc" }],
				select: { id: true, name: true, website: true, metadata: true },
			}),
		);

		return rows.find((row) => !isOnboarded(row.metadata)) ?? null;
	}

	private async startSession(
		userId: string,
		legacy: LegacyWorkspace | null,
	): Promise<OnboardingSession> {
		try {
			const row = await runAsSystem(ONBOARDING.scope, () =>
				this.db.onboardingSession.create({
					data: {
						userId,
						...(legacy && {
							organizationId: legacy.id,
							businessName:
								legacy.name === DEFAULT_WORKSPACE_NAME ? null : legacy.name,
							website: legacy.website,
						}),
					},
					select: SESSION_SELECT,
				}),
			);

			return readSession(row);
		} catch (error) {
			const open =
				error instanceof Prisma.PrismaClientKnownRequestError &&
				error.code === "P2002"
					? await this.openSession(userId)
					: null;
			if (open) return open;
			throw error;
		}
	}

	private async wizard(
		userId: string,
		session: OnboardingSession,
	): Promise<OnboardingState> {
		const [invitations, user] = await Promise.all([
			this.workspaces.myInvitations(userId),
			runAsSystem(ONBOARDING.scope, () =>
				this.db.user.findUnique({
					where: { id: userId },
					select: { emailVerified: true },
				}),
			),
		]);

		return {
			kind: "wizard",
			progress: progressOf(session),
			brandLookup: Boolean(user?.emailVerified) && this.brands.available(),
			invitations: invitations.map((invitation) => ({
				id: invitation.id,
				workspaceName: invitation.workspaceName,
				role: invitation.role,
			})),
		};
	}
}
