import { PRODUCT } from "@crm/validation/product";
import { CtaLinks } from "./cta-links";

export function Hero() {
	return (
		<section className="relative flex w-full shrink-0 flex-col items-center px-6 pt-20 pb-10 md:pt-30">
			<div className="relative flex w-full max-w-6xl flex-col items-center gap-7">
				<h1 className="max-w-[900px] text-balance text-center font-semibold text-5xl/[52px] tracking-tight md:text-[72px]/[76px]">
					{PRODUCT.tagline}
				</h1>

				<p className="max-w-[640px] text-pretty text-center text-muted-foreground text-lg/[28px] md:text-xl/[30px]">
					Your team does not move pipeline by hand. Research agents enrich every
					company and contact with sourced facts, keep each deal current, and
					book their own follow-ups. Create an account and start in minutes.
				</p>

				<div className="pt-3">
					<CtaLinks />
				</div>
			</div>
		</section>
	);
}
