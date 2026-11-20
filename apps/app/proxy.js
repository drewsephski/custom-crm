import { proxy } from "./lib/workspace-proxy.js";

export default function workspaceProxy(request) {
	return proxy(request);
}

export const config = {
	matcher: [
		"/((?!api(?:/|$)|openapi\\.json$|internal/(?:crm/(?:dispatch|builder-dispatch|agent-dispatch|cancel-run|brand-preview|slack/create-channel)|sync/(?:mailboxes|google|rates)|archive/prune|tracking/retention|telemetry/rollup)/?$|eve/v1/cron/|\\.well-known/workflow/|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
