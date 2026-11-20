import { membershipOf } from "@crm/auth/organization";
import {
	privateImageKey,
	privateStorageConfig,
	signedImageUrl,
} from "@crm/db/object-storage";
import { runAsSystem } from "@crm/db/tenancy";
import { getSession } from "@/lib/session";

export async function GET(
	_request: Request,
	ctx: RouteContext<"/api/images/workspaces/[organizationId]/[...parts]">,
) {
	const { organizationId, parts } = await ctx.params;
	const session = await getSession();
	if (!session) return new Response(null, { status: 401 });
	const key = privateImageKey(organizationId, parts);
	const config = privateStorageConfig();
	if (
		!key ||
		!config ||
		!(await runAsSystem("authorize a workspace image read", () =>
			membershipOf(session.user.id, organizationId),
		))
	)
		return new Response(null, { status: 404 });
	return new Response(null, {
		status: 307,
		headers: {
			location: await signedImageUrl(config, key),
			"cache-control": "private, no-store",
			"referrer-policy": "no-referrer",
		},
	});
}
