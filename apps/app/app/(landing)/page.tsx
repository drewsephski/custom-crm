import { PRODUCT } from "@crm/validation/product";
import type { Metadata } from "next";
import { AgentSection } from "@/components/landing/agent-section";
import { CapabilitiesSection } from "@/components/landing/capabilities-section";
import { ClosingCta } from "@/components/landing/closing-cta";
import { Hero } from "@/components/landing/hero";
import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";
import { ProductShot } from "@/components/landing/product-shot/product-shot";

const TITLE = `${PRODUCT.name}: ${PRODUCT.tagline}`;

export const metadata: Metadata = {
	title: { absolute: TITLE },
	description: PRODUCT.description,
	openGraph: {
		type: "website",
		siteName: PRODUCT.name,
		title: TITLE,
		description: PRODUCT.description,
	},
	twitter: {
		card: "summary",
		title: TITLE,
		description: PRODUCT.description,
	},
};

export default function Home() {
	return (
		<div className="dark flex min-h-svh w-full flex-col items-center overflow-clip bg-background font-sans text-foreground">
			<LandingNav />
			<Hero />
			<ProductShot />
			<AgentSection />
			<CapabilitiesSection />
			<ClosingCta />
			<LandingFooter />
		</div>
	);
}
