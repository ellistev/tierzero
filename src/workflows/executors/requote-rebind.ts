/**
 * Requote Rebind Workflow Executor.
 * 
 * Handles the full bind failure resolution:
 * 1. Query App Insights for RegistrationTransactionId
 * 2. Verify ACL failure pattern
 * 3. Find QuoteId in Data Explorer
 * 4. Append correction event
 * 5. Manually bind quote
 * 6. Wait for bind completion
 * 7. Submit payment repair
 * 8. Wait for payment completion
 * 
 * This is the automation of what automate-repairs.js Option 4 does manually.
 */

import fs from "fs";
import path from "path";
import type { ScrapedTicketDetail } from "../../browser/servicenow-scraper";
import { downloadAttachment } from "../../browser/servicenow-scraper";
import {
  checkAclQueue,
  findQuoteId,
  appendCorrectionAndBind,
  pollAclCompletion,
  submitPaymentRepair,
} from "../../browser/drive-admin";
import { queryByJobNumber } from "../../integrations/app-insights";
import type {
  WorkflowExecutor,
  WorkflowContext,
  WorkflowResult,
  WorkflowStep,
  WorkflowDecision,
} from "../types";

const COMPLETION_COMMENT = "requote bound, and payments sent to gwbc";

export class RequoteRebindExecutor implements WorkflowExecutor {
  readonly id = "requote-rebind";
  readonly name = "SGI Requote Rebind";
  readonly description =
    "Resolves Guidewire bind failures by appending a correction event, " +
    "manually binding the quote, and submitting payment repair.";

  canHandle(ticket: ScrapedTicketDetail): WorkflowDecision {
    // Already resolved
    if (ticket.alreadyFixed) return "skip";

    // Must have the GW error signature
    if (!ticket.hasGwError) return "skip";

    // Need a job number to proceed
    if (!ticket.oldJobNumber) return "needs_info";

    // Need an attachment (or local file)
    // We'll check for local file during execution
    return "execute";
  }

  async execute(
    ticket: ScrapedTicketDetail,
    ctx: WorkflowContext
  ): Promise<WorkflowResult> {
    const steps: WorkflowStep[] = [];
    const now = () => new Date().toISOString();
    const { logger, browser, workDir, dryRun } = ctx;

    const oldJob = ticket.oldJobNumber!;
    let newJob = "";
    let regTxId = "";
    let quoteId = "";

    try {
      // ── Step 1: Get JSON payload ──────────────────────────────
      logger.step("Step 1", `Loading JSON payload for job ${oldJob}`);

      let jsonPath = path.join(workDir, `${oldJob}.json`);
      let jsonContent: string;

      if (fs.existsSync(jsonPath)) {
        logger.log(`✓ Found local file: ${oldJob}.json`);
        jsonContent = fs.readFileSync(jsonPath, "utf-8");
      } else if (ticket.attachmentSysId) {
        logger.log(`📎 Downloading attachment from ServiceNow...`);

        // Need a ServiceNow session to download
        const { openServiceNow } = await import("../../browser/servicenow-scraper");
        const session = await openServiceNow(browser, {
          onWaiting: () => logger.warn("Please log into ServiceNow"),
          onLoggedIn: () => logger.log("✓ ServiceNow login detected"),
        });

        const content = await downloadAttachment(session, ticket);
        if (!content) {
          steps.push({ name: "download-attachment", status: "failed", detail: "fetch() returned null", timestamp: now() });
          return {
            success: false, decision: "escalate",
            summary: "Could not download JSON attachment from ServiceNow",
            steps, error: "Attachment download failed",
          };
        }

        fs.writeFileSync(jsonPath, content, "utf-8");
        jsonContent = content;
        logger.log(`✓ Saved as ${oldJob}.json`);
      } else {
        steps.push({ name: "load-json", status: "failed", detail: "No local file and no attachment", timestamp: now() });
        return {
          success: false, decision: "escalate",
          summary: "No JSON payload available (no attachment, no local file)",
          steps, error: "Missing JSON payload",
        };
      }

      // Extract new job number
      const jsonData = JSON.parse(jsonContent);
      newJob = jsonData.quoteCompositeResponse.responses[0].body.data.attributes.jobNumber;
      logger.log(`Old Job: ${oldJob} -> New Job: ${newJob}`);
      steps.push({ name: "load-json", status: "completed", detail: `Old: ${oldJob}, New: ${newJob}`, timestamp: now() });

      // ── Step 2: Query App Insights ────────────────────────────
      logger.step("Step 2", `Querying App Insights for job ${oldJob}`);

      if (dryRun) {
        logger.log("[dry-run] Would query App Insights");
        steps.push({ name: "app-insights", status: "skipped", detail: "dry-run", timestamp: now() });
        regTxId = "dry-run-reg-tx-id";
      } else {
        const kqlResult = queryByJobNumber(oldJob);
        if (!kqlResult) {
          steps.push({ name: "app-insights", status: "failed", detail: "No results", timestamp: now() });
          return {
            success: false, decision: "escalate",
            summary: `No App Insights results for job ${oldJob}`,
            steps, error: "KQL query returned no results",
          };
        }
        regTxId = kqlResult.registrationTransactionId;
        logger.log(`✓ RegistrationTransactionId: ${regTxId}`);
        logger.log(`✓ QuoteNumber: ${kqlResult.quoteNumber}`);
        steps.push({ name: "app-insights", status: "completed", detail: `RegTxId: ${regTxId}`, timestamp: now() });
      }

      // ── Step 3: Verify ACL failure pattern ────────────────────
      logger.step("Step 3", "Verifying ACL Command Queue failure pattern");

      const contexts = browser.contexts();
      const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
      const aclPage = await context.newPage();
      const workPage = await context.newPage();

      if (dryRun) {
        logger.log("[dry-run] Would check ACL queue");
        steps.push({ name: "acl-verify", status: "skipped", detail: "dry-run", timestamp: now() });
      } else {
        const pattern = await checkAclQueue(aclPage, regTxId, {
          onAuthWait: () => logger.warn("Please log into DRIVE admin"),
          onAuthDone: () => logger.log("✓ DRIVE login detected"),
        });

        const allFailed = pattern.SendBoundQuoteToDrive &&
          pattern.SendPaymentRequestToInsurCloud &&
          pattern.SendPaymentToDrive;

        if (allFailed) {
          logger.log("🟢 Standard failure pattern confirmed");
        } else {
          logger.warn("🟡 Non-standard failure pattern: " + JSON.stringify(pattern));
        }
        steps.push({ name: "acl-verify", status: "completed", detail: JSON.stringify(pattern), timestamp: now() });
      }

      // ── Step 4: Find QuoteId ──────────────────────────────────
      logger.step("Step 4", "Finding QuoteId in Data Explorer");

      if (dryRun) {
        logger.log("[dry-run] Would search Data Explorer");
        steps.push({ name: "find-quote", status: "skipped", detail: "dry-run", timestamp: now() });
        quoteId = "dry-run-quote-id";
      } else {
        quoteId = await findQuoteId(workPage, regTxId, {
          onAuthWait: () => logger.warn("Please log into DRIVE admin"),
          onAuthDone: () => logger.log("✓ DRIVE login detected"),
        });
        logger.log(`✓ QuoteId: ${quoteId}`);
        steps.push({ name: "find-quote", status: "completed", detail: `QuoteId: ${quoteId}`, timestamp: now() });
      }

      // ── Step 5: Append correction event + bind ────────────────
      logger.step("Step 5", "Appending correction event and triggering bind");

      if (dryRun) {
        logger.log("[dry-run] Would append correction event and bind");
        steps.push({ name: "append-bind", status: "skipped", detail: "dry-run", timestamp: now() });
      } else {
        await appendCorrectionAndBind(workPage, quoteId, jsonContent!);
        logger.log("✓ Correction event appended, manual bind triggered");
        steps.push({ name: "append-bind", status: "completed", detail: "Correction appended, bind triggered", timestamp: now() });
      }

      // ── Step 6: Wait for bind completion ──────────────────────
      logger.step("Step 6", "Polling for bind completion");

      if (dryRun) {
        logger.log("[dry-run] Would poll ACL queue");
        steps.push({ name: "poll-bind", status: "skipped", detail: "dry-run", timestamp: now() });
      } else {
        await aclPage.bringToFront();
        const bindOk = await pollAclCompletion(aclPage, "SendBoundQuoteToDrive", {
          timeoutMs: 180000,
          onPoll: (elapsed) => logger.log(`  [${elapsed}s] Polling...`),
        });

        if (bindOk) {
          logger.log("✅ SendBoundQuoteToDrive: Completed");
          steps.push({ name: "poll-bind", status: "completed", detail: "Bind completed", timestamp: now() });
        } else {
          logger.warn("Timed out waiting for bind");
          steps.push({ name: "poll-bind", status: "failed", detail: "Timeout", timestamp: now() });
          // Continue anyway -- payment might still work
        }
      }

      // ── Step 7: Payment repair ────────────────────────────────
      logger.step("Step 7", `Submitting payment repair for job ${newJob}`);

      if (dryRun) {
        logger.log("[dry-run] Would submit payment repair");
        steps.push({ name: "payment-repair", status: "skipped", detail: "dry-run", timestamp: now() });
      } else {
        await workPage.bringToFront();
        await submitPaymentRepair(workPage, newJob, {
          onAuthWait: () => logger.warn("Please log into DRIVE admin"),
          onAuthDone: () => logger.log("✓ DRIVE login detected"),
        });
        logger.log("✓ Payment repair submitted");
        steps.push({ name: "payment-repair", status: "completed", detail: `Job: ${newJob}`, timestamp: now() });
      }

      // ── Step 8: Wait for payment completion ───────────────────
      logger.step("Step 8", "Polling for payment completion");

      if (dryRun) {
        logger.log("[dry-run] Would poll for payment");
        steps.push({ name: "poll-payment", status: "skipped", detail: "dry-run", timestamp: now() });
      } else {
        await aclPage.bringToFront();
        const payOk = await pollAclCompletion(aclPage, "SendPaymentToDrive", {
          timeoutMs: 180000,
          excludePattern: "SendFailedPaymentToDrive",
          onPoll: (elapsed) => logger.log(`  [${elapsed}s] Polling...`),
        });

        if (payOk) {
          logger.log("✅ SendPaymentToDrive: Completed");
          steps.push({ name: "poll-payment", status: "completed", detail: "Payment completed", timestamp: now() });
        } else {
          logger.warn("Timed out waiting for payment");
          steps.push({ name: "poll-payment", status: "failed", detail: "Timeout", timestamp: now() });
        }
      }

      // ── Done ──────────────────────────────────────────────────
      const allStepsOk = steps.every(s => s.status !== "failed");

      if (!dryRun && allStepsOk) {
        // Mark JSON as done
        const doneFile = path.join(workDir, `d${oldJob}.json`);
        try { fs.renameSync(jsonPath, doneFile); } catch {}
      }

      return {
        success: dryRun ? true : allStepsOk,
        decision: "execute",
        summary: dryRun
          ? `[dry-run] Would rebind job ${oldJob} -> ${newJob}`
          : `Rebound job ${oldJob} -> ${newJob}, payment repair submitted`,
        ticketComment: allStepsOk ? COMPLETION_COMMENT : `Requote rebind partially failed for job ${oldJob} - needs manual review`,
        steps,
        data: { oldJob, newJob, regTxId, quoteId },
      };

    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Workflow failed: ${msg}`);
      steps.push({ name: "error", status: "failed", detail: msg, timestamp: now() });

      return {
        success: false,
        decision: "escalate",
        summary: `Requote rebind failed: ${msg}`,
        ticketComment: `Automated rebind failed for job ${oldJob}: ${msg}. Manual intervention required.`,
        commentIsInternal: true,
        steps,
        error: msg,
      };
    }
  }
}
