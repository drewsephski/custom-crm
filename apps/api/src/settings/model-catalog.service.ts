import {
	type AnthropicModel,
	complexModel,
	defaultModel,
} from "@crm/db/ai-models";
import { Injectable } from "@nestjs/common";
import type { CatalogModel } from "./settings.contracts";

const PER_TOKEN = 1 / 1_000_000;

function toCatalogModel(model: AnthropicModel, name: string): CatalogModel {
	return {
		id: model.id,
		name,
		provider: "anthropic",
		contextWindowTokens: model.contextWindowTokens,
		pricing: {
			input: model.usdPerMillionInput * PER_TOKEN,
			output: model.usdPerMillionOutput * PER_TOKEN,
		},
	};
}

@Injectable()
export class ModelCatalogService {
	async models(): Promise<CatalogModel[]> {
		const everyday = defaultModel();
		const complex = complexModel();

		return everyday.id === complex.id
			? [toCatalogModel(everyday, "Everyday model")]
			: [
					toCatalogModel(everyday, "Everyday model"),
					toCatalogModel(complex, "Complex reasoning model"),
				];
	}

	async find(id: string): Promise<CatalogModel | null> {
		return (await this.models()).find((model) => model.id === id) ?? null;
	}
}
