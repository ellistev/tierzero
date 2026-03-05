/**
 * Browser automation tools for TierZero.
 * 
 * Connects to Chrome via CDP (same as automate-repairs.js),
 * handles ServiceNow shadow DOM, DRIVE admin pages, and App Insights queries.
 */

import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";

const CDP_URL = "http://localhost:18792";
const CHROME_USER_DATA = "C:\\Users\\steve\\.openclaw\\browser\\chrome\\user-data";

// ServiceNow
const SERVICENOW_BASE = "https://sgico.service-now.com";
const SERVICENOW_LIST_URL = `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident_list.do%3Fsysparm_query%3Dassigned_toISEMPTY%255EstateIN1%252C2%252C3%255Eassignment_group%253Dc0b068734779c25025adb5f8536d43aa%255EORassignment_group%253D40b024f787fd42507ba77597cebb3551%255EORassignment_group%253D5cb024f787fd42507ba77597cebb3582%255EORassignment_group%253Ddcb024f787fd42507ba77597cebb3569%255EORassignment_group%253D0cb024f787fd42507ba77597cebb352b%255EORassignment_group%253D0cb068734779c25025adb5f8536d439d%255EORassignment_group%253D8975e4f5dbd99210c8a46f8b139619eb%255EORassignment_group%253D88b024f787fd42507ba77597cebb3544%255EORassignment_group%253D18b024f787fd42507ba77597cebb355d%255Eassignment_group%253D5cb024f787fd42507ba77597cebb3582%26sysparm_view%3DDefault%26sysparm_view_forced%3Dtrue`;

// DRIVE Admin
const ACL_QUEUE_URL = "https://drive.sgicloud.ca/registration-admin?tab=acl-command-queue";
const DATA_EXPLORER_URL = "https://drive.sgicloud.ca/registration-admin?tab=data-explorer";
const PAYMENT_REPAIR_URL = "https://drive.sgicloud.ca/registration-admin?tab=payment-repair";

// App Insights
const APP_INSIGHTS_APP_ID = "3c39e0b5-8be0-444f-9563-1fbbcb3a447f";

const KUSTO_QUERY_TEMPLATE = `let targetJobNumber = "TARGET_JOB";
customEvents
| where cloud_RoleName == "AF.VehicleRegistration.ACL.Host-prd"
| where timestamp >= datetime(2025-11-01 06:00:00.00)
| where name == "RegistrationTransactionIssuedIntegrationEventV3"
| extend EventData = todynamic(tostring(customDimensions.EventData))
| mv-expand quote = EventData.quotes
| extend QuoteNumber = tostring(quote.guidewireJobReference.jobNumber)
| where QuoteNumber == targetJobNumber
| project
    RequestTime              = timestamp,
    QuoteNumber,
    RegistrationId           = tostring(EventData.registrationId),
    RegistrationTransactionId= tostring(EventData.registrationTransactionId),
    TransactionType          = tostring(EventData.transactionType),
    EventData
| order by RequestTime desc`;

// Shadow DOM helpers (same as automate-repairs.js)
const SNOW_FIND_IFRAME_FN = `
function findSnowIframe(root) {
  const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
  for (const f of iframes) {
    if (f.src && f.src.includes('incident.do')) return f;
  }
  const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of els) {
    if (el.shadowRoot) {
      const r = findSnowIframe(el.shadowRoot);
      if (r) return r;
    }
  }
  return null;
}`;

const SNOW_FIND_LIST_IFRAME_FN = `
function findSnowListIframe(root) {
  const iframes = root.querySelectorAll ? root.querySelectorAll('iframe') : [];
  for (const f of iframes) {
    if (f.src && f.src.includes('incident_list.do')) return f;
  }
  const els = root.querySelectorAll ? root.querySelectorAll('*') : [];
  for (const el of els) {
    if (el.shadowRoot) {
      const r = findSnowListIframe(el.shadowRoot);
      if (r) return r;
    }
  }
  return null;
}`;

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export interface WorkflowLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  step: (step: string, detail: string) => void;
}

function defaultLogger(): WorkflowLogger {
  return {
    log: (msg) => console.log(`  ${msg}`),
    warn: (msg) => console.log(`  ⚠️  ${msg}`),
    error: (msg) => console.error(`  ❌ ${msg}`),
    step: (step, detail) => console.log(`\n📋 ${step}: ${detail}`),
  };
}

// ---------------------------------------------------------------------------
// Browser connection
// ---------------------------------------------------------------------------

export async function connectBrowser(): Promise<Browser> {
  try {
    const browser = await chromium.connectOverCDP(CDP_URL);
    console.log("✓ Connected to Chrome (CDP port 18792)");
    return browser;
  } catch {
    console.log("⚠️  Chrome not on CDP port 18792, launching...");
    const { execSync: ex } = await import("child_process");
    ex(
      `start "" "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=18792 --remote-debugging-address=127.0.0.1 "--user-data-dir=${CHROME_USER_DATA}"`,
      { shell: "cmd.exe" }
    );
    await sleep(5000);
    const browser = await chromium.connectOverCDP(CDP_URL);
    console.log("✓ Connected to freshly launched Chrome");
    return browser;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// DRIVE admin helpers
// ---------------------------------------------------------------------------

async function navigateWithModal(page: Page, url: string, logger: WorkflowLogger): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // Check for SSO login redirect
  const currentUrl = page.url();
  if (
    !currentUrl.includes("drive.sgicloud.ca") ||
    currentUrl.includes("login") ||
    currentUrl.includes("auth") ||
    currentUrl.includes("adfs") ||
    currentUrl.includes("microsoftonline")
  ) {
    logger.warn("Not logged in to drive.sgicloud.ca. Please log in via the browser tab.");
    logger.log("⏳ Waiting for login (checking every 5s)...");
    while (true) {
      await sleep(5000);
      try {
        const url2 = page.url();
        if (
          url2.includes("drive.sgicloud.ca") &&
          !url2.includes("login") &&
          !url2.includes("auth") &&
          !url2.includes("adfs") &&
          !url2.includes("microsoftonline")
        ) {
          logger.log("✓ Login detected!");
          break;
        }
      } catch {
        // Page navigated during SSO -- expected
      }
    }
    await sleep(2000);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(3000);
  }

  // Handle org modal
  const headOfficeBtn = page.locator("button").filter({ hasText: "SGI Head Office" }).first();
  try {
    await headOfficeBtn.waitFor({ state: "visible", timeout: 5000 });
    logger.log("→ Org modal detected, dismissing...");
    await headOfficeBtn.click();
    await sleep(1500);
    const confirmBtn = page
      .locator("button")
      .filter({ hasText: /Change Organization|Confirm Organization/i })
      .first();
    await confirmBtn.click();
    await sleep(2000);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    logger.log("✓ Modal handled");
  } catch {
    // No modal
  }
}

// ---------------------------------------------------------------------------
// App Insights Query
// ---------------------------------------------------------------------------

export interface KqlResult {
  registrationTransactionId: string;
  quoteNumber: string;
  time: string;
  raw: Record<string, unknown>;
}

export async function queryAppInsights(
  targetJobNumber: string,
  logger: WorkflowLogger = defaultLogger()
): Promise<KqlResult> {
  logger.step("App Insights", `Running KQL query for job ${targetJobNumber}`);

  const query = KUSTO_QUERY_TEMPLATE.replace("TARGET_JOB", targetJobNumber);

  execSync('az account set --subscription "SGI-INS-PRD"', { stdio: "pipe" });

  const tmpQueryFile = path.join(process.cwd(), "_tmp_query.kql");
  fs.writeFileSync(tmpQueryFile, query, "utf-8");

  try {
    const result = execSync(
      `az monitor app-insights query --app "${APP_INSIGHTS_APP_ID}" --analytics-query @${tmpQueryFile} --offset 90d --output json`,
      { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "cmd.exe" }
    );

    try { fs.unlinkSync(tmpQueryFile); } catch {}

    const data = JSON.parse(result);
    if (!data.tables || data.tables.length === 0 || data.tables[0].rows.length === 0) {
      throw new Error(`No results found in App Insights for job number ${targetJobNumber}`);
    }

    const table = data.tables[0];
    const columns: string[] = table.columns.map((c: { name: string }) => c.name);
    const row = table.rows[0];
    const resultObj: Record<string, unknown> = {};
    columns.forEach((col, idx) => { resultObj[col] = row[idx]; });

    const kqlResult: KqlResult = {
      registrationTransactionId: resultObj.RegistrationTransactionId as string,
      quoteNumber: resultObj.QuoteNumber as string,
      time: resultObj.RequestTime as string,
      raw: resultObj,
    };

    logger.log(`✓ RegistrationTransactionId: ${kqlResult.registrationTransactionId}`);
    logger.log(`✓ QuoteNumber: ${kqlResult.quoteNumber}`);
    logger.log(`✓ Time: ${kqlResult.time}`);

    return kqlResult;
  } catch (error) {
    try { fs.unlinkSync(tmpQueryFile); } catch {}
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ServiceNow Browser Scraper
// ---------------------------------------------------------------------------

export interface ScrapedTicket {
  incNumber: string;
  sysId: string;
  shortDesc: string;
  description: string;
  hasGwError: boolean;
  oldJobNumber: string | null;
  attachmentSysId: string | null;
  attachmentName: string | null;
  alreadyFixed: boolean;
}

export async function scrapeServiceNowTickets(
  browser: Browser,
  logger: WorkflowLogger = defaultLogger()
): Promise<{ context: BrowserContext; page: Page; tickets: ScrapedTicket[] }> {
  logger.step("ServiceNow", "Opening ServiceNow in incognito context...");

  const snowContext = await browser.newContext();
  const snowPage = await snowContext.newPage();

  // Navigate and wait for auth
  await snowPage.goto(SERVICENOW_BASE, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  const currentUrl = snowPage.url();
  if (!currentUrl.includes("service-now.com/now")) {
    logger.warn("Not logged in. Please log into ServiceNow in the browser tab.");
    logger.log("⏳ Waiting for login (checking every 5s)...");
    while (true) {
      await sleep(5000);
      try {
        const url = snowPage.url();
        if (url.includes("service-now.com/now") || url.includes("service-now.com/nav")) {
          logger.log("✓ Login detected!");
          break;
        }
      } catch {
        // SSO redirect
      }
    }
    await sleep(2000);
  }

  // Navigate to incident list
  logger.log("📋 Navigating to incident list...");
  await snowPage.goto(SERVICENOW_LIST_URL, { waitUntil: "domcontentloaded" });
  await sleep(7000);

  // Scrape tickets via shadow DOM
  logger.step("ServiceNow", "Scanning for DRIVE Alerts tickets via shadow DOM...");

  const ticketList = await snowPage.evaluate(`(() => {
    ${SNOW_FIND_LIST_IFRAME_FN}
    const iframe = findSnowListIframe(document);
    if (!iframe || !iframe.contentDocument) return { error: 'no list iframe' };
    const doc = iframe.contentDocument;
    const rows = [...doc.querySelectorAll('tr.list_row, tr[record]')];
    return rows.map(row => {
      const cells = [...row.querySelectorAll('td')];
      const links = [...row.querySelectorAll('a')];
      const incLink = links.find(a => a.textContent.trim().match(/^INC\\d+$/));
      const incNumber = incLink ? incLink.textContent.trim() : '';
      const sysId = row.getAttribute('sys_id') || '';
      const allText = row.textContent || '';
      const isDriveAlert = allText.includes('DRIVE Alerts');
      const shortDesc = cells.length > 5 ? cells[cells.length - 1]?.textContent?.trim() : '';
      return { incNumber, sysId, isDriveAlert, shortDesc };
    }).filter(t => t.incNumber && t.isDriveAlert);
  })()`);

  const rawTickets = Array.isArray(ticketList) ? ticketList : [];
  logger.log(`Found ${rawTickets.length} DRIVE Alerts ticket(s)`);

  // Inspect each ticket
  const scrapedTickets: ScrapedTicket[] = [];

  for (const raw of rawTickets) {
    logger.log(`\n  Inspecting ${raw.incNumber}: ${raw.shortDesc}`);

    const ticketUrl = raw.sysId
      ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${raw.sysId}%26sysparm_view%3DDefault`
      : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${raw.incNumber}%26sysparm_view%3DDefault`;

    await snowPage.goto(ticketUrl, { waitUntil: "domcontentloaded" });
    await sleep(5000);

    const ticketData = await snowPage.evaluate(`(() => {
      ${SNOW_FIND_IFRAME_FN}
      const iframe = findSnowIframe(document);
      if (!iframe || !iframe.contentDocument) return { error: 'no iframe' };
      const doc = iframe.contentDocument;
      const desc = (doc.querySelector('textarea[id*="description"]') || {}).value || '';
      const num = (doc.querySelector('input[id*="number"]') || {}).value || '';
      const hasGwError = desc.includes('Cannot access payment info');
      const jobMatch = desc.match(/"JobNumber"\\s*:\\s*"(\\d+)"/);
      const oldJob = jobMatch ? jobMatch[1] : null;
      const bodyText = doc.body.textContent.toLowerCase();
      const alreadyFixed = bodyText.includes('requote bound') && bodyText.includes('payments sent to gwbc');
      const attLinks = [...doc.querySelectorAll('a')].filter(a =>
        a.textContent.includes('.json') && a.href.includes('sys_attachment')
      );
      let att = null;
      if (attLinks.length > 0) {
        const a = attLinks[0];
        const m = a.href.match(/sys_id=([a-f0-9]+)/);
        att = { name: a.textContent.trim(), sysId: m ? m[1] : null };
      }
      return { num, desc: desc.substring(0, 2000), hasGwError, alreadyFixed, oldJob, att };
    })()`);

    const td = ticketData as {
      error?: string; num: string; desc: string; hasGwError: boolean;
      alreadyFixed: boolean; oldJob: string | null;
      att: { name: string; sysId: string | null } | null;
    };

    if (td.error) {
      logger.warn(`Could not read ticket: ${td.error}`);
      continue;
    }

    logger.log(`  INC: ${td.num} | GW Error: ${td.hasGwError} | Old Job: ${td.oldJob || "N/A"}`);

    scrapedTickets.push({
      incNumber: td.num || raw.incNumber,
      sysId: raw.sysId,
      shortDesc: raw.shortDesc,
      description: td.desc,
      hasGwError: td.hasGwError,
      oldJobNumber: td.oldJob,
      attachmentSysId: td.att?.sysId || null,
      attachmentName: td.att?.name || null,
      alreadyFixed: td.alreadyFixed,
    });
  }

  return { context: snowContext, page: snowPage, tickets: scrapedTickets };
}

// ---------------------------------------------------------------------------
// Download JSON attachment from ServiceNow
// ---------------------------------------------------------------------------

export async function downloadSnowAttachment(
  page: Page,
  ticket: ScrapedTicket,
  outputDir: string,
  logger: WorkflowLogger = defaultLogger()
): Promise<string | null> {
  if (!ticket.attachmentSysId) {
    logger.warn("No JSON attachment found on ticket");
    return null;
  }

  logger.log(`📎 Downloading attachment: ${ticket.attachmentName}...`);

  // Navigate to the ticket page if not already there
  const ticketUrl = ticket.sysId
    ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`
    : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;

  await page.goto(ticketUrl, { waitUntil: "domcontentloaded" });
  await sleep(5000);

  const jsonBase64 = await page.evaluate(`(() => {
    ${SNOW_FIND_IFRAME_FN}
    const iframe = findSnowIframe(document);
    if (!iframe) return null;
    return new Promise(resolve => {
      iframe.contentWindow.fetch('${SERVICENOW_BASE}/sys_attachment.do?sys_id=${ticket.attachmentSysId}')
        .then(r => r.text())
        .then(text => resolve(btoa(unescape(encodeURIComponent(text)))))
        .catch(() => resolve(null));
    });
  })()`);

  if (!jsonBase64) {
    logger.warn("fetch() failed for attachment");
    return null;
  }

  const jsonContent = Buffer.from(jsonBase64 as string, "base64").toString("utf-8");
  const destPath = path.join(outputDir, `${ticket.oldJobNumber}.json`);
  fs.writeFileSync(destPath, jsonContent, "utf-8");
  logger.log(`✓ Saved as ${ticket.oldJobNumber}.json`);

  return destPath;
}

// ---------------------------------------------------------------------------
// Execute Requote Rebind Workflow
// ---------------------------------------------------------------------------

export interface RebindResult {
  success: boolean;
  oldJobNumber: string;
  newJobNumber: string;
  registrationTransactionId: string;
  quoteId: string;
  bindCompleted: boolean;
  paymentCompleted: boolean;
  error?: string;
}

export async function executeRequoteRebind(
  browser: Browser,
  ticket: ScrapedTicket,
  jsonFilePath: string,
  logger: WorkflowLogger = defaultLogger()
): Promise<RebindResult> {
  const jsonContent = fs.readFileSync(jsonFilePath, "utf-8");
  const jsonData = JSON.parse(jsonContent);
  const newJobNumber = jsonData.quoteCompositeResponse.responses[0].body.data.attributes.jobNumber;
  const oldJobNumber = ticket.oldJobNumber!;

  logger.step("Rebind", `Old Job: ${oldJobNumber} -> New Job: ${newJobNumber}`);

  const result: RebindResult = {
    success: false,
    oldJobNumber,
    newJobNumber,
    registrationTransactionId: "",
    quoteId: "",
    bindCompleted: false,
    paymentCompleted: false,
  };

  const contexts = browser.contexts();
  const context = contexts.length > 0 ? contexts[0] : await browser.newContext();
  const aclPage = await context.newPage();
  const workPage = await context.newPage();

  try {
    // Step 1: Query App Insights for RegistrationTransactionId
    const kqlResult = await queryAppInsights(oldJobNumber, logger);
    result.registrationTransactionId = kqlResult.registrationTransactionId;

    // Step 2: Open ACL Command Queue and verify failure pattern
    logger.step("Step 2", "Opening ACL Command Queue...");
    await navigateWithModal(aclPage, ACL_QUEUE_URL, logger);
    await aclPage.getByRole("textbox", { name: "Correlation ID" }).fill(result.registrationTransactionId);
    await aclPage.getByRole("button", { name: "Search" }).click();
    await sleep(3000);
    logger.log("✓ ACL queue filtered by correlation ID");

    // Check failure pattern
    const failurePattern = await aclPage.evaluate(() => {
      const rows = document.querySelectorAll("tr, [role='row']");
      const found = { SendBoundQuoteToDrive: false, SendPaymentRequestToInsurCloud: false, SendPaymentToDrive: false };
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

    const autoMode = failurePattern.SendBoundQuoteToDrive
      && failurePattern.SendPaymentRequestToInsurCloud
      && failurePattern.SendPaymentToDrive;

    if (autoMode) {
      logger.log("🟢 Auto-mode: Expected failure pattern confirmed");
    } else {
      logger.warn("🟡 Failure pattern not fully matched: " + JSON.stringify(failurePattern));
      // Still continue but log the warning
    }

    // Step 3: Find QuoteId in Data Explorer
    logger.step("Step 3", "Finding QuoteId in Data Explorer...");
    await navigateWithModal(workPage, DATA_EXPLORER_URL, logger);
    await workPage.getByRole("combobox", { name: "Service Context" }).selectOption("Registration Service");
    await sleep(500);
    await workPage.getByRole("textbox", { name: "Stream Type" }).fill("poc46/registration-transaction");
    await workPage.getByRole("textbox", { name: "Stream Id" }).fill(result.registrationTransactionId);
    await workPage.getByRole("button", { name: "Get Data" }).click();
    await sleep(3000);

    const quotesSetRow = workPage.locator("tr").filter({ hasText: "registration-transaction-quotes-set" }).first();
    await quotesSetRow.getByRole("switch").click();
    await sleep(2000);

    const bodyText = await workPage.locator("body").textContent();
    const quoteIdMatch = bodyText?.match(/"quoteIds":\s*\[\s*"([a-f0-9-]+)"/);
    if (!quoteIdMatch) {
      throw new Error("Could not extract quoteId from event data");
    }
    result.quoteId = quoteIdMatch[1];
    logger.log(`✓ QuoteId: ${result.quoteId}`);

    // Step 4: Append Correction Event
    logger.step("Step 4", "Appending correction event to quote...");
    await workPage.getByRole("textbox", { name: "Stream Type" }).fill("poc46/quote");
    await workPage.getByRole("textbox", { name: "Stream Id" }).fill(result.quoteId);
    await workPage.getByRole("button", { name: "Get Data" }).click();
    await sleep(3000);

    await workPage.getByRole("button", { name: "Append Correction Event To Stream" }).click();
    await sleep(1000);

    const dialog = workPage.getByRole("dialog");
    const textarea = dialog.locator("textarea");
    const count = await textarea.count();
    if (count > 0) {
      await textarea.fill(jsonContent);
    } else {
      await dialog.getByRole("textbox").fill(jsonContent);
    }
    await sleep(500);
    await dialog.getByRole("button", { name: "Submit" }).click();
    await sleep(3000);
    logger.log("✓ Correction event appended");

    // Step 4b: Manually Bind Quote
    await workPage.getByRole("button", { name: "Manually Bind Quote" }).click();
    await sleep(1500);
    logger.log("✓ Manual bind triggered");

    // Step 5: Poll for bind completion
    logger.step("Step 5", "Waiting for bind to complete...");
    await aclPage.bringToFront();

    const POLL_INTERVAL = 5000;
    const POLL_TIMEOUT = 180000;
    const pollStart = Date.now();

    while (Date.now() - pollStart < POLL_TIMEOUT) {
      await aclPage.getByRole("button", { name: "Search" }).click();
      await sleep(3000);

      const hasCompleted = await aclPage.evaluate(() => {
        const rows = document.querySelectorAll("tr, [role='row']");
        for (const row of rows) {
          const text = row.textContent || "";
          if (text.includes("SendBoundQuoteToDrive") && text.includes("Completed")) return true;
        }
        return false;
      });

      const elapsed = Math.round((Date.now() - pollStart) / 1000);
      if (hasCompleted) {
        logger.log(`[${elapsed}s] ✅ SendBoundQuoteToDrive: Completed`);
        result.bindCompleted = true;
        break;
      } else {
        logger.log(`[${elapsed}s] SendBoundQuoteToDrive: waiting...`);
      }
      await sleep(POLL_INTERVAL);
    }

    if (!result.bindCompleted) {
      logger.warn("Timed out waiting for bind. Manual check needed.");
    }

    // Step 6: Payment Repair
    logger.step("Step 6", "Submitting payment repair...");
    await workPage.bringToFront();
    await navigateWithModal(workPage, PAYMENT_REPAIR_URL, logger);
    await workPage.getByRole("textbox", { name: "Job Numbers" }).fill(newJobNumber);
    await sleep(500);
    await workPage.getByRole("button", { name: "Submit Repair Request" }).click();
    await sleep(2000);
    logger.log("✓ Payment repair submitted");

    // Step 7: Poll for payment completion
    logger.step("Step 7", "Waiting for payment to complete...");
    await aclPage.bringToFront();

    const payPollStart = Date.now();
    while (Date.now() - payPollStart < POLL_TIMEOUT) {
      await aclPage.getByRole("button", { name: "Search" }).click();
      await sleep(3000);

      const hasCompleted = await aclPage.evaluate(() => {
        const rows = document.querySelectorAll("tr, [role='row']");
        for (const row of rows) {
          const text = row.textContent || "";
          if (text.includes("SendPaymentToDrive") && !text.includes("SendFailedPaymentToDrive") && text.includes("Completed")) return true;
        }
        return false;
      });

      const elapsed = Math.round((Date.now() - payPollStart) / 1000);
      if (hasCompleted) {
        logger.log(`[${elapsed}s] ✅ SendPaymentToDrive: Completed`);
        result.paymentCompleted = true;
        break;
      } else {
        logger.log(`[${elapsed}s] SendPaymentToDrive: waiting...`);
      }
      await sleep(POLL_INTERVAL);
    }

    if (!result.paymentCompleted) {
      logger.warn("Timed out waiting for payment. Manual check needed.");
    }

    result.success = result.bindCompleted && result.paymentCompleted;
    return result;

  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    logger.error(`Rebind failed: ${result.error}`);
    return result;
  }
  // NOTE: Pages are intentionally left open for inspection
}

// ---------------------------------------------------------------------------
// Post work note to ServiceNow ticket
// ---------------------------------------------------------------------------

export async function postServiceNowComment(
  page: Page,
  ticket: ScrapedTicket,
  message: string,
  logger: WorkflowLogger = defaultLogger()
): Promise<boolean> {
  logger.step("ServiceNow", `Posting comment on ${ticket.incNumber}...`);

  const ticketUrl = ticket.sysId
    ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`
    : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;

  await page.goto(ticketUrl, { waitUntil: "domcontentloaded" });
  await sleep(6000);

  const postResult = await page.evaluate(`(() => {
    ${SNOW_FIND_IFRAME_FN}
    const iframe = findSnowIframe(document);
    if (!iframe || !iframe.contentDocument) return 'no iframe';
    const win = iframe.contentWindow;
    if (!win.g_form) return 'no g_form';
    win.g_form.setValue('comments', ${JSON.stringify(message)});
    if (win.gsftSubmit) {
      win.gsftSubmit(null, win.g_form.getFormElement(), 'sysverb_update');
      return 'posted via gsftSubmit';
    } else {
      win.g_form.submit();
      return 'posted via g_form.submit';
    }
  })()`);

  logger.log(`✓ ${postResult}`);
  await sleep(4000);
  return postResult !== "no iframe" && postResult !== "no g_form";
}

// ---------------------------------------------------------------------------
// Full Pipeline: Scrape -> Decide -> Execute -> Update
// ---------------------------------------------------------------------------

export interface PipelineResult {
  ticket: ScrapedTicket;
  decision: "automate" | "escalate" | "skip";
  rebindResult?: RebindResult;
  commentPosted: boolean;
  error?: string;
}

export async function runFullPipeline(
  browser: Browser,
  outputDir: string,
  logger: WorkflowLogger = defaultLogger()
): Promise<PipelineResult[]> {
  // Phase 1: Scrape ServiceNow
  const { context: snowContext, page: snowPage, tickets } = await scrapeServiceNowTickets(browser, logger);

  const results: PipelineResult[] = [];

  for (const ticket of tickets) {
    logger.log(`\n${"═".repeat(60)}`);
    logger.log(`  Processing ${ticket.incNumber}: ${ticket.shortDesc}`);
    logger.log(`${"═".repeat(60)}`);

    // Skip already fixed
    if (ticket.alreadyFixed) {
      logger.log("⏭  Already fixed");
      results.push({ ticket, decision: "skip", commentPosted: false });
      continue;
    }

    // Skip non-GW-error tickets
    if (!ticket.hasGwError) {
      logger.log("⏭  Not a requote ticket (no GW error)");
      results.push({ ticket, decision: "skip", commentPosted: false });
      continue;
    }

    // Skip if no job number
    if (!ticket.oldJobNumber) {
      logger.warn("Could not extract old job number");
      results.push({ ticket, decision: "escalate", commentPosted: false, error: "No job number in description" });
      continue;
    }

    // Download JSON attachment
    const jsonPath = await downloadSnowAttachment(snowPage, ticket, outputDir, logger);
    if (!jsonPath) {
      // Check if file already exists locally
      const localPath = path.join(outputDir, `${ticket.oldJobNumber}.json`);
      if (fs.existsSync(localPath)) {
        logger.log(`✓ ${ticket.oldJobNumber}.json already exists locally`);
      } else {
        logger.warn("No JSON attachment and no local file");
        results.push({ ticket, decision: "escalate", commentPosted: false, error: "No JSON attachment" });
        continue;
      }
    }

    const finalJsonPath = jsonPath || path.join(outputDir, `${ticket.oldJobNumber}.json`);

    // Execute rebind
    try {
      const rebindResult = await executeRequoteRebind(browser, ticket, finalJsonPath, logger);

      // Post comment to ServiceNow
      const message = rebindResult.success
        ? "requote bound, and payments sent to gwbc"
        : `Requote rebind failed for job ${ticket.oldJobNumber} - needs manual intervention`;

      const updatePage = await snowContext.newPage();
      const commentPosted = await postServiceNowComment(updatePage, ticket, message, logger);

      results.push({
        ticket,
        decision: "automate",
        rebindResult,
        commentPosted,
      });

      if (rebindResult.success) {
        // Rename the JSON file to mark as done
        const doneFile = path.join(outputDir, `d${ticket.oldJobNumber}.json`);
        try { fs.renameSync(finalJsonPath, doneFile); } catch {}
        logger.log(`✅ ${ticket.incNumber} complete!`);
      } else {
        logger.warn(`${ticket.incNumber} rebind failed`);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error(`Pipeline failed for ${ticket.incNumber}: ${msg}`);
      results.push({ ticket, decision: "automate", commentPosted: false, error: msg });
    }
  }

  // Set up clean exit handler (leave browser open)
  const gracefulExit = () => {
    console.log("\n  Script interrupted. Browser stays open.");
    process.exit(0);
  };
  process.on("SIGINT", gracefulExit);
  process.on("SIGTERM", gracefulExit);

  return results;
}
