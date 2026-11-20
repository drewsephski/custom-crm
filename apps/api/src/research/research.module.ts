import { Module } from "@nestjs/common";
import { CompaniesModule } from "../companies/companies.module";
import { ContactsModule } from "../contacts/contacts.module";
import { TrpcModule } from "../trpc/trpc.module";
import { ResearchRouter } from "./research.router";
import { ResearchService } from "./research.service";

@Module({
	imports: [TrpcModule, CompaniesModule, ContactsModule],
	providers: [ResearchService, ResearchRouter],
	exports: [ResearchService],
})
export class ResearchModule {}
