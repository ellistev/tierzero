/**
 * CoordinateStrategy - Falls back to coordinate-based interaction
 * when selector-based approaches all fail.
 */

import type {
  Intent,
  ResolvedIntent,
  Strategy,
  StrategyContext,
} from "./types";

/**
 * CoordinateStrategy takes a screenshot, asks the LLM to identify
 * element coordinates, and clicks at those coordinates.
 */
export class CoordinateStrategy implements Strategy {
  readonly name = "coordinate";

  async resolve(
    intent: Intent,
    context: StrategyContext
  ): Promise<ResolvedIntent | null> {
    if (!context.llm?.findCoordinatesFromScreenshot) return null;

    try {
      // Get viewport size for coordinate scaling
      const viewport = context.page.viewportSize();
      if (!viewport) return null;

      // Take screenshot
      const buf = await context.page.screenshot({ type: "png" });
      const base64 = buf.toString("base64");

      // Ask LLM for coordinates
      const coords = await context.llm.findCoordinatesFromScreenshot(
        intent,
        base64,
        viewport
      );

      if (!coords) return null;

      // Validate coordinates are within viewport
      if (
        coords.x < 0 ||
        coords.y < 0 ||
        coords.x > viewport.width ||
        coords.y > viewport.height
      ) {
        return null;
      }

      return {
        intent,
        coordinates: { x: coords.x, y: coords.y },
        confidence: 0.5,
        strategy: this.name,
      };
    } catch {
      return null;
    }
  }
}

/**
 * Execute a resolved intent on the page.
 * Handles both selector-based and coordinate-based interactions.
 */
export async function executeResolvedIntent(
  resolved: ResolvedIntent,
  page: import("playwright").Page
): Promise<void> {
  const { intent, selector, coordinates } = resolved;

  if (selector) {
    await executeWithSelector(intent, selector, page);
  } else if (coordinates) {
    await executeWithCoordinates(intent, coordinates, page);
  } else {
    throw new Error(
      `Cannot execute intent: no selector or coordinates for "${intent.target}"`
    );
  }
}

async function executeWithSelector(
  intent: Intent,
  selector: string,
  page: import("playwright").Page
): Promise<void> {
  switch (intent.action) {
    case "click":
      await page.click(selector);
      break;
    case "fill":
      if (intent.value !== undefined) {
        await page.fill(selector, intent.value);
      }
      break;
    case "select":
      if (intent.value !== undefined) {
        await page.selectOption(selector, intent.value);
      }
      break;
    case "hover":
      await page.hover(selector);
      break;
    case "check":
      await page.check(selector);
      break;
    case "uncheck":
      await page.uncheck(selector);
      break;
    default:
      await page.click(selector);
  }
}

async function executeWithCoordinates(
  intent: Intent,
  coordinates: { x: number; y: number },
  page: import("playwright").Page
): Promise<void> {
  const { x, y } = coordinates;

  switch (intent.action) {
    case "click":
      await page.mouse.click(x, y);
      break;
    case "fill":
      // Click to focus, then type
      await page.mouse.click(x, y);
      if (intent.value !== undefined) {
        // Select all existing text and replace
        await page.keyboard.press("Control+A");
        await page.keyboard.type(intent.value);
      }
      break;
    case "hover":
      await page.mouse.move(x, y);
      break;
    default:
      await page.mouse.click(x, y);
  }
}
