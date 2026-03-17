/**
 * Multi-model coding LLM providers.
 *
 * Thin wrappers around OpenAI, Anthropic, and Google APIs that all
 * implement the same CodingModel interface. Uses native `fetch` --
 * no SDK dependencies.
 */

import type {
  CodingModel,
  CodingModelConfig,
  CodingMessage,
  CodingProvider,
  PROVIDER_ENV_KEYS,
} from "./types.js";

// ---------------------------------------------------------------------------
// OpenAI provider
// ---------------------------------------------------------------------------

class OpenAICodingModel implements CodingModel {
  readonly provider: CodingProvider = "openai";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: CodingModelConfig) {
    this.modelName = config.model;
    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY || "";
    this.maxTokens = config.maxTokens ?? 16384;
    this.temperature = config.temperature ?? 0;
    if (!this.apiKey) throw new Error("OpenAI API key required (set OPENAI_API_KEY or pass apiKey)");
  }

  async chat(messages: CodingMessage[]): Promise<string> {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`OpenAI API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices[0]?.message?.content ?? "";
  }
}

// ---------------------------------------------------------------------------
// Anthropic provider (Claude)
// ---------------------------------------------------------------------------

class AnthropicCodingModel implements CodingModel {
  readonly provider: CodingProvider = "anthropic";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: CodingModelConfig) {
    this.modelName = config.model;
    this.apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.maxTokens = config.maxTokens ?? 16384;
    this.temperature = config.temperature ?? 0;
    if (!this.apiKey) throw new Error("Anthropic API key required (set ANTHROPIC_API_KEY or pass apiKey)");
  }

  async chat(messages: CodingMessage[]): Promise<string> {
    // Anthropic Messages API requires system as a top-level param, not in messages array
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.modelName,
        max_tokens: this.maxTokens,
        temperature: this.temperature,
        system: systemMsg?.content ?? "",
        messages: nonSystem.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Anthropic API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      content: Array<{ type: string; text: string }>;
    };
    return data.content
      .filter((c) => c.type === "text")
      .map((c) => c.text)
      .join("");
  }
}

// ---------------------------------------------------------------------------
// Google Gemini provider
// ---------------------------------------------------------------------------

class GoogleCodingModel implements CodingModel {
  readonly provider: CodingProvider = "google";
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: CodingModelConfig) {
    this.modelName = config.model;
    this.apiKey = config.apiKey || process.env.GOOGLE_API_KEY || "";
    this.maxTokens = config.maxTokens ?? 16384;
    this.temperature = config.temperature ?? 0;
    if (!this.apiKey) throw new Error("Google API key required (set GOOGLE_API_KEY or pass apiKey)");
  }

  async chat(messages: CodingMessage[]): Promise<string> {
    // Gemini API: system instruction is separate, conversation uses "parts"
    const systemMsg = messages.find((m) => m.role === "system");
    const nonSystem = messages.filter((m) => m.role !== "system");

    const contents = nonSystem.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    }));

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}:generateContent?key=${this.apiKey}`;

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: this.maxTokens,
        temperature: this.temperature,
      },
    };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`Google API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as {
      candidates: Array<{
        content: { parts: Array<{ text: string }> };
      }>;
    };
    return data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Well-known model → provider mapping for convenience */
const MODEL_PROVIDER_HINTS: Array<{ pattern: RegExp; provider: CodingProvider }> = [
  { pattern: /^claude/i, provider: "anthropic" },
  { pattern: /^gpt/i, provider: "openai" },
  { pattern: /^o[1-9]/i, provider: "openai" },
  { pattern: /^gemini/i, provider: "google" },
];

/**
 * Infer the provider from a model name.
 * e.g. "claude-sonnet-4-20250514" → "anthropic", "gpt-4o" → "openai"
 */
export function inferProvider(modelName: string): CodingProvider | undefined {
  for (const { pattern, provider } of MODEL_PROVIDER_HINTS) {
    if (pattern.test(modelName)) return provider;
  }
  return undefined;
}

/**
 * Create a CodingModel for the given config.
 * If provider is omitted, it's inferred from the model name.
 */
export function createCodingModel(config: CodingModelConfig): CodingModel {
  const provider = config.provider ?? inferProvider(config.model);
  if (!provider) {
    throw new Error(
      `Cannot infer provider for model "${config.model}". ` +
      `Pass --coding-provider explicitly (openai, anthropic, google).`
    );
  }

  const resolved = { ...config, provider };

  
class OpenRouterCodingModel implements CodingModel {
  readonly provider: CodingProvider = "openrouter" as any;
  readonly modelName: string;
  private readonly apiKey: string;
  private readonly maxTokens: number;
  private readonly temperature: number;

  constructor(config: CodingModelConfig) {
    this.modelName = config.model;
    this.apiKey = config.apiKey || process.env.OPENROUTER_API_KEY || "";
    this.maxTokens = config.maxTokens ?? 16384;
    this.temperature = config.temperature ?? 0;
    if (!this.apiKey) throw new Error("OpenRouter API key required");
  }

  async chat(messages: CodingMessage[]): Promise<string> {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.modelName,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`OpenRouter API ${res.status}: ${text}`);
    }

    const data = await res.json() as any;
    return data.choices?.[0]?.message?.content ?? "";
  }
}

  switch (provider) {
    case "openrouter": return new OpenRouterCodingModel(resolved as any);
    case "openai":    return new OpenAICodingModel(resolved);
    case "anthropic": return new AnthropicCodingModel(resolved);
    case "google":    return new GoogleCodingModel(resolved);
    default:
      throw new Error(`Unknown coding provider: "${provider}"`);
  }
}

// Export for testing
export const _testExports = { inferProvider };
