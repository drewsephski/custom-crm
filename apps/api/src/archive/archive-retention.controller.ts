import type { Db } from "@crm/db";
import { readArchiveRetentionDays } from "@crm/db/settings";
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
import { CompaniesService } from "../companies/companies.service";
import type { EnvironmentVariables } from "../config/env.validation";
import { ContactsService } from "../contacts/contacts.service";
import { InjectDatabase } from "../database/database.constants";
import { DealsService } from "../deals/deals.service";
import { forEachOrganization } from "../tenancy/for-each-organization";

const DAY_MS = 24 * 60 * 60_000;

@ApiTags("Internal — Cron")
@ApiHeader({
	name: "authorization",
	description: "`Bearer <CRON_SECRET>`",
	required: true,
})
@ApiForbiddenResponse({ description: "CRON_SECRET did not match." })
@ApiServiceUnavailableResponse({ description: "CRON_SECRET is not set." })
@Controller("internal/archive")
export class ArchiveRetentionController {
	private readonly logger = new Logger(ArchiveRetentionController.name);
	private readonly secret: string | undefined;

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly companies: CompaniesService,
		private readonly contacts: ContactsService,
		private readonly deals: DealsService,
		config: ConfigService<EnvironmentVariables, true>,
	) {
		this.secret = config.get("CRON_SECRET", { infer: true });
	}

	@Get("prune")
	@AllowAnonymous()
	@ApiOperation({
		summary: "Purge companies, contacts and deals past the archive window",
	})
	@ApiOkResponse({ description: "The prune ran; per-record-type counts." })
	async pruneViaGet(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	@Post("prune")
	@AllowAnonymous()
	@ApiExcludeEndpoint()
	async pruneViaPost(@Headers("authorization") authorization?: string) {
		return this.run(authorization);
	}

	private async run(authorization?: string) {
		if (!this.secret) {
			this.logger.error({
				message: "CRON_SECRET is not set — refusing to run archive pruning.",
			});
			throw new ServiceUnavailableException("Pruning is not configured.");
		}

		if (!timingSafeEquals(authorization ?? "", `Bearer ${this.secret}`)) {
			throw new ForbiddenException();
		}

		const outcomes = await forEachOrganization(
			this.db,
			this.logger,
			"Archive retention",
			async () => {
				const retentionDays = await readArchiveRetentionDays(this.db);
				const before = new Date(Date.now() - retentionDays * DAY_MS);

				const [companies, contacts, deals] = await Promise.all([
					this.companies.purgeExpired(before),
					this.contacts.purgeExpired(before),
					this.deals.purgeExpired(before),
				]);

				return { retentionDays, companies, contacts, deals };
			},
		);

		const swept = outcomes.flatMap((outcome) =>
			outcome.ok ? [outcome.value] : [],
		);

		this.logger.log({
			message: "Archive retention swept",
			workspaces: outcomes.length,
			failed: outcomes.length - swept.length,
			companies: swept.reduce((sum, run) => sum + run.companies.succeeded, 0),
			contacts: swept.reduce((sum, run) => sum + run.contacts.succeeded, 0),
			deals: swept.reduce((sum, run) => sum + run.deals.succeeded, 0),
		});

		return {
			workspaces: outcomes.length,
			failed: outcomes.length - swept.length,
			companies: swept.reduce((sum, run) => sum + run.companies.succeeded, 0),
			contacts: swept.reduce((sum, run) => sum + run.contacts.succeeded, 0),
			deals: swept.reduce((sum, run) => sum + run.deals.succeeded, 0),
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
