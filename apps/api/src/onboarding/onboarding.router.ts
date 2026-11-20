import { Inject } from "@nestjs/common";
import {
	Ctx,
	Input,
	Mutation,
	Query,
	Router,
	UseMiddlewares,
} from "nestjs-trpc";
import type { z } from "zod";
import { sessionOrganizationId } from "../tenancy/session-organization";
import type { UserTrpcContext } from "../trpc/context.types";
import { UserMiddleware } from "../trpc/middlewares/auth.middleware";
import { SessionOnlyMiddleware } from "../trpc/middlewares/session-only.middleware";
import {
	brandOutput,
	finishOutput,
	lookupBrandInput,
	progressOutput,
	saveBusinessInput,
	saveBusinessTypeInput,
	saveCustomizeInput,
	saveGoalsInput,
	stateInput,
	stateOutput,
} from "./onboarding.contracts";
import { OnboardingService } from "./onboarding.service";

@Router({ alias: "onboarding" })
@UseMiddlewares(UserMiddleware, SessionOnlyMiddleware)
export class OnboardingRouter {
	constructor(
		@Inject(OnboardingService) private readonly onboarding: OnboardingService,
	) {}
	@Query({ input: stateInput, output: stateOutput })
	async state(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof stateInput>,
	) {
		return this.onboarding.state(
			ctx.user.id,
			sessionOrganizationId(ctx.session),
			input.another,
		);
	}
	@Mutation({ input: saveBusinessTypeInput, output: progressOutput })
	async saveBusinessType(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof saveBusinessTypeInput>,
	) {
		return this.onboarding.saveBusinessType(ctx.user.id, input);
	}
	@Mutation({ input: saveGoalsInput, output: progressOutput })
	async saveGoals(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof saveGoalsInput>,
	) {
		return this.onboarding.saveGoals(ctx.user.id, input);
	}
	@Mutation({ input: saveBusinessInput, output: progressOutput })
	async saveBusiness(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof saveBusinessInput>,
	) {
		return this.onboarding.saveBusiness(ctx.user.id, input);
	}
	@Mutation({ input: saveCustomizeInput, output: progressOutput })
	async saveCustomize(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof saveCustomizeInput>,
	) {
		return this.onboarding.saveCustomize(ctx.user.id, input);
	}
	@Mutation({ input: lookupBrandInput, output: brandOutput })
	async lookupBrand(
		@Ctx() ctx: UserTrpcContext,
		@Input() input: z.infer<typeof lookupBrandInput>,
	) {
		return this.onboarding.lookupBrand(ctx.user.id, input.website);
	}
	@Mutation({ output: progressOutput })
	async back(@Ctx() ctx: UserTrpcContext) {
		return this.onboarding.back(ctx.user.id);
	}
	@Mutation({ output: finishOutput })
	async finish(@Ctx() ctx: UserTrpcContext) {
		return this.onboarding.finish(ctx.user.id, ctx.session?.session.id ?? null);
	}
}
