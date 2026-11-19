import { AUTH_COOKIE_PREFIX } from "@crm/auth/cookies";
import { WORKSPACE_HEADER } from "@crm/auth/workspace-header";
import { getSessionCookie } from "better-auth/cookies";
import { type NextRequest, NextResponse } from "next/server";
import { isMarketing } from "@/lib/env";
import {
	ONBOARDING_PATH,
	RESEARCH_PATH,
	readWorkspaceGate,
} from "@/lib/onboarding";
import { workspaceUrl } from "@/lib/workspace-url";

const LANDING_PATH = "/";

const SIGN_IN_PATH = "/sign-in";

const UNGATED = ["/grant-access", "/eve", "/invitations"];

const ANONYMOUS = ["/t"];

const SECTIONS = ["/companies", "/contacts", "/deals", "/tasks", "/settings"];

export async function proxy(request: NextRequest) {
	const { pathname } = request.nextUrl;

	if (pathname === SIGN_IN_PATH) return NextResponse.next();

	if (isAnonymous(pathname)) return NextResponse.next();

	if (
		getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX }) === null
	) {
		return isPublic(pathname)
			? NextResponse.next()
			: NextResponse.redirect(new URL(SIGN_IN_PATH, request.nextUrl));
	}

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
		return pathname === ONBOARDING_PATH
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
	const target =
		pathname === RESEARCH_PATH || creatingAnother
			? pathname
			: appPath(pathname, workspace.slug);
	if (target !== pathname) return sendTo(target, request);

	return forwardWorkspace(request, workspace.slug);
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
	if (pathname === LANDING_PATH || isSetup(pathname)) {
		return workspaceUrl(slug);
	}

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

function isPublic(pathname: string): boolean {
	return pathname === LANDING_PATH && isMarketing();
}

function isUngated(pathname: string): boolean {
	return UNGATED.some((prefix) => isUnder(pathname, prefix));
}

function isAnonymous(pathname: string): boolean {
	return ANONYMOUS.some((prefix) => isUnder(pathname, prefix));
}

function isSetup(pathname: string): boolean {
	return pathname === ONBOARDING_PATH || pathname === RESEARCH_PATH;
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
