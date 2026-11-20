ALTER TABLE "agentAction" DROP CONSTRAINT "agentAction_agentId_fkey";

ALTER TABLE "agentAuditEvent" DROP CONSTRAINT "agentAuditEvent_agentId_fkey";

ALTER TABLE "agentConversationSubmission" DROP CONSTRAINT "agentConversationSubmission_submittedById_fkey";

ALTER TABLE "agentDefinition" DROP CONSTRAINT "agentDefinition_createdById_fkey";

ALTER TABLE "agentRun" DROP CONSTRAINT "agentRun_agentId_fkey";

ALTER TABLE "agentRunEvent" DROP CONSTRAINT "agentRunEvent_runId_fkey";

ALTER TABLE "agentTrigger" DROP CONSTRAINT "agentTrigger_agentId_fkey";

ALTER TABLE "agentTrigger" DROP CONSTRAINT "agentTrigger_createdById_fkey";

ALTER TABLE "agentVersion" DROP CONSTRAINT "agentVersion_agentId_fkey";

ALTER TABLE "agentVersion" DROP CONSTRAINT "agentVersion_createdById_fkey";

ALTER TABLE "mcpConnection" DROP CONSTRAINT "mcpConnection_connectedById_fkey";

ALTER TABLE "mcpConnection" DROP CONSTRAINT "mcpConnection_registrationId_fkey";

ALTER TABLE "mcpConnection" ADD CONSTRAINT "mcpConnection_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "mcpClientRegistration"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "mcpConnection" ADD CONSTRAINT "mcpConnection_connectedById_fkey" FOREIGN KEY ("connectedById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentConversationSubmission" ADD CONSTRAINT "agentConversationSubmission_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentDefinition" ADD CONSTRAINT "agentDefinition_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentVersion" ADD CONSTRAINT "agentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentVersion" ADD CONSTRAINT "agentVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentTrigger" ADD CONSTRAINT "agentTrigger_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentTrigger" ADD CONSTRAINT "agentTrigger_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentRun" ADD CONSTRAINT "agentRun_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentRunEvent" ADD CONSTRAINT "agentRunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "agentRun"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentAction" ADD CONSTRAINT "agentAction_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

ALTER TABLE "agentAuditEvent" ADD CONSTRAINT "agentAuditEvent_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agentDefinition"("id") ON DELETE NO ACTION ON UPDATE CASCADE;
