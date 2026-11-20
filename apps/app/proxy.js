import { proxy } from "./lib/workspace-proxy";

export default function workspaceProxy(request) {
	return proxy(request);
}

export const config = {
	matcher: [
		"/((?!api(?:/|$)|openapi\\.json$|internal/(?:sync/(?:mailboxes|google|rates)|archive/prune|tracking/retention|telemetry/rollup)/?$|eve/v1/cron/|\\.well-known/workflow/|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
