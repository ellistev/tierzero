/**
 * Plate Lookup Workflow Executor.
 * 
 * Resolves tickets requesting plate number information.
 * Job Number -> App Insights -> Data Explorer -> Plate Number
 */

import type { ScrapedTicketDetail } from "../../browser/servicenow-scraper";
import { lookupPlate } from "../../browser/drive-admin";
import { queryByJobNumber, queryByRegistrationId } from "../../integrations/app-insights";
import type {
  WorkflowExecutor,
  WorkflowContext,
  WorkflowResult,
  WorkflowStep,
  WorkflowDecision,
} from "../types";

export class PlateLookupExecutor implements WorkflowExecutor {
  readonly id = "plate-lookup";
  readonly name = "SGI Plate Number Lookup";
  readonly description =
    "Looks up plate numbers from job numbers or registration IDs " +
    "via App Insights and Data Explorer.";

  canHandle(ticket: ScrapedTicketDetail): WorkflowDecision {
    const desc = (ticket.description + " " + ticket.shortDesc).toLowerCase();

    // Check if this is a plate lookup request
    const isPlateRequest =
      desc.includes("plate") &&
      (desc.includes("lookup") || desc.includes("look up") || desc.includes("find") || desc.includes("what is"));

    if (!isPlateRequest) return "skip";

    // Need a job number or registration ID
    const hasJobNumber = /\b\d{7,}\b/.test(desc);
    const hasRegId = /reg[-\s]?\d+/i.test(desc) || /registration\s*id/i.test(desc);

    if (!hasJobNumber && !hasRegId) return "needs_info";

    return "execute";
  }

  async execute(
    ticket: ScrapedTicketDetail,
    ctx: WorkflowContext
  ): Promise<WorkflowResult> {
    const steps: WorkflowStep[] = [];
    const now = () => new Date().toISOString();
    const { logger, browser, dryRun } = ctx;

    try {
      const desc = ticket.description + " " + ticket.shortDesc;

      // Extract identifiers
      const jobMatch = desc.match(/\b(\d{7,})\b/);
      const regIdMatch = desc.match(/reg[-\s]?(\d+[-\w]*)/i);

      let regTxId: string | null = null;
      let jobNumber = jobMatch ? jobMatch[1] : null;

      // Step 1: Get RegistrationTransactionId
      logger.step("Step 1", "Finding RegistrationTransactionId");

      if (dryRun) {
        logger.log("[dry-run] Would query App Insights");
        steps.push({ name: "kql-query", status: "skipped", detail: "dry-run", timestamp: now() });
        return {
          success: true, decision: "execute",
          summary: `[dry-run] Would look up plate for job ${jobNumber || "unknown"}`,
          steps,
        };
      }

      if (jobNumber) {
        const result = queryByJobNumber(jobNumber);
        if (result) {
          regTxId = result.registrationTransactionId;
          logger.log(`✓ Job ${jobNumber} -> RegTxId: ${regTxId}`);
        }
      } else if (regIdMatch) {
        const result = queryByRegistrationId(regIdMatch[1]);
        if (result) {
          regTxId = result.registrationTransactionId;
          logger.log(`✓ RegId ${regIdMatch[1]} -> RegTxId: ${regTxId}`);
        }
      }

      if (!regTxId) {
        steps.push({ name: "kql-query", status: "failed", detail: "No results", timestamp: now() });
        return {
          success: false, decision: "escalate",
          summary: "Could not find RegistrationTransactionId in App Insights",
          ticketComment: "Unable to locate the registration transaction. Please provide additional details.",
          steps,
        };
      }

      steps.push({ name: "kql-query", status: "completed", detail: `RegTxId: ${regTxId}`, timestamp: now() });

      // Step 2: Look up plate in Data Explorer
      logger.step("Step 2", "Looking up plate in Data Explorer");

      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      const page = await context.newPage();

      const plateResult = await lookupPlate(page, regTxId, {
        onAuthWait: () => logger.warn("Please log into DRIVE admin"),
        onAuthDone: () => logger.log("✓ DRIVE login detected"),
      });

      if (plateResult.plateNumber) {
        logger.log(`✓ Plate Number: ${plateResult.plateNumber} (via ${plateResult.method})`);
        steps.push({ name: "plate-lookup", status: "completed", detail: `Plate: ${plateResult.plateNumber}`, timestamp: now() });

        const response =
          `Plate lookup results:\n` +
          `- Job Number: ${jobNumber || "N/A"}\n` +
          `- RegistrationTransactionId: ${regTxId}\n` +
          (plateResult.plateGuid ? `- Plate GUID: ${plateResult.plateGuid}\n` : "") +
          `- Plate Number: ${plateResult.plateNumber}`;

        return {
          success: true, decision: "execute",
          summary: `Found plate: ${plateResult.plateNumber}`,
          ticketComment: response,
          steps,
          data: {
            plateNumber: plateResult.plateNumber,
            plateGuid: plateResult.plateGuid,
            regTxId,
            jobNumber,
          },
        };
      } else {
        steps.push({ name: "plate-lookup", status: "failed", detail: "Could not extract plate number", timestamp: now() });
        return {
          success: false, decision: "escalate",
          summary: "Could not extract plate number from Data Explorer",
          ticketComment: "Automated plate lookup was unable to find the plate number. Manual lookup required.",
          commentIsInternal: true,
          steps,
        };
      }

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Plate lookup failed: ${msg}`);
      steps.push({ name: "error", status: "failed", detail: msg, timestamp: now() });
      return {
        success: false, decision: "escalate",
        summary: `Plate lookup failed: ${msg}`,
        steps, error: msg,
      };
    }
  }
}
