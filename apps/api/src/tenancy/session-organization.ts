import type { Session } from "@crm/auth/auth";
import { z } from "zod";

const sessionOrganization = z
	.object({ activeOrganizationId: z.string().min(1).nullish() })
	.catch({ activeOrganizationId: null });

export function sessionOrganizationId(session: Session | null): string | null {
	if (!session) return null;
	return (
		sessionOrganization.parse(session.session).activeOrganizationId ?? null
	);
}
