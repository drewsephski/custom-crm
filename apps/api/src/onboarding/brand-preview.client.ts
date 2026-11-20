import { agentCommandBridge } from "@crm/env/service-urls";
import {
	type BrandPreviewRequest,
	type BrandPreviewResponse,
	brandPreviewRequest,
	brandPreviewResponse,
} from "@crm/validation/onboarding-brand";
import { Injectable, Logger } from "@nestjs/common";
import { ONBOARDING } from "./onboarding.config";

const UNAVAILABLE: BrandPreviewResponse = { status: "unavailable" };

@Injectable()
export class BrandPreviewClient {
	private readonly logger = new Logger(BrandPreviewClient.name);

	available(): boolean {
		return agentCommandBridge() !== null;
	}

	async preview(request: BrandPreviewRequest): Promise<BrandPreviewResponse> {
		const agent = agentCommandBridge();
		if (!agent) return UNAVAILABLE;

		try {
			const response = await agent.post(ONBOARDING.brand.path, {
				body: JSON.stringify(brandPreviewRequest.parse(request)),
				signal: AbortSignal.timeout(ONBOARDING.brand.timeoutMs),
			});

			if (!response.ok) {
				this.logger.warn({
					message: "Brand preview refused",
					status: response.status,
				});
				return UNAVAILABLE;
			}

			const answer = brandPreviewResponse.safeParse(await response.json());
			if (!answer.success) {
				this.logger.warn({ message: "Brand preview answer is unreadable" });
				return UNAVAILABLE;
			}

			return answer.data;
		} catch (error) {
			this.logger.warn({
				message: "Brand preview did not answer",
				reason: error instanceof Error ? error.name : "unknown",
			});
			return UNAVAILABLE;
		}
	}
}
