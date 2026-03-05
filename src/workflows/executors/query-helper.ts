/**
 * Query Helper Workflow Executor.
 * 
 * Handles tickets that need ID cross-reference lookups:
 * - Job Number -> RegistrationTransactionId
 * - Registration ID -> RegistrationTransactionId
 * - RegistrationTransactionId -> QuoteId
 */

import type { ScrapedTicketDetail } from "../../browser/servicenow-scraper";
import { queryByJobNumber, queryByRegistrationId } from "../../integrations/app-insights";
import type {
  WorkflowExecutor,
  WorkflowContext,
  WorkflowResult,
  WorkflowStep,
  WorkflowDecision,
} from "../types";

export class QueryHelperExecutor implements WorkflowExecutor {
  readonly id = "query-helper";
  readonly name = "SGI ID Lookup";
  readonly description =
    "Cross-references IDs across SGI systems: " +
    "job numbers, registration IDs, transaction IDs.";

  canHandle(ticket: ScrapedTicketDetail): WorkflowDecision {
    const desc = (ticket.description + " " + ticket.shortDesc).toLowerCase();

    const isLookupRequest =
      (desc.includes("look up") || desc.includes("lookup") || desc.includes("find") || desc.includes("what is")) &&
      (desc.includes("transaction") || desc.includes("registration id") || desc.includes("job number"));

    if (!isLookupRequest) return "skip";
    return "execute";
  }

  async execute(
    ticket: ScrapedTicketDetail,
    ctx: WorkflowContext
  ): Promise<WorkflowResult> {
    const steps: WorkflowStep[] = [];
    const now = () => new Date().toISOString();
    const { logger, dryRun } = ctx;

    try {
      const desc = ticket.description + " " + ticket.shortDesc;

      // Try to extract identifiers
      const jobMatch = desc.match(/\b(\d{7,})\b/);
      const regIdMatch = desc.match(/reg(?:istration)?[-\s]*(?:id)?[-\s:]*([a-f0-9-]{10,})/i);

      if (dryRun) {
        return {
          success: true, decision: "execute",
          summary: `[dry-run] Would query App Insights for ${jobMatch ? `job ${jobMatch[1]}` : regIdMatch ? `reg ${regIdMatch[1]}` : "unknown ID"}`,
          steps: [{ name: "kql-query", status: "skipped", detail: "dry-run", timestamp: now() }],
        };
      }

      const results: string[] = [];

      // Query by job number if found
      if (jobMatch) {
        const jobNumber = jobMatch[1];
        logger.step("Query", `Looking up job number ${jobNumber}`);

        const result = queryByJobNumber(jobNumber);
        if (result) {
          results.push(
            `Job Number: ${jobNumber}`,
            `  RegistrationId: ${result.registrationId}`,
            `  RegistrationTransactionId: ${result.registrationTransactionId}`,
            `  TransactionType: ${result.transactionType}`,
            `  Time: ${result.time}`,
          );
          logger.log(`✓ Found transaction for job ${jobNumber}`);
          steps.push({ name: "job-query", status: "completed", detail: `RegTxId: ${result.registrationTransactionId}`, timestamp: now() });
        } else {
          results.push(`Job Number ${jobNumber}: No results found in App Insights`);
          steps.push({ name: "job-query", status: "failed", detail: "No results", timestamp: now() });
        }
      }

      // Query by registration ID if found
      if (regIdMatch) {
        const regId = regIdMatch[1];
        logger.step("Query", `Looking up registration ID ${regId}`);

        const result = queryByRegistrationId(regId);
        if (result) {
          results.push(
            `Registration ID: ${regId}`,
            `  RegistrationTransactionId: ${result.registrationTransactionId}`,
            `  TransactionType: ${result.transactionType}`,
            `  Time: ${result.time}`,
          );
          logger.log(`✓ Found transaction for registration ${regId}`);
          steps.push({ name: "reg-query", status: "completed", detail: `RegTxId: ${result.registrationTransactionId}`, timestamp: now() });
        } else {
          results.push(`Registration ID ${regId}: No results found in App Insights`);
          steps.push({ name: "reg-query", status: "failed", detail: "No results", timestamp: now() });
        }
      }

      if (results.length === 0) {
        return {
          success: false, decision: "needs_info",
          summary: "Could not extract any IDs from the ticket",
          ticketComment: "Could not identify a job number or registration ID in the ticket. Please provide the specific ID you need looked up.",
          steps,
        };
      }

      return {
        success: true, decision: "execute",
        summary: `Completed ${results.length > 2 ? "multiple lookups" : "lookup"}`,
        ticketComment: "ID Lookup Results:\n\n" + results.join("\n"),
        steps,
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Query helper failed: ${msg}`);
      steps.push({ name: "error", status: "failed", detail: msg, timestamp: now() });
      return {
        success: false, decision: "escalate",
        summary: `Query failed: ${msg}`,
        steps, error: msg,
      };
    }
  }
}
