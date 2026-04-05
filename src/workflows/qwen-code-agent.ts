/**
 * Qwen CodeAgent implementation.
 * 
 * Uses OpenRouter API (Qwen 3.6 Plus free) to solve GitHub issues.
 * Zero Anthropic dependency, zero API cost.
 * 
 * Flow:
 * 1. Write TASK.md with issue context + acceptance criteria
 * 2. Call OpenRouter API with Qwen + code execution tools
 * 3. Execute tool calls (read/write files, run shell commands)
 * 4. Feed results back in subsequent API turns
 * 5. Repeat until completion or max iterations
 * 6. Clean up, return summary + changed files
 */

import { execSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./issue-pipeline";
import type { KnowledgeStore, KnowledgeEntry } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";
import { createLogger } from "../infra/logger";

const log = createLogger("qwen-code-agent");

// ---------------------------------------------------------------------------
// OpenRouter tool definitions
// ---------------------------------------------------------------------------

const CODE_EXECUTION_TOOLS: OpenRouterTool[] = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read the contents of a file. Returns the file contents as text.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: {
            type: "string",
            description: "Path to the file to read (relative to working directory)",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: {
            type: "string",
            description: "Path to the file to write (relative to working directory)",
          },
          content: {
            type: "string",
            description: "Content to write to the file",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_command",
      description: "Execute a shell command and return the output. Use for running tests, git operations, etc. Do NOT use for file operations.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: {
            type: "string",
            description: "Shell command to execute",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "finish",
      description: "Call this when all tasks are complete. Provide a summary of what you did.",
      parameters: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: {
            type: "string",
            description: "Brief summary of the work completed",
          },
        },
      },
    },
  },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface OpenRouterTool {
  type: string;
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

interface OpenRouterMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{
    id: string;
    type: string;
    function: {
      name: string;
      arguments: string;
    };
  }>;
  name?: string;
  tool_call_id?: string;
}

interface QwenCodeAgentConfig {
  /** OpenRouter API key */
  apiKey: string;
  /** Model name (default: qwen/qwen3.6-plus:free) */
  model?: string;
  /** Max tool-calling iterations per task (default: 30) */
  maxIterations?: number;
  /** Timeout for entire solve in ms (default: 600000 = 10min) */
  timeoutMs?: number;
  /** Knowledge store for prior knowledge injection */
  knowledgeStore?: KnowledgeStore;
  /** Knowledge extractor for post-task learning */
  knowledgeExtractor?: KnowledgeExtractor;
}

// ---------------------------------------------------------------------------
// QwenCodeAgent
// ---------------------------------------------------------------------------

export class QwenCodeAgent implements CodeAgent {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxIterations: number;
  private readonly timeoutMs: number;
  private readonly knowledgeStore: KnowledgeStore | null;
  private readonly knowledgeExtractor: KnowledgeExtractor | null;

  constructor(config: QwenCodeAgentConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "qwen/qwen3.6-plus:free";
    this.maxIterations = config.maxIterations ?? 30;
    this.timeoutMs = config.timeoutMs ?? 600_000;
    this.knowledgeStore = config.knowledgeStore ?? null;
    this.knowledgeExtractor = config.knowledgeExtractor ?? null;
  }

  async solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult> {
    const timer = setTimeout(() => {
      log.error(`Timeout after ${this.timeoutMs}ms`);
    }, this.timeoutMs);

    try {
      // 1. Search for prior knowledge
      const priorKnowledge = await this.searchPriorKnowledge(issue);

      // 2. Write TASK.md
      const taskPath = join(workDir, "TASK.md");
      const taskContent = this.buildTaskFile(issue, priorKnowledge);
      writeFileSync(taskPath, taskContent, "utf-8");

      log.info(`Solving issue #${issue.number}: ${issue.title} (Qwen 3.6 Plus free)`);

      // 3. Build system prompt
      const systemPrompt = this.buildSystemPrompt(issue);

      // 4. Run the coding loop
      const messages: OpenRouterMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Read TASK.md and implement everything described. Start by reading the necessary source files to understand the codebase, then make your changes.` },
      ];

      let iteration = 0;
      const toolLog: string[] = [];

      while (iteration < this.maxIterations) {
        iteration++;
        log.info(`  Iteration ${iteration}/${this.maxIterations}`);

        // Call Qwen
        const response = await this.callOpenRouter(messages);

        // Check if model called any tools
        const toolCalls = response.tool_calls;
        if (!toolCalls || toolCalls.length === 0) {
          // No tool calls - model just responded. Add its response to history and
          // check if it naturally concluded (or force another prompt).
          if (response.content) {
            messages.push({ role: "assistant", content: response.content });
            // If the response looks conclusive, stop
            if (this.isConclusive(response.content) || iteration >= this.maxIterations) {
              break;
            }
          }
          // Nudge if stuck
          messages.push({
            role: "user",
            content: "If you have more work to do, continue using the tools. If you're done, call finish with your summary.",
          });
          continue;
        }

        // Execute each tool call
        messages.push({
          role: "assistant",
          content: response.content || "",
          tool_calls: toolCalls,
        });

        for (const tc of toolCalls) {
          const toolName = tc.function.name;
          let toolArgs: Record<string, string>;
          try {
            toolArgs = JSON.parse(tc.function.arguments);
          } catch {
            toolArgs = {};
          }

          const result = await this.executeTool(toolName, toolArgs, workDir);
          log.info(`  Tool: ${toolName} -> ${result.ok ? "OK" : "ERROR"} (${result.output.length} chars)`);
          toolLog.push(`${toolName}(${JSON.stringify(toolArgs).slice(0, 80)})`);

          // Add assistant message if not already added
          messages.push({
            role: "tool",
            content: result.output,
            name: toolName,
            tool_call_id: tc.id,
          });

          // If finish was called, we're done
          if (toolName === "finish") {
            break;
          }
        }

        const finishCall = toolCalls.find((tc) => tc.function.name === "finish");
        if (finishCall) {
          break;
        }
      }

      // 5. Extract changed files
      const filesChanged = this.getChangedFiles(workDir);
      log.info(`Files changed: ${filesChanged.length}`);

      // 6. Extract summary
      const summary = this.extractSummary(messages, toolLog);

      // 7. Extract knowledge from completed work
      await this.extractKnowledge(issue, messages, filesChanged, workDir);

      // Cleanup
      try { if (existsSync(taskPath)) unlinkSync(taskPath); } catch {}

      return { summary, filesChanged };
    } finally {
      clearTimeout(timer);
    }
  }

  async fixReviewFindings(instructions: string, workDir: string): Promise<CodeAgentResult> {
    log.info(`Fixing review findings...`);

    const fixPath = join(workDir, "REVIEW_FIXES.md");
    writeFileSync(fixPath, instructions, "utf-8");

    const systemPrompt = this.buildSystemPrompt(
      { number: 0, title: "Review Fixes", description: `Fix the issues in REVIEW_FIXES.md.\n\n## Rules\n- Follow existing code patterns and conventions\n- Use TypeScript strict mode\n- Run tests to verify nothing broke\n- Delete REVIEW_FIXES.md when done`, comments: [], labels: [] },
      "Fix all the issues listed in REVIEW_FIXES.md. Read the file, apply the fixes, run tests to verify."
    );

    const result = await this.runCodingLoop(systemPrompt, workDir);

    try { if (existsSync(fixPath)) unlinkSync(fixPath); } catch {}

    return result;
  }

  async fixTests(failures: string, workDir: string): Promise<CodeAgentResult> {
    log.info(`Fixing test failures...`);

    const failPath = join(workDir, "TEST_FAILURES.md");
    writeFileSync(failPath, `# Test Failures\n\nFix these test failures. Do NOT change the test expectations - fix the source code to make the tests pass:\n\n\`\`\`\n${failures.slice(0, 3000)}\n\`\`\``, "utf-8");

    const systemPrompt = this.buildSystemPrompt(
      { number: 0, title: "Test Fix", description: `Fix the test failures in TEST_FAILURES.md. Do NOT change the test expectations - fix the source code to make the tests pass.\n\nRun \`npm test\` to verify all tests pass.\n\nDelete TEST_FAILURES.md when done.`, comments: [], labels: [] },
      "Read TEST_FAILURES.md. Fix the source code to make tests pass. Do NOT change test expectations. Run npm test to verify. Delete TEST_FAILURES.md when done."
    );

    const result = await this.runCodingLoop(systemPrompt, workDir);

    try { if (existsSync(failPath)) unlinkSync(failPath); } catch {}

    return result;
  }

  // ---------------------------------------------------------------------
  // Core coding loop (shared between solve, fixReviewFix, fixTests)
  // ---------------------------------------------------------------------

  private async runCodingLoop(systemPrompt: string, workDir: string): Promise<CodeAgentResult> {
    const messages: OpenRouterMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: "Start by reading the necessary files to understand the codebase, then implement the changes. Use the available tools." },
    ];

    let iteration = 0;
    const toolLog: string[] = [];

    while (iteration < this.maxIterations) {
      iteration++;

      const response = await this.callOpenRouter(messages);

      const toolCalls = response.tool_calls;
      if (!toolCalls || toolCalls.length === 0) {
        if (response.content) {
          messages.push({ role: "assistant", content: response.content });
        }
        messages.push({ role: "user", content: "If you have more work to do, continue using the tools. If you're done, call finish." });
        continue;
      }

      messages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: toolCalls,
      });

      for (const tc of toolCalls) {
        let toolArgs: Record<string, string>;
        try { toolArgs = JSON.parse(tc.function.arguments); } catch { toolArgs = {}; }

        const result = await this.executeTool(tc.function.name, toolArgs, workDir);
        toolLog.push(`${tc.function.name}`);

        messages.push({
          role: "tool",
          content: result.output,
          name: tc.function.name,
          tool_call_id: tc.id,
        });

        if (tc.function.name === "finish") break;
      }

      if (toolCalls.find((tc) => tc.function.name === "finish")) break;
    }

    const filesChanged = this.getChangedFiles(workDir);
    const summary = this.extractSummary(messages, toolLog);
    return { summary, filesChanged };
  }

  // ---------------------------------------------------------------------
  // OpenRouter API call
  // ---------------------------------------------------------------------

  private async callOpenRouter(messages: OpenRouterMessage[]): Promise<{
    content: string;
    tool_calls?: Array<{
      id: string;
      type: string;
      function: { name: string; arguments: string };
    }>;
  }> {
    // Truncate messages to stay under 1M token limit (rough: cap each message to ~50000 chars)
    const safeMessages = messages.map((m) => ({
      ...m,
      content: m.content.length > 50000 ? `[truncated] ${m.content.slice(0, 50000)}` : m.content,
    }));

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/steve/tierzero",
        "X-Title": "TierZero",
      },
      body: JSON.stringify({
        model: this.model,
        messages: safeMessages,
        tools: CODE_EXECUTION_TOOLS,
        max_tokens: 8192,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter API ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice) {
      throw new Error("No response from model");
    }

    return {
      content: choice.message?.content || "",
      tool_calls: choice.message?.tool_calls || undefined,
    };
  }

  // ---------------------------------------------------------------------
  // Tool execution
  // ---------------------------------------------------------------------

  private async executeTool(
    name: string,
    args: Record<string, string>,
    workDir: string,
  ): Promise<{ ok: boolean; output: string }> {
    try {
      switch (name) {
        case "read_file": {
          const filePath = join(workDir, args.path);
          if (!existsSync(filePath)) {
            return { ok: false, output: `File not found: ${args.path}` };
          }
          const content = readFileSync(filePath, "utf-8");
          const maxOutput = 30000;
          return {
            ok: true,
            output: content.length > maxOutput
              ? `${content.slice(0, maxOutput)}\n\n[...truncated, ${content.length - maxOutput} more chars]`
              : content,
          };
        }

        case "write_file": {
          const filePath = join(workDir, args.path);
          // Create parent dirs if needed
          const { mkdirSync } = await import("node:fs");
          const { dirname } = await import("node:path");
          const dir = dirname(filePath);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

          writeFileSync(filePath, args.content, "utf-8");
          return { ok: true, output: `Wrote ${args.path} (${args.content.length} bytes)` };
        }

        case "run_command": {
          const cmd = args.command;
          if (!cmd) return { ok: false, output: "No command specified" };

          // Security: prevent dangerous commands
          const dangerPatterns = [
            /\brm\s+(-rf?|--recursive)\s/i,
            /\bpkill\b/,
            /\btaskkill\b/,
            /\bdel\s+\/f/i,
            /\bformat\b/,
            /mkfs/,
            /\bbb\s/i,
          ];
          for (const pattern of dangerPatterns) {
            if (pattern.test(cmd)) {
              return { ok: false, output: `Blocked dangerous command: ${cmd}` };
            }
          }

          try {
            const output = execSync(cmd, {
              cwd: workDir,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 120000, // 2 min per command
              env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            });
            const maxOutput = 30000;
            return {
              ok: true,
              output: output.length > maxOutput
                ? output.slice(0, maxOutput) + `\n\n[...truncated, ${output.length - maxOutput} more chars]`
                : output || "(empty output)",
            };
          } catch (err: any) {
            const stdout = err.stdout || "";
            const stderr = err.stderr || "";
            const combined = `${stdout}\n${stderr}`.trim();
            return {
              ok: false,
              output: `Command exited with code ${err.status ?? err.exitCode}\n${combined.slice(0, 30000)}` || `Command exited with code ${err.status ?? err.exitCode}`,
            };
          }
        }

        case "finish": {
          return { ok: true, output: "Task completed. Summary provided in arguments." };
        }

        default:
          return { ok: false, output: `Unknown tool: ${name}` };
      }
    } catch (err: any) {
      return { ok: false, output: `Tool error: ${err.message}` };
    }
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private isConclusive(content: string): boolean {
    const lower = content.toLowerCase();
    const conclusivePhrases = [
      "is complete",
      "is done",
      "has been completed",
      "i have finished",
      "i've finished",
      "i'm done",
      "summary of",
      "all tests pass",
      "implementation complete",
    ];
    return conclusivePhrases.some((phrase) => lower.includes(phrase));
  }

  private buildSystemPrompt(issue: IssueContext, taskDirective?: string): string {
    const sections = [
      "You are an expert full-stack TypeScript developer working inside TierZero, an autonomous code agent for GitHub issues.",
      "",
      "## Available Tools",
      "",
      "- **read_file(path)**: Read a file's contents",
      "- **write_file(path, content)**: Write content to a file (creates parent dirs automatically)",
      "- **run_command(command)**: Run a shell command (for git, npm test, etc). Never use for file operations.",
      "- **finish(summary)**: Call this when all tasks are complete with a brief summary",
      "",
      "## Workflow",
      "",
      "1. Always START by reading relevant source files to understand the codebase",
      "2. Plan your changes mentally before writing",
      "3. Make changes incrementally, running tests after each significant change",
      "4. Fix any test failures by updating source code (NEVER change test expectations)",
      "5. When everything works and tests pass, call finish() with your summary",
      "",
      "## Rules",
      "- NEVER modify test expectations - fix source code only",
      "- ALWAYS run `npm test` (or `npm run build` for compile checks) before finishing",
      "- Use TypeScript strict mode",
      "- Follow existing code conventions and patterns",
      "- Do NOT add new dependencies unless absolutely necessary",
      "- If a file doesn't exist, create it (write_file creates parent dirs automatically)",
      "- Output must be concise when using tools",
      "",
      `## Task: Issue #${issue.number} - ${issue.title}`,
      "",
      "## Description",
      issue.description,
      "",
    ];

    if (issue.comments.length > 0) {
      sections.push("## Discussion", ...issue.comments.map((c) => `> ${c}`), "");
    }

    if (issue.labels.length > 0) {
      sections.push(`## Labels: ${issue.labels.join(", ")}`, "");
    }

    if (taskDirective) {
      sections.push("## Instructions", taskDirective, "");
    }

    return sections.join("\n");
  }

  private buildTaskFile(issue: IssueContext, priorKnowledge: KnowledgeEntry[] = []): string {
    const sections = [
      `# TASK: Issue #${issue.number} - ${issue.title}`,
      "",
      "## Description",
      issue.description,
      "",
    ];

    if (issue.comments.length > 0) {
      sections.push("## Discussion", ...issue.comments.map((c) => `> ${c}`), "");
    }

    if (issue.labels.length > 0) {
      sections.push(`## Labels: ${issue.labels.join(", ")}`, "");
    }

    if (priorKnowledge.length > 0) {
      sections.push("## Prior Knowledge", "");
      for (const entry of priorKnowledge) {
        sections.push(
          `### ${entry.title} (confidence: ${entry.confidence.toFixed(2)}, used ${entry.usageCount} times)`,
          entry.content,
          ""
        );
      }
    }

    sections.push(
      "## Rules",
      "- Start by reading source files to understand the codebase",
      "- Make changes incrementally, testing after each change",
      "- Run `npm test` to verify all tests pass",
      "- Do NOT modify test expectations - fix source code only",
      "- Use TypeScript strict mode",
      "- Follow existing code patterns and conventions",
      "- Do NOT add dependencies unless absolutely necessary",
      ""
    );

    return sections.join("\n");
  }

  private async searchPriorKnowledge(issue: IssueContext): Promise<KnowledgeEntry[]> {
    if (!this.knowledgeStore) return [];
    try {
      const query = `${issue.title} ${issue.description.slice(0, 500)}`;
      const entries = await this.knowledgeStore.search(query, { limit: 5, minConfidence: 0.5 });
      for (const entry of entries) {
        await this.knowledgeStore.recordUsage(entry.id);
      }
      return entries;
    } catch (err) {
      log.error(`Knowledge search failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async extractKnowledge(
    issue: IssueContext,
    messages: OpenRouterMessage[],
    filesChanged: string[],
    workDir: string
  ): Promise<void> {
    if (!this.knowledgeExtractor || !this.knowledgeStore) return;
    try {
      let gitDiff = "";
      try {
        gitDiff = execSync("git diff", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).slice(0, 5000);
      } catch {}

      const lastAssistantMsg = [...messages].reverse().find(
        (m) => m.role === "assistant" && m.content.length > 20
      );

      const context: ExtractionContext = {
        taskId: `issue-${issue.number}`,
        taskTitle: issue.title,
        taskDescription: issue.description,
        agentName: "qwen-3.6-plus",
        gitDiff,
        agentOutput: lastAssistantMsg?.content.slice(-2000) ?? "",
        filesModified: filesChanged,
      };

      const entries = await this.knowledgeExtractor.extract(context);
      for (const entry of entries) {
        await this.knowledgeStore.add(entry);
      }
      if (entries.length > 0) {
        log.info(`Extracted ${entries.length} knowledge entries`);
      }
    } catch (err) {
      log.error(`Knowledge extraction failed: ${(err as Error).message}`);
    }
  }

  private getChangedFiles(workDir: string): string[] {
    try {
      const staged = execSync("git diff --name-only", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      return [...staged.split("\n"), ...untracked.split("\n")].filter(Boolean);
    } catch {
      return [];
    }
  }

  private extractSummary(messages: OpenRouterMessage[], toolLog: string[]): string {
    // Look for finish summary in tool call arguments
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.tool_calls) {
        const finishCall = m.tool_calls.find((tc) => tc.function.name === "finish");
        if (finishCall) {
          try {
            const args = JSON.parse(finishCall.function.arguments);
            if (args.summary) return `Qwen completed: ${args.summary}`;
          } catch {}
        }
      }
    }

    // Fallback: last assistant message content
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].content.length > 20) {
        const content = messages[i].content;
        return content.length > 800 ? content.slice(-800) : content;
      }
    }

    return `Qwen processed: ${toolLog.join(" -> ")}`;
  }
}
