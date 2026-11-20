import {
	type BrandPreviewRequest,
	type BrandPreviewResponse,
	brandPreviewRequest,
	brandPreviewResponse,
} from "@crm/validation/onboarding-brand";
import { Injectable, Logger } from "@nestjs/common";
import { bridge } from "../agent/bridge";
import { ONBOARDING } from "./onboarding.config";

const UNAVAILABLE: BrandPreviewResponse = { status: "unavailable" };

@Injectable()
export class BrandPreviewClient {
	private readonly logger = new Logger(BrandPreviewClient.name);

	available(): boolean {
		return bridge() !== null;
	}

	async preview(request: BrandPreviewRequest): Promise<BrandPreviewResponse> {
		const agent = bridge();
		if (!agent) return UNAVAILABLE;

		try {
			const response = await fetch(agent.url(ONBOARDING.brand.path), {
				method: "POST",
				headers: {
					authorization: `Bearer ${agent.secret}`,
					"content-type": "application/json",
				},
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
