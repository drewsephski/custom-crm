import { Link } from "@crm/ui/components/link";
import { PRODUCT } from "@crm/validation/product";
import NextLink from "next/link";
import { GET_STARTED_PATH, SIGN_IN_PATH } from "@/lib/auth-redirect";
import { Wordmark } from "./wordmark";

const PRODUCT_LINKS = [
	{ label: "Get started", href: GET_STARTED_PATH },
	{ label: "Sign in", href: SIGN_IN_PATH },
] as const;

export function LandingFooter() {
	return (
		<footer className="relative flex w-full shrink-0 flex-col items-center border-border border-t">
			<div className="flex w-full max-w-6xl flex-col items-start justify-between gap-12 px-6 py-16 sm:flex-row sm:gap-16">
				<div className="flex w-[280px] max-w-full shrink-0 flex-col gap-[14px]">
					<Wordmark />
					<p className="text-[13px]/[21px] text-muted-foreground">
						{PRODUCT.tagline}.
					</p>
				</div>

				<nav
					aria-label="Product"
					className="flex w-[180px] shrink-0 flex-col items-start gap-[14px]"
				>
					<p className="font-mono text-[11px]/4 text-muted-foreground tracking-widest">
						PRODUCT
					</p>
					{PRODUCT_LINKS.map((link) => (
						<Link
							key={link.href}
							variant="quiet"
							asChild
							className="text-[13px]/6"
						>
							<NextLink href={link.href}>{link.label}</NextLink>
						</Link>
					))}
				</nav>
			</div>

			<div className="flex w-full justify-center border-border border-t">
				<div className="flex w-full max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-6 py-4 md:h-[60px] md:py-0">
					<p className="text-[13px]/[21px] text-muted-foreground">
						{PRODUCT.name} is built on the open-source project{" "}
						<Link
							href={PRODUCT.upstream.url}
							target="_blank"
							rel="noreferrer"
							className="font-medium text-foreground"
						>
							{PRODUCT.upstream.name}
						</Link>{" "}
						({PRODUCT.upstream.license} license).
					</p>
				</div>
			</div>
		</footer>
	);
}
