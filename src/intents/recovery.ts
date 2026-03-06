import type { Page } from "playwright";
import type { Intent, RecoveryStrategy, LLMProvider } from "./types";

/**
 * Dismiss dialogs/modals that may be blocking the page.
 */
export class DismissDialogRecovery implements RecoveryStrategy {
  readonly name = "dismiss-dialog";

  async canRecover(_intent: Intent, page: Page, _error: Error): Promise<boolean> {
    try {
      const dialog = page.locator("[role='dialog'], [role='alertdialog'], .modal");
      return (await dialog.count()) > 0;
    } catch {
      return false;
    }
  }

  async recover(_intent: Intent, page: Page, _error: Error): Promise<{ recovered: boolean; detail: string }> {
    try {
      // Try to find and click a close/dismiss button in the dialog
      const closeButtons = [
        page.locator("[role='dialog'] button[aria-label='Close']"),
        page.locator("[role='dialog'] button:has-text('Close')"),
        page.locator("[role='dialog'] button:has-text('Cancel')"),
        page.locator("[role='dialog'] button:has-text('Dismiss')"),
        page.locator(".modal button[aria-label='Close']"),
        page.locator(".modal .close"),
      ];

      for (const btn of closeButtons) {
        try {
          if (await btn.count() > 0 && await btn.first().isVisible({ timeout: 1000 })) {
            await btn.first().click();
            await page.waitForTimeout(1000);
            return { recovered: true, detail: "Dismissed blocking dialog" };
          }
        } catch {
          continue;
        }
      }

      // Try pressing Escape
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
      return { recovered: true, detail: "Pressed Escape to dismiss dialog" };
    } catch {
      return { recovered: false, detail: "Could not dismiss dialog" };
    }
  }
}

/**
 * LLM-powered recovery: analyzes page state and takes corrective action.
 */
export class LLMRecovery implements RecoveryStrategy {
  readonly name = "llm-recovery";

  constructor(private readonly llm: LLMProvider) {}

  async canRecover(_intent: Intent, _page: Page, _error: Error): Promise<boolean> {
    return true; // LLM recovery is always worth trying as last resort
  }

  async recover(intent: Intent, page: Page, error: Error): Promise<{ recovered: boolean; detail: string }> {
    try {
      const content = await page.content();
      const analysis = await this.llm.analyzePageForRecovery(intent, content, error.message);
      if (!analysis) return { recovered: false, detail: "LLM could not analyze page" };

      switch (analysis.action) {
        case "navigate":
          await page.goto(analysis.detail, { waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2000);
          return { recovered: true, detail: `Navigated to ${analysis.detail}` };
        case "dismiss":
          await page.keyboard.press("Escape");
          await page.waitForTimeout(1000);
          return { recovered: true, detail: "Dismissed overlay per LLM advice" };
        case "wait":
          await page.waitForTimeout(5000);
          return { recovered: true, detail: "Waited for page to settle" };
        case "escalate":
          return { recovered: false, detail: analysis.detail };
        default:
          return { recovered: false, detail: "Unknown recovery action" };
      }
    } catch {
      return { recovered: false, detail: "LLM recovery failed" };
    }
  }
}
