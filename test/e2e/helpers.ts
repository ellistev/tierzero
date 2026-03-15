/**
 * Shared test utilities for E2E tests.
 */

import type { Page } from "playwright";
import type { Intent, ResolvedIntent, Strategy, StrategyContext } from "../../src/intents/types";
import type { RecordedAction, RecordedElement, RecordedSession, AnnotatedAction, AnnotatedSession } from "../../src/recorder/types";
import { createTicketApp } from "../../demo/ticket-app/server";

// ---------------------------------------------------------------------------
// App server management
// ---------------------------------------------------------------------------

export async function startApp(port?: number) {
  const app = createTicketApp(port);
  return app.start();
}

// ---------------------------------------------------------------------------
// Playwright helpers
// ---------------------------------------------------------------------------

/** Login to the ticket app */
export async function login(
  page: Page,
  baseUrl: string,
  username = "admin",
  password = "admin123"
) {
  await page.goto(`${baseUrl}/login`);
  await page.fill('[aria-label="Username"]', username);
  await page.fill('[aria-label="Password"]', password);
  await page.click('[aria-label="Sign in"]');
  await page.waitForURL(/dashboard/);
}

/** Login to v2 layout */
export async function loginV2(
  page: Page,
  baseUrl: string,
  username = "admin",
  password = "admin123"
) {
  await page.goto(`${baseUrl}/login?layout=v2`);
  await page.fill('[aria-label="Username"]', username);
  await page.fill('[aria-label="Password"]', password);
  await page.click('[aria-label="Sign in"]');
  await page.waitForURL(/dashboard/);
}

// ---------------------------------------------------------------------------
// Recording simulation helpers
// ---------------------------------------------------------------------------

/** Create a simulated recorded session from Playwright actions */
export function createRecordedSession(
  actions: RecordedAction[],
  startUrl: string
): RecordedSession {
  return {
    id: `rec-test-${Date.now()}`,
    startTime: new Date().toISOString(),
    endTime: new Date().toISOString(),
    actions,
    startUrl,
    metadata: {},
  };
}

/** Build a recorded action */
export function makeAction(
  type: RecordedAction["type"],
  opts: {
    element?: RecordedElement;
    value?: string;
    url?: string;
    pageUrl?: string;
    pageTitle?: string;
  } = {}
): RecordedAction {
  return {
    type,
    timestamp: Date.now(),
    element: opts.element,
    value: opts.value,
    url: opts.url,
    pageUrl: opts.pageUrl || "http://localhost/test",
    pageTitle: opts.pageTitle || "Test Page",
    pageStateBefore: "before",
    pageStateAfter: "after",
    stateChanges: ["state changed"],
  };
}

/** Build a recorded element */
export function makeElement(opts: {
  selector?: string;
  text?: string;
  ariaLabel?: string;
  ariaRole?: string;
  tagName?: string;
  attributes?: Record<string, string>;
}): RecordedElement {
  return {
    selector: opts.selector || "button",
    text: opts.text,
    ariaLabel: opts.ariaLabel,
    ariaRole: opts.ariaRole,
    tagName: opts.tagName || "button",
    attributes: opts.attributes || {},
  };
}

// ---------------------------------------------------------------------------
// E2E-specific strategy for tests
// ---------------------------------------------------------------------------

/**
 * TestFallbackStrategy - uses simple CSS selectors to find elements
 * on the ticket app by matching aria-labels and common patterns.
 * This strategy works on BOTH v1 and v2 layouts because it uses
 * aria-label attributes which are consistent across layouts.
 */
export class TestFallbackStrategy implements Strategy {
  readonly name = "test-fallback";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    const target = intent.target.toLowerCase();
    const action = intent.action;

    // Try aria-label match first (works across layouts)
    const selectors = this.getSelectorsForIntent(target, action, intent.value);

    for (const selector of selectors) {
      try {
        const el = context.page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 1000 });
        if (visible) {
          return {
            intent,
            selector,
            confidence: 0.85,
            strategy: this.name,
          };
        }
      } catch {
        // Try next selector
      }
    }

    return null;
  }

  private getSelectorsForIntent(target: string, action: string, value?: string): string[] {
    const selectors: string[] = [];

    // Username/password fields
    if (target.includes("username")) {
      selectors.push('[aria-label="Username"]', '#username', 'input[name="username"]');
    }
    if (target.includes("password")) {
      selectors.push('[aria-label="Password"]', '#password', 'input[name="password"]');
    }

    // Login button
    if (target.includes("sign in") || target.includes("enter") || target.includes("login")) {
      selectors.push('[aria-label="Sign in"]', 'button[type="submit"]');
    }

    // Search - navigation link (just "search" without other words)
    if (target === "search" && action === "click") {
      selectors.push('a[aria-label="Search"]');
    }
    // Search query input
    if (target.includes("search") && (action === "fill")) {
      selectors.push('[aria-label="Search query"]', '#searchQuery', 'input[type="search"]');
    }
    // Search tickets button
    if (target.includes("search tickets") && action === "click") {
      selectors.push('[aria-label="Search tickets"]', 'button[type="submit"]');
    }

    // Ticket links
    const ticketMatch = target.match(/(?:open ticket |ticket )(tkt-\d+)/i);
    if (ticketMatch) {
      selectors.push(`[aria-label="Open ticket ${ticketMatch[1].toUpperCase()}"]`);
    }

    // Comment
    if ((target.includes("comment") || target.includes("write")) && action === "fill") {
      selectors.push('[aria-label="Comment text"]', '#comment', 'textarea[name="comment"]');
    }
    if (target.includes("add comment") || target.includes("💬")) {
      selectors.push('button[aria-label="Add comment"]');
    }

    // Resolve
    if (target.includes("resolve") || target.includes("✓") || target.includes("done")) {
      selectors.push('[aria-label="Resolve ticket"]');
    }

    // Confirm modal
    if (target.includes("confirm") || target.includes("proceed")) {
      selectors.push('[aria-label="Confirm resolve"]');
    }

    // Assign
    if (target.includes("assign") && action === "select") {
      selectors.push('[aria-label="Assign to"]', '#assignee', 'select[name="assignee"]');
    }
    if (target.includes("save") || target.includes("💾")) {
      selectors.push('[aria-label="Save assignment"]');
    }

    // Dashboard link
    if (target.includes("dashboard")) {
      selectors.push('[aria-label="Dashboard"]');
    }

    return selectors;
  }
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

export function assertIncludes(actual: string, expected: string, msg?: string) {
  if (!actual.includes(expected)) {
    throw new Error(
      msg || `Expected "${actual.slice(0, 100)}" to include "${expected}"`
    );
  }
}

export function assertEqual<T>(actual: T, expected: T, msg?: string) {
  if (actual !== expected) {
    throw new Error(msg || `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}`);
  }
}

export function assert(condition: boolean, msg?: string) {
  if (!condition) {
    throw new Error(msg || "Assertion failed");
  }
}
