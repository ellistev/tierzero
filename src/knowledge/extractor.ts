/**
 * Knowledge Extractor.
 *
 * Analyses completed agent work (git diffs, output, test results) and
 * produces KnowledgeEntry objects that capture reusable insights.
 */

import type { KnowledgeEntry } from "./store";

export interface ExtractionContext {
  taskId: string;
  taskTitle: string;
  taskDescription: string;
  agentName: string;
  gitDiff: string;
  agentOutput: string;
  testResults?: string;
  filesModified: string[];
}

export type ExtractedEntry = Omit<
  KnowledgeEntry,
  "id" | "embedding" | "usageCount" | "lastUsedAt" | "createdAt"
>;

export interface LLM {
  invoke(prompt: string): Promise<string>;
}

export interface KnowledgeExtractor {
  extract(context: ExtractionContext): Promise<ExtractedEntry[]>;
}

const EXTRACTION_PROMPT = `You are a knowledge extraction agent. Analyze the following completed task and extract reusable knowledge entries.

Task: {title}
Description: {description}

Git diff (files changed):
\`\`\`
{diff}
\`\`\`

Agent output summary:
{output}

{testSection}

Files modified: {files}

Extract knowledge entries as a JSON array. Each entry should have:
- type: "solution" | "pattern" | "error" | "decision" | "context"
- title: short summary (one line)
- content: detailed knowledge in markdown
- tags: searchable tags array
- relatedFiles: file paths this knowledge relates to
- confidence: 0-1 how reliable/reusable this knowledge is

Focus on:
- Solutions: HOW something was done (step-by-step)
- Patterns: conventions or structures discovered
- Errors: pitfalls or issues encountered
- Decisions: architectural choices made and why

Return ONLY a JSON array, no other text. If no meaningful knowledge can be extracted, return [].`;

export class LLMKnowledgeExtractor implements KnowledgeExtractor {
  constructor(private readonly llm: LLM) {}

  async extract(context: ExtractionContext): Promise<ExtractedEntry[]> {
    const testSection = context.testResults
      ? `Test results:\n\`\`\`\n${context.testResults.slice(0, 2000)}\n\`\`\``
      : "";

    const prompt = EXTRACTION_PROMPT
      .replace("{title}", context.taskTitle)
      .replace("{description}", context.taskDescription.slice(0, 2000))
      .replace("{diff}", context.gitDiff.slice(0, 4000))
      .replace("{output}", context.agentOutput.slice(0, 2000))
      .replace("{testSection}", testSection)
      .replace("{files}", context.filesModified.join(", "));

    const response = await this.llm.invoke(prompt);
    return this.parseResponse(response, context);
  }

  private parseResponse(response: string, context: ExtractionContext): ExtractedEntry[] {
    // Extract JSON array from response (may be wrapped in markdown code fences)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (item: Record<string, unknown>) =>
            item &&
            typeof item.type === "string" &&
            typeof item.title === "string" &&
            typeof item.content === "string"
        )
        .map((item: Record<string, unknown>) => ({
          type: item.type as KnowledgeEntry["type"],
          title: String(item.title),
          content: String(item.content),
          source: {
            taskId: context.taskId,
            agentName: context.agentName,
            timestamp: new Date().toISOString(),
          },
          tags: Array.isArray(item.tags)
            ? (item.tags as unknown[]).map(String)
            : [],
          relatedFiles: Array.isArray(item.relatedFiles)
            ? (item.relatedFiles as unknown[]).map(String)
            : context.filesModified,
          confidence: typeof item.confidence === "number" ? item.confidence : 0.7,
          supersededBy: null,
        }));
    } catch {
      return [];
    }
  }
}
