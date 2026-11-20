import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import {
	GET_STARTED_PATH,
	LANDING_PATH,
	NEXT_PARAM,
	SIGN_IN_PATH,
	safeNextPath,
	signInPathFor,
} from "@/lib/auth-redirect";
import { ONBOARDING_PATH, readWorkspaceGate } from "@/lib/onboarding";
import { workspaceUrl } from "@/lib/workspace-url";

const AUTH_PAGES = [SIGN_IN_PATH, GET_STARTED_PATH];

const PUBLIC = [LANDING_PATH, ...AUTH_PAGES];

const UNGATED = ["/grant-access", "/eve", "/invitations"];

const ANONYMOUS = ["/t"];

const SECTIONS = ["/companies", "/contacts", "/deals", "/tasks", "/settings"];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (isAnonymous(pathname)) return NextResponse.next();

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return PUBLIC.includes(pathname)
			? NextResponse.next()
			: sendToSignIn(request);
	}

	if (pathname === LANDING_PATH) return NextResponse.next();

	if (AUTH_PAGES.includes(pathname)) return leaveAuthPage(request);

	if (isUngated(pathname)) return NextResponse.next();

	const requested = requestedSlug(request);
	let workspace = await readWorkspaceGate(request, requested);

	if (workspace.kind === "not-a-member") {
		workspace = await readWorkspaceGate(request, null);
		if (workspace.kind === "workspace") {
			return sendTo(appPath(pathname, workspace.slug), request);
		}
	}

	if (workspace.kind === "no-workspace") {
		return isSetup(pathname)
			? NextResponse.next()
			: sendTo(ONBOARDING_PATH, request);
	}

	if (workspace.kind !== "workspace") return NextResponse.next();

	if (!workspace.onboarded && workspace.canRename) {
		return isSetup(pathname)
			? forwardWorkspace(request, workspace.slug)
			: sendTo(ONBOARDING_PATH, request, workspace.slug);
	}

	const creatingAnother =
		pathname === ONBOARDING_PATH &&
		request.nextUrl.searchParams.get("new") === "1";
	const target = creatingAnother ? pathname : appPath(pathname, workspace.slug);
	if (target !== pathname) return sendTo(target, request);

	return forwardWorkspace(request, workspace.slug);
}

function sendToSignIn(request: NextRequest): NextResponse {
	const { pathname, search } = request.nextUrl;

	return NextResponse.redirect(
		new URL(signInPathFor(`${pathname}${search}`), request.nextUrl),
	);
}

async function leaveAuthPage(request: NextRequest): Promise<NextResponse> {
	const workspace = await readWorkspaceGate(request, null);
	if (workspace.kind === "unknown") return NextResponse.next();

	const next = safeNextPath(request.nextUrl.searchParams.get(NEXT_PARAM));

	return NextResponse.redirect(new URL(next, request.nextUrl));
}

function requestedSlug(request: NextRequest): string | null {
	const { pathname, searchParams } = request.nextUrl;
	if (isSetup(pathname)) return searchParams.get("workspace");
	const first = pathname.slice(1).split("/")[0] ?? "";
	if (!first) return null;
	if (SECTIONS.some((section) => section === `/${first}`)) return null;
	return /^[a-z0-9-]{1,64}$/.test(first) ? first : null;
}

function forwardWorkspace(request: NextRequest, slug: string): NextResponse {
	const headers = new Headers(request.headers);
	headers.set(WORKSPACE_HEADER, slug);
	return NextResponse.next({ request: { headers } });
}

function appPath(pathname: string, slug: string): string {
	if (isSetup(pathname)) return workspaceUrl(slug);

	if (SECTIONS.some((section) => isUnder(pathname, section))) {
		return workspaceUrl(slug, pathname);
	}

	const [first, ...rest] = pathname.slice(1).split("/");

	if (first === slug) return pathname;

	return workspaceUrl(slug, rest.length ? `/${rest.join("/")}` : "/");
}

function isUnder(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function isUngated(pathname: string): boolean {
	return UNGATED.some((prefix) => isUnder(pathname, prefix));
}

function isAnonymous(pathname: string): boolean {
	return ANONYMOUS.some((prefix) => isUnder(pathname, prefix));
}

function isSetup(pathname: string): boolean {
	return isUnder(pathname, ONBOARDING_PATH);
}

function sendTo(
	path: string,
	request: NextRequest,
	slug?: string,
): NextResponse {
	if (request.nextUrl.pathname === path) {
		return slug ? forwardWorkspace(request, slug) : NextResponse.next();
	}

	const url = new URL(path, request.nextUrl);
	url.search = request.nextUrl.search;
	if (slug) url.searchParams.set("workspace", slug);

	return NextResponse.redirect(url);
}

export const config = {
	matcher: [
		"/((?!api|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
