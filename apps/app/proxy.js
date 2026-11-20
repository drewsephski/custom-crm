import { proxy } from "./lib/workspace-proxy";

export default function workspaceProxy(request) {
	return proxy(request);
}

export const config = {
	matcher: [
		"/((?!api(?:/|$)|auth(?:/|$)|rest(?:/|$)|health$|openapi\\.json$|internal/|eve/v1/cron/|\\.well-known/workflow/|_next/static|_next/image|.*\\.(?:ico|png|svg|jpg|jpeg|gif|webp|webmanifest)$).*)",
	],
};
