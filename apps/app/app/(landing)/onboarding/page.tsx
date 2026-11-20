import { AuthButton } from "@crm/ui/components/auth-button";
import { AuthInput } from "@crm/ui/components/auth-input";
import {
	BUSINESS_TYPES,
	businessTypeKey,
	GOALS,
	goalKey,
	ONBOARDING_STEPS,
} from "@crm/validation/onboarding";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthHeading, AuthShell } from "@/components/auth-shell";
import { requireSession } from "@/lib/session";
import { getServerTrpcClient } from "@/lib/trpc/server";

export const metadata = { title: "Set up your workspace" };
export const instant = false;

const titles = {
	"business-type": "What kind of business do you run?",
	goals: "What do you want help with?",
	business: "Tell us about your business",
	customize: "Choose your starting pipeline",
	finish: "Review your workspace",
};

export default async function OnboardingPage({
	searchParams,
}: PageProps<"/onboarding">) {
	await requireSession();
	const params = await searchParams;
	const another = params.new === "1";
	const path = another ? "/onboarding?new=1" : "/onboarding";
	const state = await getServerTrpcClient().onboarding.state.query({ another });
	if (state.kind === "done") redirect("/" + state.slug);
	const { step, answers, presets, customize, brand } = state.progress;
	async function save(form: FormData) {
		"use server";
		const api = getServerTrpcClient().onboarding;
		const value = (key: string) => String(form.get(key) ?? "");
		if (step === "business-type")
			await api.saveBusinessType.mutate({
				businessType: businessTypeKey.parse(value("type")),
				advance: true,
			});
		if (step === "goals" && !form.getAll("goal").length)
			redirect(path + (another ? "&" : "?") + "error=goals");
		if (step === "goals")
			await api.saveGoals.mutate({
				goals: goalKey.array().min(1).parse(form.getAll("goal")),
				advance: true,
			});
		if (step === "business") {
			const website = value("website").trim();
			const lookup =
				value("intent") === "lookup" ||
				(state.kind === "wizard" &&
					state.brandLookup &&
					!!website &&
					brand.status === "idle" &&
					params.review !== "1");
			await api.saveBusiness.mutate({
				businessName: value("name"),
				website,
				description: value("description"),
				industry: value("industry"),
				location: value("location"),
				useLogo: false,
				advance: !lookup,
			});
			if (lookup && website) {
				await api.lookupBrand.mutate({ website });
				redirect(path + (another ? "&" : "?") + "review=1");
			}
		}
		if (step === "customize") {
			const preset = presets.find((p) => p.key === value("preset"));
			if (!preset) throw new Error("Choose a pipeline.");
			await api.saveCustomize.mutate({
				presetKey: preset.key,
				pipeline: preset.stages.map((stage) => ({
					...stage,
					label: value(`${preset.key}/${stage.key}`).trim() || stage.label,
				})),
				advance: true,
			});
		}
		if (step === "finish")
			redirect(`/${(await api.finish.mutate()).slug}?welcome=1`);
		redirect(path);
	}
	async function back() {
		"use server";
		await getServerTrpcClient().onboarding.back.mutate();
		redirect(path);
	}
	const selected =
		presets.find((p) => p.key === customize.presetKey) ?? presets[0];
	return (
		<AuthShell>
			<AuthHeading
				title={titles[step]}
				description={`Step ${ONBOARDING_STEPS.indexOf(step) + 1} of ${ONBOARDING_STEPS.length}`}
			/>
			{state.invitations.length > 0 && (
				<Link href="/invitations">Review workspace invitations</Link>
			)}
			{params.error === "goals" && step === "goals" && (
				<p role="alert">Choose at least one goal.</p>
			)}
			<form key={step} action={save} className="grid gap-4">
				{step === "business-type" &&
					BUSINESS_TYPES.map((type) => (
						<label
							className="flex items-center gap-3 rounded-md border p-3"
							key={type.key}
						>
							<input
								type="radio"
								name="type"
								value={type.key}
								defaultChecked={type.key === answers.businessType}
								required
							/>
							{type.label}
						</label>
					))}
				{step === "goals" &&
					GOALS.map((goal) => (
						<label
							className="flex items-center gap-3 rounded-md border p-3"
							key={goal.key}
						>
							<input
								type="checkbox"
								name="goal"
								value={goal.key}
								defaultChecked={answers.goals.includes(goal.key)}
							/>
							{goal.label}
						</label>
					))}
				{step === "business" && (
					<>
						<label htmlFor="website">
							Website
							<AuthInput
								id="website"
								name="website"
								defaultValue={answers.website}
							/>
						</label>
						{state.brandLookup && (
							<AuthButton
								name="intent"
								value="lookup"
								variant="outline"
								formNoValidate
							>
								Look up business details
							</AuthButton>
						)}
						{brand.status !== "idle" && (
							<p role="status">
								{brand.suggestion
									? "Review the suggested business details."
									: "Enter your business details below."}
							</p>
						)}
						<label htmlFor="name">
							Business name
							<AuthInput
								id="name"
								name="name"
								required
								defaultValue={
									answers.businessName || brand.suggestion?.name || ""
								}
							/>
						</label>
						{(["description", "industry", "location"] as const).map((field) => (
							<label htmlFor={field} key={field} className="capitalize">
								{field}
								<AuthInput
									id={field}
									name={field}
									defaultValue={
										answers.details[field] || brand.suggestion?.[field] || ""
									}
								/>
							</label>
						))}
					</>
				)}
				{step === "customize" &&
					presets.map((p) => (
						<div key={p.key} className="grid gap-2 rounded-md border p-3">
							<label>
								<span>
									<input
										type="radio"
										required
										name="preset"
										value={p.key}
										defaultChecked={p.key === selected?.key}
									/>{" "}
									{p.label}
								</span>
							</label>
							<small>{p.stages.map((s) => s.label).join(" → ")}</small>
							<details>
								<summary>Edit stage names</summary>
								{p.stages.map((stage) => (
									<label htmlFor={p.key + stage.key} key={stage.key}>
										{stage.label}
										<AuthInput
											id={p.key + stage.key}
											name={`${p.key}/${stage.key}`}
											defaultValue={
												(customize.presetKey === p.key &&
													customize.pipeline?.find((s) => s.key === stage.key)
														?.label) ||
												stage.label
											}
										/>
									</label>
								))}
							</details>
						</div>
					))}
				{step === "finish" && (
					<>
						<strong>{answers.businessName}</strong>
						<p>{selected?.label}</p>
						<p>{customize.pipeline?.map((s) => s.label).join(" → ")}</p>
					</>
				)}
				<AuthButton type="submit">
					{step === "finish" ? "Confirm and open workspace" : "Continue"}
				</AuthButton>
			</form>
			{step !== "business-type" && (
				<form action={back}>
					<AuthButton variant="ghost">Back</AuthButton>
				</form>
			)}
		</AuthShell>
	);
}
