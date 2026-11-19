import type { Db } from "@crm/db";
import {
	Controller,
	ForbiddenException,
	Get,
	Headers,
	Logger,
	Post,
	ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
	ApiExcludeEndpoint,
	ApiForbiddenResponse,
	ApiHeader,
	ApiOkResponse,
	ApiOperation,
	ApiServiceUnavailableResponse,
	ApiTags,
} from "@nestjs/swagger";
import { AllowAnonymous } from "@thallesp/nestjs-better-auth";
import type { EnvironmentVariables } from "../config/env.validation";
import { InjectDatabase } from "../database/database.constants";
import { forEachOrganization } from "../tenancy/for-each-organization";
import { ConversionService } from "./conversion.service";
import { RatesService } from "./rates.service";

@ApiTags("Internal — Cron")
@ApiHeader({
	name: "authorization",
	description: "`Bearer <CRON_SECRET>`",
	required: true,
})
@ApiForbiddenResponse({ description: "CRON_SECRET did not match." })
@ApiServiceUnavailableResponse({ description: "CRON_SECRET is not set." })
@Controller("internal/sync")
export class RatesController {
	private readonly logger = new Logger(RatesController.name);
	private readonly secret: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly rates: RatesService,
		private readonly conversion: ConversionService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("rates")
	@AllowAnonymous()
	@ApiOperation({
		summary: "Refresh exchange rates and convert amounts left pending",
	})
	@ApiOkResponse({ description: "Rates refreshed; conversion counts." })
	async ratesViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("rates")
	@AllowAnonymous()
	@ApiExcludeEndpoint()
	async ratesViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run the rates route.",
			});
			throw new ServiceUnavailableException("Rate refresh is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		const outcomes = await forEachOrganization(
			this.db,
			this.logger,
			"Exchange-rate refresh",
			async () => {
				const refresh = await this.rates.refresh();
				if (!refresh.ok) return { ...refresh, converted: 0, missing: 0 };

				const filled = await this.conversion.fillMissing();
				return {
					...refresh,
					converted: filled.converted,
					missing: filled.missing,
				};
			},
		);

		return {
			workspaces: outcomes.length,
			refreshed: outcomes.filter((outcome) => outcome.ok && outcome.value.ok)
				.length,
			converted: outcomes.reduce(
				(sum, outcome) => sum + (outcome.ok ? outcome.value.converted : 0),
				0,
			),
		};
	}
}

function timingSafeEquals(a: string, b: string): boolean {
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) {
		mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	}

	return mismatch === 0;
}
