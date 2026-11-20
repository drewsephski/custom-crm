import { CtaLinks } from "./cta-links";

export function ClosingCta() {
	return (
		<section className="relative flex w-full shrink-0 flex-col items-center gap-8 px-6 py-10">
			<div className="relative flex w-[970px] max-w-full shrink-0 flex-col items-center justify-center gap-7 bg-background px-6 py-[72px] md:h-[482px] md:px-12">
				<h2 className="text-balance text-center font-semibold text-4xl/[42px] tracking-tight md:text-[44px]/[50px]">
					Your workspace is ready in minutes.
				</h2>

				<p className="max-w-[520px] text-pretty text-center text-muted-foreground text-lg/[28px]">
					Sign up with Google or your email. There is nothing to install.
				</p>

				<CtaLinks />
			</div>
		</section>
	);
}
