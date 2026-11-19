import { workspaceAuthor } from "@crm/auth/organization";
import { ActivityType, type Db } from "@crm/db";
import type { ActivityMetaFields } from "@crm/validation/activity-meta";
import { Injectable } from "@nestjs/common";
import { InjectDatabase } from "../database/database.constants";
import { ActivityStampService } from "./activity-stamp.service";

export type EnrichmentEvent = {
	companyId?: string | null;
	contactId?: string | null;
	subject: string;
	body?: string | null;
	meta?: ActivityMetaFields;
};

@Injectable()
export class EnrichmentLogService {
	constructor(
		@InjectDatabase() private readonly db: Db,
		private readonly stamp: ActivityStampService,
	) {}

	async record(event: EnrichmentEvent): Promise<string | null> {
		const author = await this.authorFor(event);
		if (!author) return null;

		const activity = await this.db.activity.create({
			data: {
				type: ActivityType.ENRICHMENT,
				subject: event.subject,
				body: event.body ?? null,
				occurredAt: new Date(),
				companyId: event.companyId ?? null,
				contactId: event.contactId ?? null,
				createdById: author,
				meta: { ...event.meta, automated: true },
			},
			select: { id: true, createdAt: true },
		});

		await this.stamp.touch(
			{ companyId: event.companyId, contactId: event.contactId },
			activity.createdAt,
		);

		return activity.id;
	}

	private async authorFor(event: EnrichmentEvent): Promise<string | null> {
		const contact = event.contactId
			? await this.db.contact.findUnique({
					where: { id: event.contactId },
					select: { ownerId: true },
				})
			: null;
		const company =
			!contact?.ownerId && event.companyId
				? await this.db.company.findUnique({
						where: { id: event.companyId },
						select: { ownerId: true },
					})
				: null;

		return workspaceAuthor(
			contact?.ownerId ?? company?.ownerId ?? null,
			this.db,
		);
	}
}
