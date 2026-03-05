/**
 * ServiceNow browser scraper.
 * 
 * Handles the shadow DOM iframe traversal that ServiceNow's modern UI requires.
 * Extracts ticket data, downloads attachments, and posts comments via g_form.
 */

import type { Browser, BrowserContext, Page } from "playwright";
import { waitForSSOLogin } from "./auth";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Shadow DOM iframe finders (evaluated in browser context)
// ---------------------------------------------------------------------------

export const FIND_INCIDENT_IFRAME = `
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

export const FIND_LIST_IFRAME = `
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
// Types
// ---------------------------------------------------------------------------

export interface ScrapedTicketSummary {
  incNumber: string;
  sysId: string;
  shortDesc: string;
  isDriveAlert: boolean;
}

export interface ScrapedTicketDetail {
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

export interface ServiceNowSession {
  context: BrowserContext;
  page: Page;
}

// ---------------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------------

export const SERVICENOW_BASE = "https://sgico.service-now.com";

// Unassigned DRIVE Alerts tickets
export const DRIVE_ALERTS_LIST_URL =
  `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident_list.do` +
  `%3Fsysparm_query%3Dassigned_toISEMPTY%255EstateIN1%252C2%252C3` +
  `%255Eassignment_group%253Dc0b068734779c25025adb5f8536d43aa` +
  `%255EORassignment_group%253D40b024f787fd42507ba77597cebb3551` +
  `%255EORassignment_group%253D5cb024f787fd42507ba77597cebb3582` +
  `%255EORassignment_group%253Ddcb024f787fd42507ba77597cebb3569` +
  `%255EORassignment_group%253D0cb024f787fd42507ba77597cebb352b` +
  `%255EORassignment_group%253D0cb068734779c25025adb5f8536d439d` +
  `%255EORassignment_group%253D8975e4f5dbd99210c8a46f8b139619eb` +
  `%255EORassignment_group%253D88b024f787fd42507ba77597cebb3544` +
  `%255EORassignment_group%253D18b024f787fd42507ba77597cebb355d` +
  `%255Eassignment_group%253D5cb024f787fd42507ba77597cebb3582` +
  `%26sysparm_view%3DDefault%26sysparm_view_forced%3Dtrue`;

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

/**
 * Open ServiceNow in an incognito context, handle SSO login.
 * Returns the session for reuse across operations.
 */
export async function openServiceNow(
  browser: Browser,
  options?: {
    onWaiting?: () => void;
    onLoggedIn?: () => void;
  }
): Promise<ServiceNowSession> {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(SERVICENOW_BASE, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  await waitForSSOLogin(page, {
    expectedDomain: "service-now.com",
    loginIndicators: ["login", "auth", "adfs", "microsoftonline"],
    onWaiting: options?.onWaiting ?? (() => console.log("  ⚠️  Please log into ServiceNow in the browser tab.")),
    onLoggedIn: options?.onLoggedIn ?? (() => console.log("  ✓ ServiceNow login detected!")),
    pollInterval: 5000,
  });

  return { context, page };
}

// ---------------------------------------------------------------------------
// List tickets
// ---------------------------------------------------------------------------

/**
 * Navigate to the incident list and scrape ticket summaries.
 * Returns basic info (INC number, sys_id, short desc).
 */
export async function listTickets(
  session: ServiceNowSession,
  listUrl: string = DRIVE_ALERTS_LIST_URL
): Promise<ScrapedTicketSummary[]> {
  await session.page.goto(listUrl, { waitUntil: "domcontentloaded" });
  await sleep(7000);

  const rawList = await session.page.evaluate(`(() => {
    ${FIND_LIST_IFRAME}
    const iframe = findSnowListIframe(document);
    if (!iframe || !iframe.contentDocument) return { error: 'no list iframe found' };
    const doc = iframe.contentDocument;
    const rows = [...doc.querySelectorAll('tr.list_row, tr[record]')];
    return rows.map(row => {
      const links = [...row.querySelectorAll('a')];
      const incLink = links.find(a => a.textContent.trim().match(/^INC\\d+$/));
      const incNumber = incLink ? incLink.textContent.trim() : '';
      const sysId = row.getAttribute('sys_id') || '';
      const allText = row.textContent || '';
      const isDriveAlert = allText.includes('DRIVE Alerts');
      const cells = [...row.querySelectorAll('td')];
      const shortDesc = cells.length > 5 ? cells[cells.length - 1]?.textContent?.trim() : '';
      return { incNumber, sysId, isDriveAlert, shortDesc };
    }).filter(t => t.incNumber);
  })()`) as ScrapedTicketSummary[] | { error: string };

  if (!Array.isArray(rawList)) {
    throw new Error(`Failed to scrape ticket list: ${(rawList as { error: string }).error}`);
  }

  return rawList;
}

// ---------------------------------------------------------------------------
// Read ticket detail
// ---------------------------------------------------------------------------

/**
 * Navigate to a specific ticket and extract detailed information.
 */
export async function readTicketDetail(
  session: ServiceNowSession,
  ticket: ScrapedTicketSummary
): Promise<ScrapedTicketDetail> {
  const ticketUrl = ticket.sysId
    ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`
    : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;

  await session.page.goto(ticketUrl, { waitUntil: "domcontentloaded" });
  await sleep(5000);

  const raw = await session.page.evaluate(`(() => {
    ${FIND_INCIDENT_IFRAME}
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

    return { num, desc: desc.substring(0, 3000), hasGwError, alreadyFixed, oldJob, att };
  })()`) as {
    error?: string;
    num: string;
    desc: string;
    hasGwError: boolean;
    alreadyFixed: boolean;
    oldJob: string | null;
    att: { name: string; sysId: string | null } | null;
  };

  if (raw.error) {
    throw new Error(`Cannot read ticket ${ticket.incNumber}: ${raw.error}`);
  }

  return {
    incNumber: raw.num || ticket.incNumber,
    sysId: ticket.sysId,
    shortDesc: ticket.shortDesc,
    description: raw.desc,
    hasGwError: raw.hasGwError,
    oldJobNumber: raw.oldJob,
    attachmentSysId: raw.att?.sysId || null,
    attachmentName: raw.att?.name || null,
    alreadyFixed: raw.alreadyFixed,
  };
}

// ---------------------------------------------------------------------------
// Download attachment
// ---------------------------------------------------------------------------

/**
 * Download a JSON attachment from a ServiceNow ticket using
 * fetch() inside the iframe context (bypasses CORS).
 */
export async function downloadAttachment(
  session: ServiceNowSession,
  ticket: ScrapedTicketDetail,
): Promise<string | null> {
  if (!ticket.attachmentSysId) return null;

  // Ensure we're on the ticket page
  const ticketUrl = ticket.sysId
    ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`
    : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;

  await session.page.goto(ticketUrl, { waitUntil: "domcontentloaded" });
  await sleep(5000);

  const base64 = await session.page.evaluate(`(() => {
    ${FIND_INCIDENT_IFRAME}
    const iframe = findSnowIframe(document);
    if (!iframe) return null;
    return new Promise(resolve => {
      iframe.contentWindow.fetch('${SERVICENOW_BASE}/sys_attachment.do?sys_id=${ticket.attachmentSysId}')
        .then(r => r.text())
        .then(text => resolve(btoa(unescape(encodeURIComponent(text)))))
        .catch(() => resolve(null));
    });
  })()`) as string | null;

  if (!base64) return null;

  return Buffer.from(base64, "base64").toString("utf-8");
}

// ---------------------------------------------------------------------------
// Post comment
// ---------------------------------------------------------------------------

/**
 * Post an Additional Comment (customer visible) on a ServiceNow ticket.
 * Uses g_form.setValue + gsftSubmit inside the shadow DOM iframe.
 */
export async function postComment(
  session: ServiceNowSession,
  ticket: { sysId: string; incNumber: string },
  message: string,
  options?: { field?: "comments" | "work_notes" }
): Promise<string> {
  const field = options?.field ?? "comments";

  const ticketUrl = ticket.sysId
    ? `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`
    : `${SERVICENOW_BASE}/now/nav/ui/classic/params/target/incident.do%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;

  const page = await session.context.newPage();
  await page.goto(ticketUrl, { waitUntil: "domcontentloaded" });
  await sleep(6000);

  const result = await page.evaluate(`(() => {
    ${FIND_INCIDENT_IFRAME}
    const iframe = findSnowIframe(document);
    if (!iframe || !iframe.contentDocument) return 'error: no iframe';
    const win = iframe.contentWindow;
    if (!win.g_form) return 'error: no g_form';

    win.g_form.setValue('${field}', ${JSON.stringify(message)});

    if (win.gsftSubmit) {
      win.gsftSubmit(null, win.g_form.getFormElement(), 'sysverb_update');
      return 'posted via gsftSubmit';
    } else {
      win.g_form.submit();
      return 'posted via g_form.submit';
    }
  })()`) as string;

  await sleep(4000);
  // Leave page open for inspection
  return result;
}
