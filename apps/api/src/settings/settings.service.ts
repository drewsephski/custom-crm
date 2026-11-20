import type { Db } from "@crm/db";
import { AI_MODEL_DEFAULTS, isAnthropicConfigured } from "@crm/db/ai-models";
import {
	configuredAgentModel,
	readArchiveRetentionDays,
	writeArchiveRetentionDays,
} from "@crm/db/settings";
import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { ModelCatalogService } from "./model-catalog.service";
import type {
	AgentModelSettings,
	ArchiveRetentionSettings,
	ModelCatalogResult,
} from "./settings.contracts";

@Injectable()
export class SettingsService {
	private readonly logger = new Logger(SettingsService.name);

	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly catalog: ModelCatalogService,
	) {}

	async agentModel(): Promise<AgentModelSettings> {
		const model = configuredAgentModel();

		return {
			selectedId: model.isDefault ? null : model.id,
			effectiveId: model.id,
			defaultId: AI_MODEL_DEFAULTS.default,
			effective: await this.catalog.find(model.id),
			updatedAt: null,
		};
	}

	async setAgentModel(_modelId: string | null): Promise<AgentModelSettings> {
		throw new BadRequestException(
			"The model is set on the server with ANTHROPIC_MODEL and ANTHROPIC_COMPLEX_MODEL, so it is the same for every workspace.",
		);
	}

	async modelCatalog(): Promise<ModelCatalogResult> {
		const models = await this.catalog.models();
		return { models, available: isAnthropicConfigured() };
	}

	async archiveRetention(): Promise<ArchiveRetentionSettings> {
		return { days: await readArchiveRetentionDays(this.db) };
	}

	async setArchiveRetention(days: number): Promise<ArchiveRetentionSettings> {
		const saved = await writeArchiveRetentionDays(this.db, days);

		this.logger.log({
			message: "Archive retention changed",
			days: saved,
		});

		return { days: saved };
	}
}
