import type { Page } from "playwright";
import type { Intent, ResolvedIntent, ResolutionStrategy, SelectorCacheQuery, LLMProvider } from "./types";

/**
 * Cached strategy: tries a previously-working selector from the read model.
 */
export class CachedStrategy implements ResolutionStrategy {
  readonly method = "cached" as const;

  constructor(private readonly cache: SelectorCacheQuery) {}

  async resolve(intent: Intent, page: Page): Promise<ResolvedIntent | null> {
    const cached = await this.cache.get(intent.page, intent.name);
    if (!cached) return null;

    const start = Date.now();
    try {
      const el = await page.locator(cached.selector).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (!visible) return null;
      return {
        selector: cached.selector,
        method: "cached",
        durationMs: Date.now() - start,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Aria strategy: uses accessibility roles/labels to find elements.
 * Does not require LLM - works by mapping intent goals to aria queries.
 */
export class AriaStrategy implements ResolutionStrategy {
  readonly method = "aria" as const;

  async resolve(intent: Intent, page: Page): Promise<ResolvedIntent | null> {
    const start = Date.now();

    // Try to extract role and name from the goal
    const roleMatch = intent.goal.match(/^(click|fill|select|check|uncheck|toggle)\s+(?:the\s+)?(.+?)(?:\s+(?:button|textbox|input|checkbox|combobox|link|switch|tab|radio))?$/i);
    if (!roleMatch) return null;

    const action = roleMatch[1].toLowerCase();
    const label = roleMatch[2].trim();

    // Try common aria roles based on action
    const rolesToTry = this.getRoleCandidates(action);

    for (const role of rolesToTry) {
      try {
        const locator = page.getByRole(role as Parameters<Page["getByRole"]>[0], { name: label });
        const count = await locator.count();
        if (count > 0) {
          const visible = await locator.first().isVisible({ timeout: 2000 });
          if (visible) {
            return {
              selector: `role=${role}[name="${label}"]`,
              method: "aria",
              durationMs: Date.now() - start,
            };
          }
        }
      } catch {
        continue;
      }
    }

    // Also try getByLabel and getByText as fallback
    try {
      const byLabel = page.getByLabel(label);
      if (await byLabel.count() > 0 && await byLabel.first().isVisible({ timeout: 2000 })) {
        return {
          selector: `label="${label}"`,
          method: "aria",
          durationMs: Date.now() - start,
        };
      }
    } catch {}

    try {
      const byText = page.getByText(label, { exact: true });
      if (await byText.count() > 0 && await byText.first().isVisible({ timeout: 2000 })) {
        return {
          selector: `text="${label}"`,
          method: "aria",
          durationMs: Date.now() - start,
        };
      }
    } catch {}

    return null;
  }

  private getRoleCandidates(action: string): string[] {
    switch (action) {
      case "click": return ["button", "link", "tab", "menuitem", "switch"];
      case "fill": return ["textbox", "searchbox", "spinbutton"];
      case "select": return ["combobox", "listbox", "radio"];
      case "check":
      case "uncheck":
      case "toggle": return ["checkbox", "switch"];
      default: return ["button", "link", "textbox"];
    }
  }
}

/**
 * Vision strategy: takes a screenshot and uses an LLM vision model
 * to locate the target element.
 */
export class VisionStrategy implements ResolutionStrategy {
  readonly method = "vision" as const;

  constructor(private readonly llm: LLMProvider) {}

  async resolve(intent: Intent, page: Page): Promise<ResolvedIntent | null> {
    const start = Date.now();
    try {
      const screenshot = await page.screenshot({ type: "png" });
      const base64 = screenshot.toString("base64");
      const selector = await this.llm.findElementFromScreenshot(intent, base64);
      if (!selector) return null;

      // Verify the selector works
      const el = await page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (!visible) return null;

      return {
        selector,
        method: "vision",
        durationMs: Date.now() - start,
      };
    } catch {
      return null;
    }
  }
}

/**
 * LLM strategy: gets the accessibility tree and asks an LLM to find the element.
 */
export class LLMStrategy implements ResolutionStrategy {
  readonly method = "llm" as const;

  constructor(private readonly llm: LLMProvider) {}

  async resolve(intent: Intent, page: Page): Promise<ResolvedIntent | null> {
    const start = Date.now();
    try {
      const snapshot = await page.accessibility.snapshot();
      if (!snapshot) return null;

      const tree = JSON.stringify(snapshot, null, 2);
      const selector = await this.llm.findElementFromAccessibilityTree(intent, tree);
      if (!selector) return null;

      // Verify the selector works
      const el = await page.locator(selector).first();
      const visible = await el.isVisible({ timeout: 3000 });
      if (!visible) return null;

      return {
        selector,
        method: "llm",
        durationMs: Date.now() - start,
      };
    } catch {
      return null;
    }
  }
}
