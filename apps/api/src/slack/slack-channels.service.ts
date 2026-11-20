import { requireOrganizationId } from "@crm/db/tenancy";
import { agentCommandBridge } from "@crm/env/service-urls";
import {
	BadRequestException,
	Injectable,
	Logger,
	ServiceUnavailableException,
} from "@nestjs/common";
import { slackCreateChannelReply } from "./slack.contracts";

const CREATE_TIMEOUT_MS = 20_000;

const SERVER_ERROR_STATUS = 500;

@Injectable()
export class SlackChannelsService {
	private readonly logger = new Logger(SlackChannelsService.name);

	async create(name: string, isPrivate: boolean) {
		const agent = agentCommandBridge();

		if (!agent) {
			throw new ServiceUnavailableException(
				"This install has no AGENT_BRIDGE_SECRET, so nothing can reach Slack.",
			);
		}

		let response: Response;

		try {
			response = await agent.post("/internal/crm/slack/create-channel", {
				body: JSON.stringify({
					type: "slack.channel.create",
					channelName: name,
					isPrivate,
					organizationId: requireOrganizationId(),
				}),
				signal: AbortSignal.timeout(CREATE_TIMEOUT_MS),
			});
		} catch (error) {
			this.logger.error(
				{ message: "Could not reach the agent to create a channel", name },
				error instanceof Error ? error.stack : String(error),
			);
			throw new ServiceUnavailableException(
				"The agent is not answering, so the channel was not created.",
			);
		}

		if (response.status >= SERVER_ERROR_STATUS) {
			this.logger.error({
				message: "The agent failed while creating a channel",
				name,
				status: response.status,
			});
			throw new ServiceUnavailableException(
				"The agent failed, so the channel was not created.",
			);
		}

		const reply = slackCreateChannelReply.safeParse(
			await response.json().catch(() => null),
		);

		if (!reply.success) {
			this.logger.error({
				message: "The agent returned an unreadable channel reply",
				name,
				status: response.status,
			});
			throw new ServiceUnavailableException(
				"The agent answered with something unreadable, so the channel was not created.",
			);
		}

		if ("error" in reply.data) {
			throw new BadRequestException(reply.data.error);
		}

		if (!response.ok) {
			throw new BadRequestException("Slack refused to create that channel.");
		}

		return { channel: reply.data.channel };
	}
}
