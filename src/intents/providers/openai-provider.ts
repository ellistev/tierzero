/**
 * OpenAI LLMProvider implementation.
 * Uses gpt-4o for vision tasks, gpt-4o-mini for text tasks.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { Intent, LLMProvider } from "../types";

const DEFAULT_TIMEOUT_MS = 30_000;

export class OpenAILLMProvider implements LLMProvider {
  private textModel: ChatOpenAI;
  private visionModel: ChatOpenAI;

  constructor(options?: { apiKey?: string; timeoutMs?: number }) {
    const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenAI API key is required. Set OPENAI_API_KEY environment variable or pass apiKey option."
      );
    }

    const timeout = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    this.textModel = new ChatOpenAI({
      modelName: "gpt-4o-mini",
      openAIApiKey: apiKey,
      temperature: 0,
      timeout,
    });

    this.visionModel = new ChatOpenAI({
      modelName: "gpt-4o",
      openAIApiKey: apiKey,
      temperature: 0,
      timeout,
    });
  }

  async findElementFromAccessibilityTree(
    intent: Intent,
    tree: string
  ): Promise<string | null> {
    const response = await this.textModel.invoke([
      new SystemMessage(
        `You are a browser automation assistant. Given an accessibility tree and an intent, return the BEST CSS or ARIA selector for the target element. Return ONLY the selector string, nothing else. If you cannot find a matching element, return "null".`
      ),
      new HumanMessage(
        `Intent: ${intent.action} on "${intent.target}"${intent.value ? ` with value "${intent.value}"` : ""}\n\nAccessibility Tree:\n${tree}`
      ),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    if (!text || text === "null" || text === "undefined") return null;
    return text;
  }

  async findElementFromScreenshot(
    intent: Intent,
    base64: string
  ): Promise<{
    selector?: string;
    coordinates?: { x: number; y: number };
  } | null> {
    const response = await this.visionModel.invoke([
      new SystemMessage(
        `You are a browser automation assistant. Given a screenshot and an intent, identify the target element. Return a JSON object with either a "selector" (CSS/ARIA) or "coordinates" ({x, y} center point). Return ONLY valid JSON, no markdown.`
      ),
      new HumanMessage({
        content: [
          {
            type: "text" as const,
            text: `Intent: ${intent.action} on "${intent.target}"${intent.value ? ` with value "${intent.value}"` : ""}`,
          },
          {
            type: "image_url" as const,
            image_url: { url: `data:image/png;base64,${base64}` },
          },
        ],
      }),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    try {
      const parsed = JSON.parse(text);
      if (parsed.selector || parsed.coordinates) return parsed;
    } catch {
      // Not valid JSON
    }

    return null;
  }

  async analyzePageForRecovery(
    intent: Intent,
    pageContent: string,
    error: string
  ): Promise<{ action: string; detail: string } | null> {
    const response = await this.textModel.invoke([
      new SystemMessage(
        `You are a browser automation recovery assistant. Given the page state, the intended action, and the error, diagnose what went wrong and suggest a recovery action. Return a JSON object with "action" (one of: retry, navigate, wait, dismiss_modal, scroll, refresh, abort) and "detail" (brief explanation). Return ONLY valid JSON.`
      ),
      new HumanMessage(
        `Intent: ${intent.action} on "${intent.target}"\nError: ${error}\n\nPage content (truncated):\n${pageContent.slice(0, 4000)}`
      ),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    try {
      const parsed = JSON.parse(text);
      if (parsed.action && parsed.detail) return parsed;
    } catch {
      // Not valid JSON
    }

    return null;
  }

  async parseGoalToIntent(goal: string): Promise<Intent> {
    const response = await this.textModel.invoke([
      new SystemMessage(
        `You are a browser automation parser. Convert the natural language goal into a structured intent. Return a JSON object with: "action" (click, fill, navigate, select, hover, scroll, wait, etc.), "target" (human description of the element), and optionally "value" (for fill/select). Return ONLY valid JSON.`
      ),
      new HumanMessage(goal),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    const parsed = JSON.parse(text);
    return {
      action: parsed.action ?? "click",
      target: parsed.target ?? goal,
      value: parsed.value,
    };
  }

  async decomposeGoal(goal: string): Promise<Intent[]> {
    const response = await this.textModel.invoke([
      new SystemMessage(
        `You are a browser automation planner. Break the complex goal into a sequence of atomic browser actions. Return a JSON array of intent objects, each with "action", "target", and optionally "value". Return ONLY a valid JSON array.`
      ),
      new HumanMessage(goal),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [{ action: "click", target: goal }];

    return parsed.map((p: Record<string, unknown>) => ({
      action: (p.action as string) ?? "click",
      target: (p.target as string) ?? "",
      value: p.value as string | undefined,
    }));
  }

  async findCoordinatesFromScreenshot(
    intent: Intent,
    base64: string,
    viewport: { width: number; height: number }
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    const response = await this.visionModel.invoke([
      new SystemMessage(
        `You are a browser automation assistant. Given a screenshot (viewport: ${viewport.width}x${viewport.height}) and an intent, identify the target element's bounding box. Return a JSON object with "x" (center x), "y" (center y), "width", and "height" in pixels. Coordinates must be within the viewport bounds. Return ONLY valid JSON.`
      ),
      new HumanMessage({
        content: [
          {
            type: "text" as const,
            text: `Intent: ${intent.action} on "${intent.target}"${intent.value ? ` with value "${intent.value}"` : ""}`,
          },
          {
            type: "image_url" as const,
            image_url: { url: `data:image/png;base64,${base64}` },
          },
        ],
      }),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim()
      : String(response.content).trim();

    try {
      const parsed = JSON.parse(text);
      if (
        typeof parsed.x === "number" &&
        typeof parsed.y === "number" &&
        typeof parsed.width === "number" &&
        typeof parsed.height === "number"
      ) {
        // Clamp to viewport
        return {
          x: Math.max(0, Math.min(parsed.x, viewport.width)),
          y: Math.max(0, Math.min(parsed.y, viewport.height)),
          width: parsed.width,
          height: parsed.height,
        };
      }
    } catch {
      // Not valid JSON
    }

    return null;
  }

  async verifyVisualCondition(
    description: string,
    base64: string
  ): Promise<boolean> {
    const response = await this.visionModel.invoke([
      new SystemMessage(
        `You are a visual verification assistant. Given a screenshot, determine whether the described condition is met. Return ONLY "true" or "false".`
      ),
      new HumanMessage({
        content: [
          { type: "text" as const, text: `Condition: ${description}` },
          {
            type: "image_url" as const,
            image_url: { url: `data:image/png;base64,${base64}` },
          },
        ],
      }),
    ]);

    const text = typeof response.content === "string"
      ? response.content.trim().toLowerCase()
      : String(response.content).trim().toLowerCase();

    return text === "true";
  }
}
