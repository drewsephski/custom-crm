import { sendEmail } from "@crm/auth/email";
import { invitationEmail } from "@crm/auth/email-templates";
import { appUrl } from "@crm/auth/env";
import {
	canChangeRole,
	canChangeRoleOf,
	canGrantRole,
	canInviteMembers,
	canRemoveMember,
	canRenameWorkspace,
	isWorkspaceRole,
	membershipOf,
	toWorkspaceRole,
	WORKSPACE_ROLES,
	type WorkspaceRole,
} from "@crm/auth/organization";
import type { Db, Prisma } from "@crm/db";
import {
	requireOrganizationId,
	runAsSystem,
	runInTenant,
} from "@crm/db/tenancy";
import { isOnboarded, markOnboarded } from "@crm/db/workspace";
import { RESERVED_SLUGS, workspaceSlug } from "@crm/db/workspace-slug";
import {
	BadRequestException,
	ConflictException,
	ForbiddenException,
	Injectable,
	Logger,
	NotFoundException,
} from "@nestjs/common";
import { AgentTriggerService } from "../agent/agent-trigger.service";
import { normalizeDomain } from "../companies/domain";
import { InjectDatabase } from "../database/database.constants";
import { listMemberships } from "../tenancy/workspace-resolver";
import {
	countsByKey,
	type ListResult,
	type OrderByColumns,
	paginate,
	resolveOrderBy,
} from "../trpc/list-input";
import type {
	CreateWorkspaceInput,
	InvitationView,
	InviteMemberInput,
	InviteMemberResult,
	MemberListInput,
	MyInvitation,
	RemoveMemberInput,
	SetMemberRoleInput,
	UpdateWorkspaceInput,
	Workspace,
	WorkspaceMember,
	WorkspaceSummary,
} from "./workspace.contracts";
import { WORKSPACE } from "./workspace-config";

const MEMBER_SELECT = {
	id: true,
	role: true,
	createdAt: true,
	userId: true,
	user: { select: { name: true, email: true, image: true } },
} as const;

type MemberRow = Prisma.MemberGetPayload<{ select: typeof MEMBER_SELECT }>;

const INVITATION_SELECT = {
	id: true,
	email: true,
	role: true,
	status: true,
	expiresAt: true,
	user: { select: { name: true, email: true } },
} as const;

type InvitationRow = Prisma.InvitationGetPayload<{
	select: typeof INVITATION_SELECT;
}>;

const SORTABLE: OrderByColumns<Prisma.MemberOrderByWithRelationInput> = {
	name: (dir) => ({ user: { name: dir } }),
	email: (dir) => ({ user: { email: dir } }),
	role: (dir) => ({ role: dir }),
	joinedAt: (dir) => ({ createdAt: dir }),
};

const INVITATION_STATUSES = [
	"pending",
	"accepted",
	"canceled",
	"expired",
] as const;

type InvitationStatus = (typeof INVITATION_STATUSES)[number];

function invitationStatus(row: {
	status: string;
	expiresAt: Date;
}): InvitationStatus {
	if (row.status === "pending" && row.expiresAt.getTime() <= Date.now()) {
		return "expired";
	}
	return (INVITATION_STATUSES as readonly string[]).includes(row.status)
		? (row.status as InvitationStatus)
		: "canceled";
}

export type NewWorkspace = {
	userId: string;
	sessionId: string | null;
	name: string;
	website: string | null;
	onboarded: boolean;
};

function newId(): string {
	return crypto.randomUUID();
}

@Injectable()
export class WorkspaceService {
	private readonly logger = new Logger(WorkspaceService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly agent: AgentTriggerService,
	) {}

	async get(userId: string): Promise<Workspace> {
		const organizationId = requireOrganizationId();
		const [row, role] = await runAsSystem("read the active workspace", () =>
			Promise.all([
				this.db.organization.findUnique({
					where: { id: organizationId },
					select: {
						id: true,
						slug: true,
						name: true,
						website: true,
						metadata: true,
					},
				}),
				membershipOf(userId, organizationId, this.db),
			]),
		);

		if (!row || !role) {
			throw new NotFoundException("That workspace does not exist.");
		}

		return {
			id: row.id,
			slug: row.slug,
			name: row.name,
			website: row.website,
			onboarded: isOnboarded(row.metadata),
			viewerRole: role.role,
			canRename: canRenameWorkspace(role.role),
			canChangeRoles: canChangeRole(role.role),
			canInvite: canInviteMembers(role.role),
		};
	}

	async list(
		userId: string,
		activeOrganizationId: string | null,
	): Promise<{ workspaces: WorkspaceSummary[]; activeSlug: string | null }> {
		const memberships = await listMemberships(this.db, userId);
		const active =
			memberships.find((m) => m.organizationId === activeOrganizationId) ??
			memberships[0];

		return {
			workspaces: memberships.map((m) => ({
				id: m.organizationId,
				slug: m.slug,
				name: m.name,
				role: m.role,
			})),
			activeSlug: active?.slug ?? null,
		};
	}

	async create(
		userId: string,
		sessionId: string | null,
		input: CreateWorkspaceInput,
	): Promise<WorkspaceSummary> {
		const website = input.website ? normalizeDomain(input.website) : null;
		if (input.website && !website) {
			throw new BadRequestException(
				"That is not a website. Enter the domain, like acme.com.",
			);
		}

		const created = await runAsSystem("create a workspace", () =>
			this.db.$transaction((tx) =>
				this.createWithin(tx, {
					userId,
					sessionId,
					name: input.name,
					website,
					onboarded: true,
				}),
			),
		);

		this.logger.log({
			message: "Workspace created",
			userId,
			organizationId: created.id,
		});

		if (website) {
			await runInTenant(created.id, () =>
				this.agent.workspaceChanged(
					website,
					"The agency using this CRM said what its website is",
				),
			);
		}

		return created;
	}

	async createWithin(
		tx: Prisma.TransactionClient,
		input: NewWorkspace,
	): Promise<WorkspaceSummary> {
		const organizationId = newId();
		const slug = await this.uniqueSlug(tx, input.name);

		const organization = await tx.organization.create({
			data: {
				id: organizationId,
				name: input.name,
				slug,
				website: input.website,
				metadata: input.onboarded ? markOnboarded(null, new Date()) : null,
				createdAt: new Date(),
			},
			select: { id: true, slug: true, name: true },
		});

		await tx.member.create({
			data: {
				id: newId(),
				organizationId,
				userId: input.userId,
				role: "owner",
				createdAt: new Date(),
			},
		});

		await tx.appSetting.create({ data: { organizationId } });

		if (input.sessionId) {
			await tx.session.updateMany({
				where: { id: input.sessionId, userId: input.userId },
				data: { activeOrganizationId: organizationId },
			});
		}

		return {
			id: organization.id,
			slug: organization.slug,
			name: organization.name,
			role: "owner",
		};
	}

	async renameWithin(
		tx: Prisma.TransactionClient,
		organizationId: string,
		input: { name: string; website: string | null },
	): Promise<{ id: string; slug: string; name: string }> {
		const current = await tx.organization.findUnique({
			where: { id: organizationId },
			select: { name: true, slug: true },
		});

		if (!current) {
			throw new NotFoundException("That workspace does not exist.");
		}

		const slug =
			current.name === input.name
				? current.slug
				: await this.uniqueSlug(tx, input.name, organizationId);

		return tx.organization.update({
			where: { id: organizationId },
			data: { name: input.name, slug, website: input.website },
			select: { id: true, slug: true, name: true },
		});
	}

	async activate(
		userId: string,
		sessionId: string | null,
		slug: string,
	): Promise<WorkspaceSummary> {
		const memberships = await listMemberships(this.db, userId);
		const target = memberships.find((m) => m.slug === slug);

		if (!target) {
			throw new ForbiddenException("You are not a member of that workspace.");
		}

		if (sessionId) {
			await runAsSystem("remember the active workspace", () =>
				this.db.session.updateMany({
					where: { id: sessionId, userId },
					data: { activeOrganizationId: target.organizationId },
				}),
			);
		}

		return {
			id: target.organizationId,
			slug: target.slug,
			name: target.name,
			role: target.role,
		};
	}

	async update(
		userId: string,
		input: UpdateWorkspaceInput,
	): Promise<Workspace> {
		const organizationId = requireOrganizationId();
		const role = await this.roleOf(userId);

		if (!canRenameWorkspace(role)) {
			throw new ForbiddenException(
				"Only an owner or an admin can change the workspace.",
			);
		}

		const website = normalizeDomain(input.website);

		if (!website) {
			throw new BadRequestException(
				"That is not a website. Enter the domain, like acme.com.",
			);
		}

		const before = await runAsSystem("rename the workspace", () =>
			this.db.$transaction(async (tx) => {
				const current = await tx.organization.findUnique({
					where: { id: organizationId },
					select: { website: true, metadata: true, slug: true },
				});

				if (!current) {
					throw new NotFoundException("That workspace does not exist.");
				}

				const requested = workspaceSlug(input.slug ?? input.name);
				const slug =
					requested === current.slug
						? requested
						: await this.uniqueSlug(tx, requested, organizationId);

				await tx.organization.update({
					where: { id: organizationId },
					data: {
						name: input.name,
						slug,
						website,
						metadata: markOnboarded(current.metadata, new Date()),
					},
				});

				return current;
			}),
		);

		this.logger.log({ message: "Workspace updated", userId });

		if (website !== before.website) {
			await this.agent.workspaceChanged(
				website,
				before.website
					? "The company using this CRM changed its website"
					: "The company using this CRM said what its website is",
			);
		}

		return this.get(userId);
	}

	async members(
		userId: string,
		input: MemberListInput,
	): Promise<ListResult<WorkspaceMember>> {
		const where = this.buildWhere(input);
		const facetWhere = this.searchWhere(input.q);
		const { skip, take } = paginate(input);

		const [rows, total, roles] = await runAsSystem(
			"list workspace members",
			() =>
				Promise.all([
					this.db.member.findMany({
						where,
						skip,
						take,
						select: MEMBER_SELECT,
						orderBy: resolveOrderBy(input, SORTABLE, { createdAt: "asc" }),
					}),
					this.db.member.count({ where }),
					this.db.member.groupBy({
						by: ["role"],
						where: facetWhere,
						_count: { _all: true },
					}),
				]),
		);

		return {
			rows: rows.map((row) => this.toMember(row, userId)),
			total,
			facetCounts: { role: countsByKey(roles, "role") },
		};
	}

	async setMemberRole(
		userId: string,
		input: SetMemberRoleInput,
	): Promise<WorkspaceMember> {
		const organizationId = requireOrganizationId();
		const actor = await this.roleOf(userId);

		if (!canChangeRole(actor)) {
			throw new ForbiddenException(
				"Only an owner or an admin can change a member's role.",
			);
		}

		const updated = await runAsSystem("change a member's role", () =>
			this.db.$transaction(async (tx) => {
				const target = await tx.member.findFirst({
					where: { id: input.memberId, organizationId },
					select: { id: true, role: true },
				});

				if (!target) {
					throw new NotFoundException("That person is not in this workspace.");
				}

				const current = toWorkspaceRole(target.role);
				if (!canChangeRoleOf(actor, current, input.role)) {
					throw new ForbiddenException(
						"Only an owner can make someone an owner or change an owner's role.",
					);
				}

				if (current === "owner" && input.role !== "owner") {
					await this.assertAnotherOwner(tx, organizationId);
				}

				return tx.member.update({
					where: { id: target.id },
					data: { role: input.role },
					select: MEMBER_SELECT,
				});
			}),
		);

		this.logger.log({
			message: "Workspace role changed",
			userId,
			memberId: updated.id,
			role: input.role,
		});

		return this.toMember(updated, userId);
	}

	async removeMember(
		userId: string,
		input: RemoveMemberInput,
	): Promise<{ ok: true }> {
		const organizationId = requireOrganizationId();
		const actor = await this.roleOf(userId);

		await runAsSystem("remove a workspace member", () =>
			this.db.$transaction(async (tx) => {
				const target = await tx.member.findFirst({
					where: { id: input.memberId, organizationId },
					select: { id: true, role: true, userId: true },
				});

				if (!target) {
					throw new NotFoundException("That person is not in this workspace.");
				}

				const leaving = target.userId === userId;
				const role = toWorkspaceRole(target.role);

				if (!leaving && !canRemoveMember(actor, role)) {
					throw new ForbiddenException(
						"Only an owner can remove an owner, and only an owner or an admin can remove anyone.",
					);
				}

				if (role === "owner") {
					await this.assertAnotherOwner(tx, organizationId);
				}

				await this.releaseAssignments(tx, organizationId, {
					leaverId: target.userId,
					heirId: leaving
						? await this.heirOf(tx, organizationId, target.userId)
						: userId,
				});

				await tx.member.delete({ where: { id: target.id } });
				await tx.session.updateMany({
					where: {
						userId: target.userId,
						activeOrganizationId: organizationId,
					},
					data: { activeOrganizationId: null },
				});
			}),
		);

		this.logger.log({
			message: "Workspace member removed",
			userId,
			memberId: input.memberId,
		});

		return { ok: true };
	}

	async invite(
		userId: string,
		input: InviteMemberInput,
	): Promise<InviteMemberResult> {
		const organizationId = requireOrganizationId();
		const actor = await this.roleOf(userId);

		if (!canInviteMembers(actor)) {
			throw new ForbiddenException(
				"Only an owner or an admin can invite people.",
			);
		}

		if (!canGrantRole(actor, input.role)) {
			throw new ForbiddenException(
				"You can only invite people with a role no higher than your own.",
			);
		}

		const { row, workspaceName } = await runAsSystem(
			"invite a workspace member",
			() =>
				this.db.$transaction(async (tx) => {
					const existing = await tx.member.findFirst({
						where: {
							organizationId,
							user: { email: { equals: input.email, mode: "insensitive" } },
						},
						select: { id: true },
					});

					if (existing) {
						throw new ConflictException("That person is already a member.");
					}

					await tx.invitation.updateMany({
						where: {
							organizationId,
							email: { equals: input.email, mode: "insensitive" },
							status: "pending",
						},
						data: { status: "canceled" },
					});

					const created = await tx.invitation.create({
						data: {
							id: newId(),
							organizationId,
							email: input.email,
							role: input.role,
							status: "pending",
							inviterId: userId,
							expiresAt: new Date(Date.now() + WORKSPACE.invitation.ttlMs),
						},
						select: INVITATION_SELECT,
					});
					const organization = await tx.organization.findUniqueOrThrow({
						where: { id: organizationId },
						select: { name: true },
					});

					return { row: created, workspaceName: organization.name };
				}),
		);

		this.logger.log({
			message: "Workspace invitation created",
			userId,
			invitationId: row.id,
			role: input.role,
		});

		const invitation = this.toInvitation(row);

		return {
			...invitation,
			emailStatus: await this.sendInvitationEmail(invitation, workspaceName),
		};
	}

	private async sendInvitationEmail(
		invitation: InvitationView,
		workspaceName: string,
	): Promise<InviteMemberResult["emailStatus"]> {
		const result = await sendEmail({
			to: invitation.email,
			...invitationEmail({
				workspaceName,
				inviterName: invitation.invitedBy,
				role: invitation.role,
				email: invitation.email,
				url: new URL(WORKSPACE.invitation.acceptPath, appUrl).toString(),
				expiresInDays: WORKSPACE.invitation.ttlDays,
			}),
		});

		if (!result.ok && result.reason !== "off") {
			this.logger.warn({
				message: "Workspace invitation email not sent",
				invitationId: invitation.id,
				reason: result.reason,
				detail: result.detail,
			});
			return "failed";
		}

		return result.ok && result.delivery === "resend" ? "sent" : "not-sent";
	}

	async invitations(userId: string): Promise<InvitationView[]> {
		const organizationId = requireOrganizationId();
		const actor = await this.roleOf(userId);

		if (!canInviteMembers(actor)) {
			throw new ForbiddenException(
				"Only an owner or an admin can see invitations.",
			);
		}

		const rows = await runAsSystem("list workspace invitations", () =>
			this.db.invitation.findMany({
				where: { organizationId, status: "pending" },
				orderBy: { createdAt: "desc" },
				select: INVITATION_SELECT,
			}),
		);

		return rows.map((row) => this.toInvitation(row));
	}

	async revokeInvitation(
		userId: string,
		invitationId: string,
	): Promise<{ ok: true }> {
		const organizationId = requireOrganizationId();
		const actor = await this.roleOf(userId);

		if (!canInviteMembers(actor)) {
			throw new ForbiddenException(
				"Only an owner or an admin can cancel an invitation.",
			);
		}

		const { count } = await runAsSystem("cancel a workspace invitation", () =>
			this.db.invitation.updateMany({
				where: { id: invitationId, organizationId, status: "pending" },
				data: { status: "canceled" },
			}),
		);

		if (count === 0) {
			throw new NotFoundException("That invitation is not pending.");
		}

		return { ok: true };
	}

	async myInvitations(userId: string): Promise<MyInvitation[]> {
		const user = await this.verifiedUser(userId);
		if (!user) return [];

		const rows = await runAsSystem("list the caller's invitations", () =>
			this.db.invitation.findMany({
				where: {
					email: { equals: user.email, mode: "insensitive" },
					status: "pending",
					expiresAt: { gt: new Date() },
				},
				orderBy: { createdAt: "desc" },
				select: {
					id: true,
					role: true,
					expiresAt: true,
					organization: { select: { name: true } },
					user: { select: { name: true, email: true } },
				},
			}),
		);

		return rows.map((row) => ({
			id: row.id,
			workspaceName: row.organization.name,
			role: toWorkspaceRole(row.role ?? "member"),
			invitedBy: row.user.name || row.user.email,
			expiresAt: row.expiresAt.toISOString(),
		}));
	}

	async acceptInvitation(
		userId: string,
		sessionId: string | null,
		invitationId: string,
	): Promise<WorkspaceSummary> {
		const user = await this.verifiedUser(userId);

		if (!user) {
			throw new ForbiddenException(
				"Verify your email address before you accept an invitation.",
			);
		}

		const joined = await runAsSystem("accept a workspace invitation", () =>
			this.db.$transaction(async (tx) => {
				const invitation = await tx.invitation.findUnique({
					where: { id: invitationId },
					select: {
						id: true,
						organizationId: true,
						email: true,
						role: true,
						status: true,
						expiresAt: true,
						inviterId: true,
						organization: { select: { slug: true, name: true } },
					},
				});

				if (
					!invitation ||
					invitation.email.toLowerCase() !== user.email.toLowerCase()
				) {
					throw new NotFoundException("That invitation is not for you.");
				}

				if (invitationStatus(invitation) !== "pending") {
					throw new BadRequestException(
						"That invitation is no longer valid. Ask for a new one.",
					);
				}

				const requested = isWorkspaceRole(invitation.role ?? "")
					? toWorkspaceRole(invitation.role ?? "member")
					: "member";
				const inviter = await membershipOf(
					invitation.inviterId,
					invitation.organizationId,
					tx,
				);
				if (!canGrantRole(inviter?.role ?? null, requested)) {
					throw new ForbiddenException(
						"The person who invited you can no longer grant that role. Ask an owner for a new invitation.",
					);
				}

				const existing = await membershipOf(
					userId,
					invitation.organizationId,
					tx,
				);

				if (!existing) {
					await tx.member.create({
						data: {
							id: newId(),
							organizationId: invitation.organizationId,
							userId,
							role: requested,
							createdAt: new Date(),
						},
					});
				}

				await tx.invitation.update({
					where: { id: invitation.id },
					data: { status: "accepted" },
				});

				if (sessionId) {
					await tx.session.updateMany({
						where: { id: sessionId, userId },
						data: { activeOrganizationId: invitation.organizationId },
					});
				}

				return {
					id: invitation.organizationId,
					slug: invitation.organization.slug,
					name: invitation.organization.name,
					role: existing?.role ?? requested,
				};
			}),
		);

		this.logger.log({
			message: "Workspace invitation accepted",
			userId,
			organizationId: joined.id,
		});

		return joined;
	}

	private async roleOf(userId: string): Promise<WorkspaceRole | null> {
		const organizationId = requireOrganizationId();
		const membership = await runAsSystem("read the caller's role", () =>
			membershipOf(userId, organizationId, this.db),
		);
		return membership?.role ?? null;
	}

	private async verifiedUser(
		userId: string,
	): Promise<{ email: string } | null> {
		const user = await runAsSystem("read the caller's address", () =>
			this.db.user.findUnique({
				where: { id: userId },
				select: { email: true, emailVerified: true },
			}),
		);
		return user?.emailVerified ? { email: user.email } : null;
	}

	private async heirOf(
		tx: Prisma.TransactionClient,
		organizationId: string,
		leaverId: string,
	): Promise<string> {
		const members = await tx.member.findMany({
			where: { organizationId, userId: { not: leaverId } },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			select: { userId: true, role: true },
		});
		const [heir] = members.toSorted(
			(left, right) =>
				WORKSPACE_ROLES.indexOf(toWorkspaceRole(left.role)) -
				WORKSPACE_ROLES.indexOf(toWorkspaceRole(right.role)),
		);
		if (!heir) {
			throw new ForbiddenException(
				"The workspace needs another member to take over these deals first.",
			);
		}
		return heir.userId;
	}

	private async releaseAssignments(
		tx: Prisma.TransactionClient,
		organizationId: string,
		people: { leaverId: string; heirId: string },
	): Promise<void> {
		const owned = { organizationId, ownerId: people.leaverId };
		await tx.deal.updateMany({
			where: owned,
			data: { ownerId: people.heirId },
		});
		await tx.contact.updateMany({ where: owned, data: { ownerId: null } });
		await tx.company.updateMany({ where: owned, data: { ownerId: null } });
		await tx.mailboxSync.deleteMany({
			where: { organizationId, userId: people.leaverId },
		});
		await tx.slackMemberMatch.deleteMany({
			where: { organizationId, crmUserId: people.leaverId },
		});
	}

	private async assertAnotherOwner(
		tx: Prisma.TransactionClient,
		organizationId: string,
	): Promise<void> {
		const owners = await tx.$queryRaw<{ id: string }[]>`
			SELECT id FROM "member"
			WHERE "organizationId" = ${organizationId} AND role = 'owner'
			FOR UPDATE
		`;

		if (owners.length <= 1) {
			throw new ForbiddenException(
				"The workspace needs an owner. Make someone else an owner first.",
			);
		}
	}

	private async uniqueSlug(
		tx: Prisma.TransactionClient,
		name: string,
		organizationId?: string,
	): Promise<string> {
		const base = workspaceSlug(name);

		for (let attempt = 0; attempt < WORKSPACE.slug.maxAttempts; attempt++) {
			const candidate =
				attempt === 0
					? base
					: `${base}-${crypto
							.randomUUID()
							.replace(/-/g, "")
							.slice(0, WORKSPACE.slug.suffixLength)}`;

			if (RESERVED_SLUGS.includes(candidate)) continue;

			const taken = await tx.organization.findFirst({
				where: {
					slug: candidate,
					...(organizationId && { id: { not: organizationId } }),
				},
				select: { id: true },
			});

			if (!taken) return candidate;
		}

		throw new ConflictException(
			"Could not find a free address for that workspace. Try another name.",
		);
	}

	private toMember(row: MemberRow, userId: string): WorkspaceMember {
		return {
			id: row.id,
			userId: row.userId,
			name: row.user.name,
			email: row.user.email,
			image: row.user.image,
			role: toWorkspaceRole(row.role),
			joinedAt: row.createdAt.toISOString(),
			isViewer: row.userId === userId,
		};
	}

	private toInvitation(row: InvitationRow): InvitationView {
		return {
			id: row.id,
			email: row.email,
			role: toWorkspaceRole(row.role ?? "member"),
			status: invitationStatus(row),
			expiresAt: row.expiresAt.toISOString(),
			invitedBy: row.user.name || row.user.email,
		};
	}

	private searchWhere(q: string): Prisma.MemberWhereInput {
		const term = q.trim();
		const where: Prisma.MemberWhereInput = {
			organizationId: requireOrganizationId(),
		};

		if (term) {
			where.user = {
				OR: [
					{ name: { contains: term, mode: "insensitive" } },
					{ email: { contains: term, mode: "insensitive" } },
				],
			};
		}

		return where;
	}

	private buildWhere(input: MemberListInput): Prisma.MemberWhereInput {
		const where = this.searchWhere(input.q);

		if (input.role.length > 0) {
			where.role = { in: input.role };
		}

		return where;
	}
}
