/**
 * DRIVE Admin browser automation.
 * 
 * Handles the Registration Admin pages:
 * - ACL Command Queue (verify failures, poll for completion)
 * - Data Explorer (find quoteId, append correction events, bind quotes)
 * - Payment Repair (submit repair requests)
 */

import type { Page, BrowserContext } from "playwright";
import { navigateWithAuth } from "./auth";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export const ACL_QUEUE_URL = "https://drive.sgicloud.ca/registration-admin?tab=acl-command-queue";
export const DATA_EXPLORER_URL = "https://drive.sgicloud.ca/registration-admin?tab=data-explorer";
export const PAYMENT_REPAIR_URL = "https://drive.sgicloud.ca/registration-admin?tab=payment-repair";

// ---------------------------------------------------------------------------
// ACL Command Queue
// ---------------------------------------------------------------------------

export interface AclFailurePattern {
  SendBoundQuoteToDrive: boolean;
  SendPaymentRequestToInsurCloud: boolean;
  SendPaymentToDrive: boolean;
}

/**
 * Open the ACL Command Queue and filter by correlation ID.
 * Returns the failure pattern found.
 */
export async function checkAclQueue(
  page: Page,
  correlationId: string,
  options?: { onAuthWait?: () => void; onAuthDone?: () => void }
): Promise<AclFailurePattern> {
  await navigateWithAuth(page, ACL_QUEUE_URL, {
    onWaiting: options?.onAuthWait,
    onLoggedIn: options?.onAuthDone,
  });

  await page.getByRole("textbox", { name: "Correlation ID" }).fill(correlationId);
  await page.getByRole("button", { name: "Search" }).click();
  await sleep(3000);

  return page.evaluate(() => {
    const rows = document.querySelectorAll("tr, [role='row']");
    const found = {
      SendBoundQuoteToDrive: false,
      SendPaymentRequestToInsurCloud: false,
      SendPaymentToDrive: false,
    };
    for (const row of rows) {
      const text = row.textContent || "";
      if (text.includes("Failed")) {
        if (text.includes("SendBoundQuoteToDrive")) found.SendBoundQuoteToDrive = true;
        if (text.includes("SendPaymentRequestToInsurCloud")) found.SendPaymentRequestToInsurCloud = true;
        if (text.includes("SendPaymentToDrive")) found.SendPaymentToDrive = true;
      }
    }
    return found;
  });
}

/**
 * Poll the ACL Command Queue until a specific command shows "Completed".
 */
export async function pollAclCompletion(
  page: Page,
  commandName: string,
  options?: {
    timeoutMs?: number;
    intervalMs?: number;
    onPoll?: (elapsed: number) => void;
    /** For SendPaymentToDrive, exclude SendFailedPaymentToDrive */
    excludePattern?: string;
  }
): Promise<boolean> {
  const timeout = options?.timeoutMs ?? 180000;
  const interval = options?.intervalMs ?? 5000;
  const exclude = options?.excludePattern;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    await page.getByRole("button", { name: "Search" }).click();
    await sleep(3000);

    const completed = await page.evaluate(
      ([cmd, excl]) => {
        const rows = document.querySelectorAll("tr, [role='row']");
        for (const row of rows) {
          const text = row.textContent || "";
          if (text.includes(cmd!) && text.includes("Completed")) {
            if (excl && text.includes(excl)) continue;
            return true;
          }
        }
        return false;
      },
      [commandName, exclude ?? null] as const
    );

    const elapsed = Math.round((Date.now() - start) / 1000);
    options?.onPoll?.(elapsed);

    if (completed) return true;
    await sleep(interval);
  }

  return false;
}

// ---------------------------------------------------------------------------
// Data Explorer
// ---------------------------------------------------------------------------

/**
 * Search a stream in the Data Explorer.
 */
export async function searchStream(
  page: Page,
  streamType: string,
  streamId: string,
  options?: { onAuthWait?: () => void; onAuthDone?: () => void }
): Promise<void> {
  await navigateWithAuth(page, DATA_EXPLORER_URL, {
    onWaiting: options?.onAuthWait,
    onLoggedIn: options?.onAuthDone,
  });

  await page.getByRole("combobox", { name: "Service Context" }).selectOption("Registration Service");
  await sleep(500);
  await page.getByRole("textbox", { name: "Stream Type" }).fill(streamType);
  await page.getByRole("textbox", { name: "Stream Id" }).fill(streamId);
  await page.getByRole("button", { name: "Get Data" }).click();
  await sleep(3000);
}

/**
 * Expand an event row in Data Explorer and extract text content.
 */
export async function expandEventRow(
  page: Page,
  eventName: string
): Promise<string> {
  const row = page.locator("tr").filter({ hasText: eventName }).first();
  await row.getByRole("switch").click();
  await sleep(2000);
  return (await page.locator("body").textContent()) ?? "";
}

/**
 * Find quoteId from a registration-transaction stream.
 */
export async function findQuoteId(
  page: Page,
  registrationTransactionId: string,
  options?: { onAuthWait?: () => void; onAuthDone?: () => void }
): Promise<string> {
  await searchStream(page, "poc46/registration-transaction", registrationTransactionId, options);

  const bodyText = await expandEventRow(page, "registration-transaction-quotes-set");
  const match = bodyText.match(/"quoteIds":\s*\[\s*"([a-f0-9-]+)"/);

  if (!match) {
    throw new Error("Could not extract quoteId from registration-transaction-quotes-set event");
  }

  return match[1];
}

/**
 * Append a correction event to a quote stream and trigger manual bind.
 */
export async function appendCorrectionAndBind(
  page: Page,
  quoteId: string,
  jsonPayload: string
): Promise<void> {
  // Search the quote stream
  await page.getByRole("textbox", { name: "Stream Type" }).fill("poc46/quote");
  await page.getByRole("textbox", { name: "Stream Id" }).fill(quoteId);
  await page.getByRole("button", { name: "Get Data" }).click();
  await sleep(3000);

  // Open the append dialog
  await page.getByRole("button", { name: "Append Correction Event To Stream" }).click();
  await sleep(1000);

  // Fill the payload
  const dialog = page.getByRole("dialog");
  const textarea = dialog.locator("textarea");
  const count = await textarea.count();
  if (count > 0) {
    await textarea.fill(jsonPayload);
  } else {
    await dialog.getByRole("textbox").fill(jsonPayload);
  }
  await sleep(500);

  // Submit
  await dialog.getByRole("button", { name: "Submit" }).click();
  await sleep(3000);

  // Trigger manual bind
  await page.getByRole("button", { name: "Manually Bind Quote" }).click();
  await sleep(1500);
}

// ---------------------------------------------------------------------------
// Payment Repair
// ---------------------------------------------------------------------------

/**
 * Submit a payment repair request for a job number.
 */
export async function submitPaymentRepair(
  page: Page,
  jobNumber: string,
  options?: { onAuthWait?: () => void; onAuthDone?: () => void }
): Promise<void> {
  await navigateWithAuth(page, PAYMENT_REPAIR_URL, {
    onWaiting: options?.onAuthWait,
    onLoggedIn: options?.onAuthDone,
  });

  await page.getByRole("textbox", { name: "Job Numbers" }).fill(jobNumber);
  await sleep(500);
  await page.getByRole("button", { name: "Submit Repair Request" }).click();
  await sleep(2000);
}

// ---------------------------------------------------------------------------
// Plate Lookup (Data Explorer)
// ---------------------------------------------------------------------------

export interface PlateLookupResult {
  plateNumber: string | null;
  plateGuid: string | null;
  method: "baseline" | "plate-attribute" | "manual" | null;
}

/**
 * Look up a plate number from a registration transaction.
 * Tries baseline-registration-attributes-set first, then registration-plate-attribute-set.
 */
export async function lookupPlate(
  page: Page,
  registrationTransactionId: string,
  options?: { onAuthWait?: () => void; onAuthDone?: () => void }
): Promise<PlateLookupResult> {
  await searchStream(page, "poc46/registration-transaction", registrationTransactionId, options);

  // Strategy A: baseline-registration-attributes-set
  const baselineRow = page.locator("tr").filter({ hasText: "baseline-registration-attributes-set" }).first();
  const baselineCount = await baselineRow.count();

  if (baselineCount > 0) {
    await baselineRow.getByRole("switch").click();
    await sleep(2000);

    const bodyText = (await page.locator("body").textContent()) ?? "";
    const plateGuidMatch =
      bodyText.match(/"[Rr]egistration[Pp]late"\s*:\s*"([a-f0-9-]{36})"/i) ||
      bodyText.match(/RegistrationPlate[^a-f0-9]*([a-f0-9-]{36})/i);

    if (plateGuidMatch) {
      const plateGuid = plateGuidMatch[1];

      // Look up actual plate number from plate stream
      await page.getByRole("textbox", { name: "Stream Type" }).fill("poc46/registration-plate");
      await page.getByRole("textbox", { name: "Stream Id" }).fill(plateGuid);
      await page.getByRole("button", { name: "Get Data" }).click();
      await sleep(3000);

      const plateBodyText = (await page.locator("body").textContent()) ?? "";
      const plateMatch =
        plateBodyText.match(/"[Pp]late[Nn]umber"\s*:\s*"([^"]+)"/i) ||
        plateBodyText.match(/"plateSearchValue"\s*:\s*"([^"]+)"/i) ||
        plateBodyText.match(/PlateNumber[^A-Z0-9]*([A-Z0-9]{2,10})/);

      if (plateMatch) {
        return { plateNumber: plateMatch[1], plateGuid, method: "baseline" };
      }
    }
  }

  // Strategy B: registration-plate-attribute-set
  if (baselineCount > 0) {
    // Re-search to reset view
    await searchStream(page, "poc46/registration-transaction", registrationTransactionId);
  }

  const plateAttrRow = page.locator("tr").filter({ hasText: "registration-plate-attribute-set" }).first();
  const plateAttrCount = await plateAttrRow.count();

  if (plateAttrCount > 0) {
    await plateAttrRow.getByRole("switch").click();
    await sleep(2000);

    const attrBodyText = (await page.locator("body").textContent()) ?? "";
    const searchValueMatch =
      attrBodyText.match(/"plateSearchValue"\s*:\s*"([^"]+)"/i) ||
      attrBodyText.match(/plateSearchValue[^A-Z0-9]*([A-Z0-9]{2,10})/i);

    let plateGuid: string | null = null;
    const guidMatch =
      attrBodyText.match(/"registrationPlateId"\s*:\s*"([a-f0-9-]{36})"/i);
    if (guidMatch) plateGuid = guidMatch[1];

    if (searchValueMatch) {
      return { plateNumber: searchValueMatch[1], plateGuid, method: "plate-attribute" };
    }
  }

  return { plateNumber: null, plateGuid: null, method: null };
}
