/**
 * Page State Assertions - Verify the page is in the expected state.
 */

import type { Page } from "playwright";
import type { LLMProvider } from "./types";

// ---------------------------------------------------------------------------
// URL assertion
// ---------------------------------------------------------------------------

/**
 * Verify the current URL matches the expected pattern.
 * Supports exact match, substring, or regex.
 */
export async function assertOnPage(
  page: Page,
  expectedUrl: string | RegExp
): Promise<void> {
  const currentUrl = page.url();

  if (expectedUrl instanceof RegExp) {
    if (!expectedUrl.test(currentUrl)) {
      throw new AssertionError(
        `Expected URL to match ${expectedUrl} but got "${currentUrl}"`
      );
    }
  } else {
    // Support both exact and substring match
    if (
      currentUrl !== expectedUrl &&
      !currentUrl.includes(expectedUrl)
    ) {
      throw new AssertionError(
        `Expected URL to contain "${expectedUrl}" but got "${currentUrl}"`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Element visibility assertion
// ---------------------------------------------------------------------------

/**
 * Verify that an element matching the description is visible on the page.
 * When an LLM provider is given, uses vision to verify;
 * otherwise falls back to text content search.
 */
export async function assertElementVisible(
  page: Page,
  description: string,
  llm?: LLMProvider
): Promise<void> {
  // Try LLM vision verification if available
  if (llm?.verifyVisualCondition) {
    try {
      const buf = await page.screenshot({ type: "png" });
      const base64 = buf.toString("base64");
      const isVisible = await llm.verifyVisualCondition(
        `Is the following visible on the page: ${description}`,
        base64
      );
      if (!isVisible) {
        throw new AssertionError(
          `Element not visible (LLM-verified): "${description}"`
        );
      }
      return;
    } catch (err) {
      if (err instanceof AssertionError) throw err;
      // LLM failed, fall back to text search
    }
  }

  // Fallback: check if the description text exists in the page
  const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
  if (!bodyText.toLowerCase().includes(description.toLowerCase())) {
    throw new AssertionError(
      `Element not visible: "${description}" not found in page text`
    );
  }
}

// ---------------------------------------------------------------------------
// Error assertion
// ---------------------------------------------------------------------------

/**
 * Verify the page has no visible error messages.
 * Checks for error banners, toasts, alert roles, and HTTP error pages.
 */
export async function assertNoErrors(page: Page): Promise<void> {
  const errors = await page.evaluate(() => {
    const messages: string[] = [];

    // Check role="alert" elements
    for (const el of document.querySelectorAll("[role='alert']")) {
      const text = (el as HTMLElement).textContent?.trim() ?? "";
      if (text) messages.push(text);
    }

    // Check common error CSS classes
    const errorSelectors = [
      ".error",
      ".alert-danger",
      ".alert-error",
      ".toast-error",
      ".notification-error",
      ".MuiAlert-standardError",
      ".error-message",
      ".error-banner",
    ];

    for (const sel of errorSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        const text = (el as HTMLElement).textContent?.trim() ?? "";
        if (text && !messages.includes(text)) {
          messages.push(text);
        }
      }
    }

    // Check for HTTP error pages
    const title = document.title.toLowerCase();
    const bodyText = document.body?.innerText?.slice(0, 500).toLowerCase() ?? "";

    if (
      title.includes("500") ||
      title.includes("error") ||
      title.includes("404") ||
      title.includes("not found")
    ) {
      messages.push(`Error page detected: "${document.title}"`);
    }

    if (
      bodyText.includes("internal server error") ||
      bodyText.includes("500 error") ||
      bodyText.includes("page not found")
    ) {
      messages.push("HTTP error page detected");
    }

    return messages;
  });

  if (errors.length > 0) {
    throw new AssertionError(
      `Page has errors:\n${errors.map((e) => `  - ${e.slice(0, 200)}`).join("\n")}`
    );
  }
}

// ---------------------------------------------------------------------------
// Form field assertion
// ---------------------------------------------------------------------------

/**
 * Verify a form field has the expected value.
 */
export async function assertFormFilled(
  page: Page,
  fieldName: string,
  expectedValue: string
): Promise<void> {
  const actualValue = await page.evaluate(
    ([name, expected]) => {
      // Try by name attribute
      let el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | null =
        document.querySelector(`[name="${name}"]`);

      // Try by id
      if (!el) {
        el = document.querySelector(`#${name}`) as typeof el;
      }

      // Try by aria-label
      if (!el) {
        el = document.querySelector(`[aria-label="${name}"]`) as typeof el;
      }

      // Try by label text
      if (!el) {
        for (const label of document.querySelectorAll("label")) {
          if (label.textContent?.trim().toLowerCase().includes(name.toLowerCase())) {
            const forId = label.getAttribute("for");
            if (forId) {
              el = document.querySelector(`#${forId}`) as typeof el;
            }
            break;
          }
        }
      }

      // Try by placeholder
      if (!el) {
        el = document.querySelector(`[placeholder="${name}"]`) as typeof el;
      }

      if (!el) return { found: false, value: "" };
      return { found: true, value: el.value ?? "" };
    },
    [fieldName, expectedValue] as const
  );

  if (!actualValue.found) {
    throw new AssertionError(`Form field "${fieldName}" not found on page`);
  }

  if (actualValue.value !== expectedValue) {
    throw new AssertionError(
      `Form field "${fieldName}" expected value "${expectedValue}" but got "${actualValue.value}"`
    );
  }
}

// ---------------------------------------------------------------------------
// Custom error class
// ---------------------------------------------------------------------------

export class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}
