import { ChatOpenAI } from "@langchain/openai";
import type { MessageContent } from "@langchain/core/messages";
import { LLMKnowledgeExtractor, type KnowledgeExtractor } from "./extractor";

export interface KnowledgeExtractorFactoryConfig {
  enabled?: boolean;
  model?: string;
  openAIApiKey?: string;
}

export function createKnowledgeExtractor(
  config: KnowledgeExtractorFactoryConfig = {},
): KnowledgeExtractor | undefined {
  if (config.enabled === false) return undefined;

  const apiKey = config.openAIApiKey ?? process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return undefined;

  const model = config.model ?? "gpt-4o-mini";
  const llm = new ChatOpenAI({
    model,
    apiKey,
    temperature: 0,
  });

  return new LLMKnowledgeExtractor({
    invoke: async (prompt: string) => {
      const response = await llm.invoke(prompt);
      return normalizeMessageContent(response.content);
    },
  });
}

function normalizeMessageContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return String(content ?? "");

  return content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part) {
        return String(part.text ?? "");
      }
      return JSON.stringify(part);
    })
    .filter(Boolean)
    .join("\n");
}
