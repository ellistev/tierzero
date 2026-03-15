/**
 * Smart Intent Parser - LLM-based intent parsing.
 * Replaces brittle regex goal parsing with structured LLM output.
 */

import type { Intent, LLMProvider } from "./types";

// ---------------------------------------------------------------------------
// Regex-based fallback parser (no LLM needed)
// ---------------------------------------------------------------------------

const ACTION_PATTERNS: Array<{ pattern: RegExp; action: string }> = [
  { pattern: /^click\s+(?:on\s+)?(?:the\s+)?(.+)/i, action: "click" },
  { pattern: /^tap\s+(?:on\s+)?(?:the\s+)?(.+)/i, action: "click" },
  { pattern: /^press\s+(?:the\s+)?(.+)/i, action: "click" },
  {
    pattern: /^(?:fill|type|enter|input)\s+(?:in\s+)?(?:the\s+)?["']?(.+?)["']?\s+with\s+["'](.+)["']/i,
    action: "fill",
  },
  {
    pattern: /^(?:fill|type|enter|input)\s+["'](.+)["']\s+(?:in|into)\s+(?:the\s+)?(.+)/i,
    action: "fill_reversed",
  },
  {
    pattern: /^(?:set|change)\s+(?:the\s+)?(.+?)\s+to\s+["']?(.+?)["']?$/i,
    action: "fill",
  },
  {
    pattern: /^select\s+["']?(.+?)["']?\s+(?:from|in)\s+(?:the\s+)?(.+)/i,
    action: "select",
  },
  { pattern: /^(?:go\s+to|navigate\s+to|open)\s+(.+)/i, action: "navigate" },
  { pattern: /^hover\s+(?:over\s+)?(?:the\s+)?(.+)/i, action: "hover" },
  { pattern: /^scroll\s+(.+)/i, action: "scroll" },
  { pattern: /^wait\s+(?:for\s+)?(.+)/i, action: "wait" },
  { pattern: /^check\s+(?:the\s+)?(.+)/i, action: "check" },
  { pattern: /^uncheck\s+(?:the\s+)?(.+)/i, action: "uncheck" },
];

/**
 * Parse a natural language goal into an Intent using regex patterns.
 * Used as a fast fallback when LLM is unavailable.
 */
export function parseIntentFallback(naturalLanguage: string): Intent {
  const trimmed = naturalLanguage.trim();

  for (const { pattern, action } of ACTION_PATTERNS) {
    const match = trimmed.match(pattern);
    if (match) {
      if (action === "fill") {
        return { action: "fill", target: match[1], value: match[2] };
      }
      if (action === "fill_reversed") {
        return { action: "fill", target: match[2], value: match[1] };
      }
      if (action === "select") {
        return { action: "select", target: match[2], value: match[1] };
      }
      if (action === "navigate") {
        return { action: "navigate", target: match[1] };
      }
      return { action, target: match[1] };
    }
  }

  // Default: treat the whole string as a click target
  return { action: "click", target: trimmed };
}

// ---------------------------------------------------------------------------
// LLM-based parser
// ---------------------------------------------------------------------------

/**
 * Parse a natural language goal into a structured Intent.
 * Uses LLM when available, falls back to regex.
 */
export async function parseIntent(
  naturalLanguage: string,
  llm?: LLMProvider
): Promise<Intent> {
  if (!llm?.parseGoalToIntent) {
    return parseIntentFallback(naturalLanguage);
  }

  try {
    return await llm.parseGoalToIntent(naturalLanguage);
  } catch {
    return parseIntentFallback(naturalLanguage);
  }
}

/**
 * Decompose a complex goal into a sequence of atomic intents.
 * Uses LLM when available, falls back to simple splitting.
 */
export async function decomposeIntent(
  complexGoal: string,
  llm?: LLMProvider
): Promise<Intent[]> {
  if (!llm?.decomposeGoal) {
    return decomposeIntentFallback(complexGoal);
  }

  try {
    return await llm.decomposeGoal(complexGoal);
  } catch {
    return decomposeIntentFallback(complexGoal);
  }
}

/**
 * Fallback decomposition: split on "then", "and then", commas.
 */
export function decomposeIntentFallback(complexGoal: string): Intent[] {
  const parts = complexGoal
    .split(/\s+(?:then|and\s+then|,\s*then)\s+/i)
    .map((p) => p.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    // Try splitting on " and " if it looks like multiple actions
    const andParts = complexGoal
      .split(/\s+and\s+/i)
      .map((p) => p.trim())
      .filter(Boolean);

    if (andParts.length > 1 && andParts.every((p) => looksLikeAction(p))) {
      return andParts.map(parseIntentFallback);
    }

    return [parseIntentFallback(complexGoal)];
  }

  return parts.map(parseIntentFallback);
}

function looksLikeAction(text: string): boolean {
  const actionVerbs = [
    "click",
    "tap",
    "press",
    "fill",
    "type",
    "enter",
    "select",
    "go",
    "navigate",
    "open",
    "hover",
    "scroll",
    "wait",
    "check",
    "uncheck",
    "set",
    "change",
  ];
  const firstWord = text.split(/\s+/)[0].toLowerCase();
  return actionVerbs.includes(firstWord);
}
