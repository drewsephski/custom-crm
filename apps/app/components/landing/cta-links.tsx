import { Button } from "@crm/ui/components/button";
import Link from "next/link";
import { GET_STARTED_PATH, SIGN_IN_PATH } from "@/lib/auth-redirect";

export function CtaLinks() {
	return (
		<div className="flex flex-wrap items-center justify-center gap-3">
			<Button size="xl" asChild>
				<Link href={GET_STARTED_PATH}>Get started</Link>
			</Button>
			<Button variant="outline-ghost" size="xl" asChild>
				<Link href={SIGN_IN_PATH}>Sign in</Link>
			</Button>
		</div>
	);
}
