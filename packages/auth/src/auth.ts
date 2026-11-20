import { apiKey } from "@better-auth/api-key";
import { sso } from "@better-auth/sso";
import { db } from "@crm/db";
import { runInTenant } from "@crm/db/tenancy";
import { schemas } from "@crm/validation";
import type { GenericEndpointContext } from "better-auth";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import {
	APIError,
	createAuthMiddleware,
	getSessionFromCtx,
} from "better-auth/api";
import { genericOAuth } from "better-auth/plugins/generic-oauth";
import { magicLink } from "better-auth/plugins/magic-link";
import { organization } from "better-auth/plugins/organization";
import { API_KEY_EXPIRATION, API_KEY_HEADER, API_KEY_PREFIX } from "./api-keys";
import { AUTH_ERROR, MAGIC_LINK } from "./auth-config";
import { AUTH_COOKIE_PREFIX } from "./cookies";
import { emailEnabled } from "./email";
import { env } from "./env";
import { deliverMagicLink } from "./magic-link";
import {
	activeOrganizationForNewSession,
	activeOrganizationOfSession,
	membershipOf,
	ORGANIZATION_PLUGIN_PATHS,
} from "./organization";
import {
	CREDENTIAL_PROVIDER_ID,
	GOOGLE_PROVIDER_ID,
	IDENTITY_SCOPES,
	MICROSOFT_PROVIDER_ID,
	SLACK_PROVIDER_ID,
} from "./scopes";
import { notifySignedIn } from "./signed-in";
import { slackConnectGuard } from "./slack-connect";
import {
	rememberSlackInstall,
	replaceSlackConnection,
	type SlackAccountGrant,
	SlackInstallExpiredError,
} from "./slack-grant";
import { slackOAuthCallback } from "./slack-oauth-callback";
import { SLACK_REQUESTED_SCOPES, SLACK_USER_SCOPES } from "./slack-scopes";
import { queueSlackInventorySync } from "./slack-sync";
import {
	googleHostedDomainHint,
	hasSignInAllowList,
	isWorkspaceEmail,
	primaryWorkspaceDomain,
} from "./workspace";

const socialProviders: NonNullable<BetterAuthOptions["socialProviders"]> = {};
const slackOAuth = env.slack;
const slackRedirectUri = new URL(
	"/api/auth/oauth2/callback/slack",
	env.apiUrl,
).toString();

if (env.google) {
	const google: NonNullable<typeof socialProviders.google> = {
		...env.google,

		scope: [...IDENTITY_SCOPES],

		accessType: "offline",
	};

	const hostedDomain = googleHostedDomainHint();
	if (hostedDomain) google.hd = hostedDomain;

	socialProviders.google = google;
}

if (env.microsoft) {
	socialProviders.microsoft = {
		clientId: env.microsoft.clientId,
		clientSecret: env.microsoft.clientSecret,
		tenantId: env.microsoft.tenantId,

		scope: [...IDENTITY_SCOPES],

		prompt: "select_account",

		disableProfilePhoto: true,

		mapProfileToUser: (profile) => ({
			email: profile.email ?? profile.preferred_username ?? profile.upn,
		}),
	};
}

export const auth = betterAuth({
	appName: "CRM",
	baseURL: env.apiUrl,

	database: prismaAdapter(db, {
		provider: "postgresql",
	}),

	emailAndPassword: {
		enabled: env.emailPassword,
		minPasswordLength: 12,
	},

	disabledPaths: [...ORGANIZATION_PLUGIN_PATHS],

	socialProviders,

	account: {
		accountLinking: {
			enabled: true,
			trustedProviders: [GOOGLE_PROVIDER_ID, MICROSOFT_PROVIDER_ID],
		},
	},

	session: {
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},

	rateLimit: {
		enabled: true,
		storage: "database",
		customRules: {
			[MAGIC_LINK.paths.send]: {
				window: MAGIC_LINK.send.windowSeconds,
				max: MAGIC_LINK.send.max,
			},
		},
	},

	advanced: {
		cookiePrefix: AUTH_COOKIE_PREFIX,

		useSecureCookies: env.isProduction,
		...(env.cookieDomain && {
			crossSubDomainCookies: {
				enabled: true,
				domain: env.cookieDomain,
			},
		}),
	},

	trustedOrigins: [...env.trustedOrigins],
	hooks: {
		before: slackConnectGuard,
	},

	plugins: [
		{
			id: "magic-link-redirect-guard",
			hooks: {
				before: [
					{
						matcher: (ctx) => ctx.path === MAGIC_LINK.paths.verify,
						handler: createAuthMiddleware(async (ctx) => {
							for (const key of [
								"callbackURL",
								"newUserCallbackURL",
								"errorCallbackURL",
							]) {
								const target = ctx.query?.[key];
								if (target === undefined) continue;
								if (
									typeof target !== "string" ||
									!URL.canParse(target, env.appUrl) ||
									!env.trustedOrigins.includes(
										new URL(target, env.appUrl).origin,
									)
								)
									throw new APIError("FORBIDDEN", {
										message: "Invalid sign-in destination.",
									});
							}
						}),
					},
				],
			},
		},
		...(slackOAuth
			? [
					genericOAuth({
						config: [
							{
								providerId: SLACK_PROVIDER_ID,
								authorizationUrl: "https://slack.com/oauth/v2/authorize",
								tokenUrl: "https://slack.com/api/oauth.v2.access",
								clientId: slackOAuth.clientId,
								clientSecret: slackOAuth.clientSecret,
								disableSignUp: true,
								redirectURI: slackRedirectUri,
								scopes: [...SLACK_REQUESTED_SCOPES],
								authorizationUrlParams: {
									user_scope: SLACK_USER_SCOPES.join(","),
								},
								getToken: async ({ code }) => {
									const response = await fetch(
										"https://slack.com/api/oauth.v2.access",
										{
											method: "POST",
											headers: {
												"content-type": "application/x-www-form-urlencoded",
											},
											body: new URLSearchParams({
												client_id: slackOAuth.clientId,
												client_secret: slackOAuth.clientSecret,
												code,
												redirect_uri: slackRedirectUri,
											}),
										},
									);
									const grant = schemas.slack.oauthAccess.parse(
										await response.json(),
									);
									if (!response.ok || !grant.ok || !grant.access_token) {
										throw new APIError("BAD_REQUEST", {
											message: `Slack authorization failed (${grant.error ?? "rejected"}).`,
										});
									}
									await rememberSlackInstall(grant);

									return {
										accessToken: grant.access_token,
										tokenType: grant.token_type,
										scopes: (grant.scope ?? "")
											.split(",")
											.map((scope) => scope.trim())
											.filter(Boolean),
										raw: grant,
									};
								},
								getUserInfo: async (tokens) => {
									try {
										const granted = schemas.slack.oauthAccess.parse(tokens.raw);
										const userId = granted.authed_user?.id;
										if (!tokens.accessToken || !userId) return null;
										const userResponse = await fetch(
											`https://slack.com/api/users.info?user=${encodeURIComponent(userId)}`,
											{
												headers: {
													Authorization: `Bearer ${tokens.accessToken}`,
												},
											},
										);
										const profile = schemas.slack.userInfo.parse(
											await userResponse.json(),
										);
										if (!userResponse.ok || !profile.ok) return null;
										const details = profile.user.profile;
										const email = details.email;
										if (!email) return null;
										return {
											id: userId,
											name: details.real_name ?? profile.user.name ?? email,
											email,
											emailVerified: true,
											image: details.image_512,
										};
									} catch {
										return null;
									}
								},
							},
						],
					}),
					slackOAuthCallback,
				]
			: []),
		...(emailEnabled()
			? [
					magicLink({
						expiresIn: MAGIC_LINK.expiresInSeconds,
						storeToken: "hashed",
						disableSignUp: false,
						rateLimit: {
							window: MAGIC_LINK.verify.windowSeconds,
							max: MAGIC_LINK.verify.max,
						},
						sendMagicLink: deliverMagicLink,
					}),
				]
			: []),
		organization({
			allowUserToCreateOrganization: false,
			cancelPendingInvitationsOnReInvite: true,
			disableOrganizationDeletion: true,
			creatorRole: "owner",

			schema: {
				organization: {
					additionalFields: {
						website: {
							type: "string",
							required: false,
						},
					},
				},
			},
		}),

		sso({
			organizationProvisioning: { disabled: true },
		}),

		apiKey({
			apiKeyHeaders: API_KEY_HEADER,
			defaultPrefix: API_KEY_PREFIX,
			enableSessionForAPIKeys: true,
			requireName: true,
			defaultKeyLength: 32,
			maximumNameLength: 64,
			rateLimit: { enabled: false },
			keyExpiration: {
				maxExpiresIn: API_KEY_EXPIRATION.maxDays,
				minExpiresIn: API_KEY_EXPIRATION.minDays,
			},
		}),
	],

	databaseHooks: {
		account: {
			create: {
				before: async (account) => {
					await refuseUnverifiedPasswordLink(account);
					return { data: account };
				},
				after: replaceSlackAccount,
			},
			update: {
				after: replaceSlackAccount,
			},
		},

		user: {
			create: {
				before: async (user) => {
					if (hasSignInAllowList() && !isWorkspaceEmail(user.email)) {
						const domain = primaryWorkspaceDomain();
						throw new APIError("FORBIDDEN", {
							code: AUTH_ERROR.signInNotAllowed,
							message: domain
								? `This CRM is private. Sign in with your @${domain} account.`
								: "This CRM is private. That address is not on the allow-list.",
						});
					}

					return { data: user };
				},
			},
		},

		session: {
			create: {
				before: async (session) => {
					const activeOrganizationId = await activeOrganizationForNewSession(
						session.userId,
					);

					return { data: { ...session, activeOrganizationId } };
				},

				after: async (session) => {
					const user = await db.user.findUnique({
						where: { id: session.userId },
						select: { id: true, email: true },
					});

					if (user) await notifySignedIn(user);
				},
			},
		},
	},
});

export type Auth = typeof auth;
export type Session = typeof auth.$Infer.Session;
export type SessionUser = Session["user"];

async function replaceSlackAccount(
	account: SlackAccountGrant & { providerId: string },
	context: GenericEndpointContext | null,
): Promise<void> {
	if (account.providerId !== SLACK_PROVIDER_ID) return;

	const session = context
		? await getSessionFromCtx(context, { disableCookieCache: true })
		: null;
	const organizationId = session
		? await activeOrganizationOfSession(session.session.id)
		: null;
	if (!organizationId || session?.user.id !== account.userId) {
		throw new APIError("FORBIDDEN", {
			message: "Open the workspace you want Slack in, then connect it again.",
		});
	}

	const membership = await membershipOf(account.userId, organizationId);
	if (!membership) {
		throw new APIError("FORBIDDEN", {
			message: "Only a member of this workspace can connect Slack.",
		});
	}

	try {
		await runInTenant(organizationId, async () => {
			await replaceSlackConnection(account);
			await queueSlackInventorySync();
		});
	} catch (error) {
		if (error instanceof SlackInstallExpiredError) {
			throw new APIError("BAD_REQUEST", { message: error.message });
		}
		throw error;
	}
}

async function refuseUnverifiedPasswordLink(account: {
	providerId: string;
	userId: string;
}): Promise<void> {
	if (!env.emailPassword || account.providerId === CREDENTIAL_PROVIDER_ID) {
		return;
	}

	const user = await db.user.findUnique({
		where: { id: account.userId },
		select: {
			emailVerified: true,
			accounts: {
				where: { providerId: CREDENTIAL_PROVIDER_ID },
				select: { id: true },
			},
		},
	});

	if (user && !user.emailVerified && user.accounts.length > 0) {
		throw new APIError("FORBIDDEN", {
			message:
				"This address already has a password account that was never verified. Sign in with the password instead.",
		});
	}
}
