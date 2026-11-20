"use client";

import { Toaster } from "@crm/ui/components/sonner";
import { usePathname } from "next/navigation";

const CLASSIC_TOAST_ROUTES = new Set([
	"/sign-in",
	"/get-started",
	"/grant-access",
	"/onboarding",
]);

export function AppToaster() {
	const pathname = usePathname();
	const variant = CLASSIC_TOAST_ROUTES.has(pathname) ? "classic" : "default";

	return <Toaster richColors variant={variant} />;
}
