/**
 * ServiceNow Skill.
 * 
 * Generic ServiceNow browser automation - works with any ServiceNow instance.
 * Instance-specific config (URLs, assignment groups) injected via skill config.
 */

import type { Browser, BrowserContext, Page } from "playwright";
import type { SkillManifest, SkillProvider, SkillConfig, SkillFactory } from "../../src/skills/types";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Shadow DOM iframe finders (evaluated in browser context)
// ---------------------------------------------------------------------------

const FIND_INCIDENT_IFRAME = `
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

const FIND_LIST_IFRAME = `
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

export interface TicketSummary {
  incNumber: string;
  sysId: string;
  shortDesc: string;
  assignmentGroup?: string;
}

export interface TicketDetail {
  incNumber: string;
  sysId: string;
  shortDesc: string;
  description: string;
  /** Arbitrary extracted fields from ticket description */
  extracted: Record<string, string | null>;
  attachmentSysId: string | null;
  attachmentName: string | null;
}

export interface ServiceNowSession {
  context: BrowserContext;
  page: Page;
}

// ---------------------------------------------------------------------------
// Extraction rules (configurable per-deployment)
// ---------------------------------------------------------------------------

export interface ExtractionRule {
  name: string;
  pattern: RegExp;
  group?: number;
}

const DEFAULT_EXTRACTION_RULES: ExtractionRule[] = [];

// ---------------------------------------------------------------------------
// Skill Implementation
// ---------------------------------------------------------------------------

class ServiceNowSkill implements SkillProvider {
  readonly manifest: SkillManifest;
  private baseUrl = "";
  private listQuery = "";
  private extractionRules: ExtractionRule[] = DEFAULT_EXTRACTION_RULES;
  private browser: Browser | null = null;
  private session: ServiceNowSession | null = null;

  constructor(manifest: SkillManifest) {
    this.manifest = manifest;
  }

  async initialize(config: SkillConfig): Promise<void> {
    this.baseUrl = config.baseUrl as string;
    this.listQuery = (config.listQuery as string) ?? "";
    if (config.extractionRules) {
      this.extractionRules = config.extractionRules as ExtractionRule[];
    }
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
    const caps: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      "ticket-list": (browser: unknown, opts?: unknown) =>
        this.listTickets(browser as Browser, opts as { onWaiting?: () => void; onLoggedIn?: () => void }),
      "ticket-read": (ticket: unknown) =>
        this.readTicketDetail(ticket as TicketSummary),
      "ticket-comment": (ticket: unknown, message: unknown, opts?: unknown) =>
        this.postComment(
          ticket as { sysId: string; incNumber: string },
          message as string,
          opts as { field?: "comments" | "work_notes" }
        ),
      "attachment-download": (ticket: unknown) =>
        this.downloadAttachment(ticket as TicketDetail),
    };
    return caps[name] ?? null;
  }

  listCapabilities(): string[] {
    return ["ticket-list", "ticket-read", "ticket-comment", "attachment-download"];
  }

  async dispose(): Promise<void> {
    this.session = null;
    this.browser = null;
  }

  // ── Internal methods ────────────────────────────────────────────

  private getListUrl(): string {
    if (this.listQuery) {
      return `${this.baseUrl}/now/nav/ui/classic/params/target/incident_list.do` +
        `%3F${this.listQuery}%26sysparm_view%3DDefault%26sysparm_view_forced%3Dtrue`;
    }
    return `${this.baseUrl}/now/nav/ui/classic/params/target/incident_list.do`;
  }

  private getTicketUrl(ticket: { sysId?: string; incNumber?: string }): string {
    if (ticket.sysId) {
      return `${this.baseUrl}/now/nav/ui/classic/params/target/incident.do` +
        `%3Fsys_id%3D${ticket.sysId}%26sysparm_view%3DDefault`;
    }
    return `${this.baseUrl}/now/nav/ui/classic/params/target/incident.do` +
      `%3Fsysparm_query%3Dnumber%3D${ticket.incNumber}%26sysparm_view%3DDefault`;
  }

  private async ensureSession(
    browser: Browser,
    opts?: { onWaiting?: () => void; onLoggedIn?: () => void }
  ): Promise<ServiceNowSession> {
    if (this.session) return this.session;

    this.browser = browser;
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(this.baseUrl, { waitUntil: "domcontentloaded" });
    await sleep(3000);

    // Wait for SSO login
    const maxWait = 300000;
    const start = Date.now();
    let notified = false;

    while (Date.now() - start < maxWait) {
      const url = page.url();
      const isLoggedIn = url.includes("service-now.com") &&
        !url.includes("login") && !url.includes("auth") &&
        !url.includes("adfs") && !url.includes("microsoftonline");

      if (isLoggedIn) {
        opts?.onLoggedIn?.();
        break;
      }

      if (!notified) {
        opts?.onWaiting?.();
        notified = true;
      }
      await sleep(5000);
    }

    this.session = { context, page };
    return this.session;
  }

  async listTickets(
    browser: Browser,
    opts?: { onWaiting?: () => void; onLoggedIn?: () => void }
  ): Promise<TicketSummary[]> {
    const session = await this.ensureSession(browser, opts);

    await session.page.goto(this.getListUrl(), { waitUntil: "domcontentloaded" });
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
        const cells = [...row.querySelectorAll('td')];
        const shortDesc = cells.length > 5 ? cells[cells.length - 1]?.textContent?.trim() : '';
        return { incNumber, sysId, shortDesc };
      }).filter(t => t.incNumber);
    })()`) as TicketSummary[] | { error: string };

    if (!Array.isArray(rawList)) {
      throw new Error(`Failed to scrape ticket list: ${(rawList as { error: string }).error}`);
    }

    return rawList;
  }

  async readTicketDetail(ticket: TicketSummary): Promise<TicketDetail> {
    if (!this.session) throw new Error("No active session. Call listTickets first.");

    await this.session.page.goto(this.getTicketUrl(ticket), { waitUntil: "domcontentloaded" });
    await sleep(5000);

    const raw = await this.session.page.evaluate(`(() => {
      ${FIND_INCIDENT_IFRAME}
      const iframe = findSnowIframe(document);
      if (!iframe || !iframe.contentDocument) return { error: 'no iframe' };
      const doc = iframe.contentDocument;

      const desc = (doc.querySelector('textarea[id*="description"]') || {}).value || '';
      const num = (doc.querySelector('input[id*="number"]') || {}).value || '';

      const attLinks = [...doc.querySelectorAll('a')].filter(a =>
        a.href && a.href.includes('sys_attachment')
      );
      let att = null;
      if (attLinks.length > 0) {
        const a = attLinks[0];
        const m = a.href.match(/sys_id=([a-f0-9]+)/);
        att = { name: a.textContent.trim(), sysId: m ? m[1] : null };
      }

      return { num, desc: desc.substring(0, 5000), att };
    })()`) as {
      error?: string;
      num: string;
      desc: string;
      att: { name: string; sysId: string | null } | null;
    };

    if (raw.error) throw new Error(`Cannot read ticket ${ticket.incNumber}: ${raw.error}`);

    // Apply extraction rules
    const extracted: Record<string, string | null> = {};
    for (const rule of this.extractionRules) {
      const match = raw.desc.match(rule.pattern);
      extracted[rule.name] = match ? (match[rule.group ?? 1] ?? match[0]) : null;
    }

    return {
      incNumber: raw.num || ticket.incNumber,
      sysId: ticket.sysId,
      shortDesc: ticket.shortDesc,
      description: raw.desc,
      extracted,
      attachmentSysId: raw.att?.sysId ?? null,
      attachmentName: raw.att?.name ?? null,
    };
  }

  async downloadAttachment(ticket: TicketDetail): Promise<string | null> {
    if (!this.session || !ticket.attachmentSysId) return null;

    await this.session.page.goto(this.getTicketUrl(ticket), { waitUntil: "domcontentloaded" });
    await sleep(5000);

    const base64 = await this.session.page.evaluate(`(() => {
      ${FIND_INCIDENT_IFRAME}
      const iframe = findSnowIframe(document);
      if (!iframe) return null;
      return new Promise(resolve => {
        iframe.contentWindow.fetch('${this.baseUrl}/sys_attachment.do?sys_id=${ticket.attachmentSysId}')
          .then(r => r.text())
          .then(text => resolve(btoa(unescape(encodeURIComponent(text)))))
          .catch(() => resolve(null));
      });
    })()`) as string | null;

    if (!base64) return null;
    return Buffer.from(base64, "base64").toString("utf-8");
  }

  async postComment(
    ticket: { sysId: string; incNumber: string },
    message: string,
    options?: { field?: "comments" | "work_notes" }
  ): Promise<string> {
    if (!this.session) throw new Error("No active session");
    const field = options?.field ?? "comments";

    const page = await this.session.context.newPage();
    await page.goto(this.getTicketUrl(ticket), { waitUntil: "domcontentloaded" });
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
    return result;
  }
}

// ---------------------------------------------------------------------------
// Factory (default export)
// ---------------------------------------------------------------------------

const createSkill: SkillFactory = (manifest) => new ServiceNowSkill(manifest);
export default createSkill;
export { createSkill, ServiceNowSkill };
