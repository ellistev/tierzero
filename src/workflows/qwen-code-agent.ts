/**
 * QwenCodeAgent - Autonomous coding agent powered by Qwen 3.6 Plus.
 *
 * Full agentic loop: reads files → plans → writes code → runs tests → fixes failures → commits.
 * Zero Claude dependency. Zero API cost (Qwen free tier on OpenRouter).
 *
 * Architecture:
 * 1. Receives GitHub issue, creates spec in TASK.md
 * 2. Creates git branch for the issue
 * 3. Enters tool-calling loop with Qwen (up to 50 turns):
 *    - Qwen reads files it needs
 *    - Qwen writes/edits source code
 *    - Qwen runs tests via run_command
 *    - Sees test output → iterates until green
 *    - Calls finish() when done
 * 4. Commits changes with a conventional commit message
 * 5. Cleans up, returns summary + changed files
 */

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./issue-pipeline";
import type { KnowledgeStore, KnowledgeEntry } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";
import { createLogger } from "../infra/logger";

const log = createLogger("qwen-code-agent");

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface QwenCodeAgentConfig {
  apiKey: string;
  /** OpenRouter model name */
  model?: string;
  /** Max tool-calling turns per solve() call */
  maxTurns?: number;
  /** Total timeout for solve() in ms */
  timeoutMs?: number;
  /** Knowledge store for retrieval */
  knowledgeStore?: KnowledgeStore;
  knowledgeExtractor?: KnowledgeExtractor;
  /** Git branch prefix (default: tierzero/) */
  branchPrefix?: string;
  /** Commit message template */
  commitTemplate?: string;
}

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
  name?: string;
}

interface ToolDef {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ---------------------------------------------------------------------------
// Tools available to Qwen
// ---------------------------------------------------------------------------

const TOOLS: ToolDef[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read the full contents of a file. Use this to understand existing code before making changes.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "File path relative to the project root" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write complete file contents. Creates parent directories if needed. Overwrites existing files.",
      parameters: {
        type: "object",
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "File path relative to the project root" },
          content: { type: "string", description: "Complete file content" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Execute a shell command. Use for running tests (npm test, npm run build), git operations, or exploring the project. Output is returned so you can see results.",
      parameters: {
        type: "object",
        required: ["command"],
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files in a directory. Use this to explore the project structure.",
      parameters: {
        type: "object",
        required: ["path"],
        properties: {
          path: { type: "string", description: "Directory path relative to project root (use '.' for root)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "finish",
      description: "Call this when ALL work is complete. The task is only done when tests pass and you're satisfied with the implementation.",
      parameters: {
        type: "object",
        required: ["summary"],
        properties: {
          summary: { type: "string", description: "Detailed summary of what you implemented: files created/modified, tests added, key decisions" },
        },
      },
    },
  },
];

// Dangerous command patterns - block these from Qwen
const DANGEROUS: RegExp[] = [
  /\brm\s+(-rf?|--recursive)\b/i,
  /\bpkill\b/,
  /\btaskkill\b/,
  /\bdel\s+(\/f|\/s|\/q)/i,
  /\bformat\b/i,
  /\bmkfs\b/,
  /\bbb\s\b/i,
  /\bsudo\b/,
  /\bdocker\b.*rm/i,
  /\bshred\b/,
];

// ---------------------------------------------------------------------------
// QwenCodeAgent
// ---------------------------------------------------------------------------

export class QwenCodeAgent implements CodeAgent {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTurns: number;
  private readonly timeoutMs: number;
  private readonly knowledgeStore: KnowledgeStore | null;
  private readonly knowledgeExtractor: KnowledgeExtractor | null;
  private readonly branchPrefix: string;
  private readonly commitTemplate: string;

  constructor(config: QwenCodeAgentConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "qwen/qwen3.6-plus:free";
    this.maxTurns = config.maxTurns ?? 50;
    this.timeoutMs = config.timeoutMs ?? 600_000;
    this.knowledgeStore = config.knowledgeStore ?? null;
    this.knowledgeExtractor = config.knowledgeExtractor ?? null;
    this.branchPrefix = config.branchPrefix ?? "tierzero/";
    this.commitTemplate = config.commitTemplate ?? "";
  }

  // =========================================================================
  // Public API: CodeAgent interface
  // =========================================================================

  async solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult> {
    const deadline = Date.now() + this.timeoutMs;
    log.info(`[qwen] Solving #${issue.number}: "${issue.title}" (${this.model})`);

    // 0. Search prior knowledge
    const priorKnowledge = await this.searchPriorKnowledge(issue);

    // 1. Read repo structure
    const repoLayout = this.exploreRepo(workDir);

    // 2. Write TASK.md
    const taskPath = join(workDir, "TASK.md");
    writeFileSync(taskPath, this.buildTaskContent(issue, priorKnowledge, repoLayout), "utf-8");

    // 3. Create git branch
    const branchName = `${this.branchPrefix}${issue.number}-${this.slugify(issue.title)}`;
    this.createBranch(branchName, workDir);
    log.info(`[qwen] Branch: ${branchName}`);

    // 4. Build initial messages
    const messages: ApiMessage[] = [
      { role: "system", content: this.systemPrompt() },
      {
        role: "user",
        content: [
          `You are working in: ${workDir}`,
          `The project structure is:\n${repoLayout}`,
          `A detailed task file (TASK.md) has been written for you.`,
          `Start by reading TASK.md and any source files you need, then implement the changes. Run tests to verify.`,
          priorKnowledge.length > 0
            ? `\nPrior relevant knowledge has been loaded below.\n\n## Prior Knowledge\n${priorKnowledge.map(e => `### ${e.title}\n${e.content}`).join("\n")}`
            : "",
        ].filter(Boolean).join("\n\n"),
      },
    ];

    // 5. Run the agentic loop
    const turnLog: string[] = [];
    let finished = false;

    for (let turn = 1; turn <= this.maxTurns && Date.now() < deadline; turn++) {
      const remaining = deadline - Date.now();
      if (remaining < 5_000) {
        log.warn(`[qwen] Time's up after ${turn} turns`);
        break;
      }

      const resp = await this.callAPI(messages, TOOLS);
      const toolCalls = resp.tool_calls ?? [];
      const content = resp.content ?? "";

      if (content && toolCalls.length === 0) {
        // Free text response (no tools). Add to history and continue.
        messages.push({ role: "assistant", content });
        // If it looks conclusive, stop the loop
        if (this.looksDone(content)) {
          log.info(`[qwen] Turn ${turn} - concluded: ${content.slice(0, 120)}`);
          break;
        }
        log.info(`[qwen] Turn ${turn} - text response (${content.length} chars)`);
        continue;
      }

      // Record assistant turn with tool calls
      messages.push({ role: "assistant", content: content || "", tool_calls: toolCalls });

      // Execute each tool call in parallel (they're independent per turn)
      for (const tc of toolCalls) {
        if (Date.now() > deadline - 5_000) break;

        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}

        const result = await this.executeTool(tc.function.name, args, workDir);
        turnLog.push(`${tc.function.name}(${this.truncate(JSON.stringify(args), 80)})`);
        log.info(`[qwen] Turn ${turn} -> ${tc.function.name} [${result.ok ? "ok" : "err"}]`);

        messages.push({
          role: "tool",
          content: result.output,
          tool_call_id: tc.id,
          name: tc.function.name,
        });

        if (tc.function.name === "finish") {
          finished = true;
          break;
        }
      }

      if (finished) break;
    }

    // 6. Commit any changes
    const filesChanged = this.getChangedFiles(workDir);
    let commitHash: string | null = null;
    if (filesChanged.length > 0) {
      const summary = this.extractFinalSummary(messages);
      commitHash = this.commitChanges(`feat: ${issue.title}\n\n${summary}\n\nCloses #${issue.number}`, workDir);
      log.info(`[qwen] Committed: ${commitHash}`);
    }

    // 7. Push branch
    if (commitHash) {
      this.pushBranch(branchName, workDir);
    }

    // 8. Extract knowledge
    await this.extractKnowledge(issue, messages, filesChanged, workDir);

    // 9. Cleanup
    try { if (existsSync(taskPath)) unlinkSync(taskPath); } catch {}

    return {
      summary: commitHash
        ? `Qwen implemented #${issue.number} in branch ${branchName} (${commitHash}). ${this.extractFinalSummary(messages).slice(0, 300)}`
        : `Qwen analyzed #${issue.number} - no code changes (${filesChanged.length} files modified, ${turnLog.length} tool calls)`,
      filesChanged,
    };
  }

  async fixTests(failures: string, workDir: string): Promise<CodeAgentResult> {
    log.info(`[qwen] Fixing test failures...`);

    const failPath = join(workDir, ".test-failures.txt");
    writeFileSync(failPath, failures.slice(0, 10000), "utf-8");

    const messages: ApiMessage[] = [
      { role: "system", content: this.systemPrompt() + "\n\nYou are in TEST FIX mode. Read the failures, fix SOURCE CODE only (never test files), run tests until green." },
      { role: "user", content: `Test failures are in .test-failures.txt. Read it. Fix the source code to make tests pass. NEVER change test expectations. Run npm test to verify. Delete .test-failures.txt when done.` },
    ];

    await this.runLoop(messages, workDir);

    try { if (existsSync(failPath)) unlinkSync(failPath); } catch {}

    const filesChanged = this.getChangedFiles(workDir);
    return { summary: `Qwen fixed tests. ${filesChanged.length} files changed.`, filesChanged };
  }

  async fixReviewFindings(instructions: string, workDir: string): Promise<CodeAgentResult> {
    log.info(`[qwen] Fixing review findings...`);

    const reviewPath = join(workDir, ".review-fixes.md");
    writeFileSync(reviewPath, instructions, "utf-8");

    const messages: ApiMessage[] = [
      { role: "system", content: this.systemPrompt() },
      { role: "user", content: `Review feedback is in .review-fixes.md. Read it, apply all fixes, run tests to verify nothing broke. Delete .review-fixes.md when done.` },
    ];

    await this.runLoop(messages, workDir);

    try { if (existsSync(reviewPath)) unlinkSync(reviewPath); } catch {}

    const filesChanged = this.getChangedFiles(workDir);
    return { summary: `Qwen applied review fixes. ${filesChanged.length} files changed.`, filesChanged };
  }

  // =========================================================================
  // Core loop (shared by fixTests and fixReviewFindings)
  // =========================================================================

  private async runLoop(messages: ApiMessage[], workDir: string): Promise<void> {
    const deadline = Date.now() + this.timeoutMs;

    for (let turn = 1; turn <= this.maxTurns && Date.now() < deadline; turn++) {
      const resp = await this.callAPI(messages, TOOLS);
      const toolCalls = resp.tool_calls ?? [];

      messages.push({ role: "assistant", content: resp.content || "", tool_calls: toolCalls.length ? toolCalls : undefined });

      let finished = false;
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}

        const result = await this.executeTool(tc.function.name, args, workDir);
        messages.push({ role: "tool", name: tc.function.name, content: result.output, tool_call_id: tc.id });

        if (tc.function.name === "finish") { finished = true; break; }
      }
      if (finished) break;

      if (!toolCalls.length && resp.content && this.looksDone(resp.content)) break;
    }
  }

  // =========================================================================
  // API Call
  // =========================================================================

  private async callAPI(messages: ApiMessage[], tools: ToolDef[]): Promise<{
    content: string | null;
    tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
  }> {
    // Prune old messages if context is huge (Qwen has 1M, but be reasonable)
    let safeMessages = messages;
    const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
    if (totalChars > 400_000) {
      // Keep: system + first user + last N messages
      safeMessages = [
        messages[0], // system
        messages[1], // initial user prompt
        { role: "user", content: `[Context pruned: ${totalChars - 400_000} chars removed to stay under limits. Continue from the tool results above.]` },
        ...messages.slice(-20), // last 20 messages
      ];
    }

    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        "HTTP-Referer": "https://github.com/ellistev/tierzero",
        "X-Title": "TierZero",
      },
      body: JSON.stringify({
        model: this.model,
        messages: safeMessages,
        tools,
        max_tokens: 8192,
        temperature: 0.2,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${body.slice(0, 500)}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice?.message) throw new Error("Empty response from model");

    return {
      content: choice.message.content ?? null,
      tool_calls: choice.message.tool_calls ?? undefined,
    };
  }

  // =========================================================================
  // Tool Execution
  // =========================================================================

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    workDir: string,
  ): Promise<{ ok: boolean; output: string }> {
    try {
      switch (name) {
        case "read_file": {
          const path = join(workDir, String(args.path));
          if (!existsSync(path)) return { ok: false, output: `File not found: ${args.path}` };
          const content = readFileSync(path, "utf-8");
          // Cap at 40K chars per file read
          const maxOutput = 40000;
          return {
            ok: true,
            output: content.length > maxOutput
              ? content.slice(0, maxOutput) + `\n\n[...truncated, ${content.length - maxOutput} more chars]`
              : content,
          };
        }

        case "write_file": {
          const path = join(workDir, String(args.path));
          const content = String(args.content ?? "");
          const dir = dirname(path);
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          writeFileSync(path, content, "utf-8");
          return { ok: true, output: `Wrote ${args.path} (${content.length} bytes, ${content.split("\n").length} lines)` };
        }

        case "list_dir": {
          const path = join(workDir, String(args.path || "."));
          try {
            const out = execSync(`ls -1a "${path}"`, { cwd: workDir, encoding: "utf-8", stdio: "pipe", timeout: 10000 });
            return { ok: true, output: out.trim() || "(empty directory)" };
          } catch (e: any) {
            return { ok: false, output: `Error listing directory: ${e.message}` };
          }
        }

        case "run_command": {
          const cmd = String(args.command ?? "").trim();
          if (!cmd) return { ok: false, output: "No command specified." };

          // Block dangerous commands
          for (const pattern of DANGEROUS) {
            if (pattern.test(cmd)) return { ok: false, output: `Blocked dangerous command: ${cmd}` };
          }

          try {
            const output = execSync(cmd, {
              cwd: workDir,
              encoding: "utf-8",
              stdio: ["pipe", "pipe", "pipe"],
              timeout: 120000,
              env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
            });
            const maxOutput = 40000;
            return {
              ok: output.length < maxOutput,
              output: output.length > maxOutput
                ? output.slice(0, maxOutput) + `\n\n[...truncated, ${output.length - maxOutput} more chars]`
                : output || "(empty output)",
            };
          } catch (e: any) {
            const stdout = e.stdout ?? "";
            const stderr = e.stderr ?? "";
            const combined = (stdout + "\n" + stderr).trim();
            return {
              ok: false,
              output: `Exit code: ${e.status ?? e.exitCode}\n${combined.slice(0, 40000) || `Command exited with code ${e.status ?? e.exitCode}`}`,
            };
          };
        }

        case "finish": {
          return { ok: true, output: "Task complete. Summary recorded." };
        }

        default:
          return { ok: false, output: `Unknown tool: ${name}. Available: read_file, write_file, run_command, list_dir, finish` };
      }
    } catch (err: any) {
      return { ok: false, output: `Tool execution error: ${err.message}` };
    }
  }

  // =========================================================================
  // Git Helpers
  // =========================================================================

  private createBranch(branchName: string, workDir: string): void {
    // Make sure we're on main and pull latest
    try { execSync("git checkout main && git pull", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }); } catch {}
    try {
      // Try to create and switch
      execSync(`git checkout -b ${branchName}`, { cwd: workDir, encoding: "utf-8", stdio: "pipe" });
    } catch {
      // Branch might exist from a previous run - delete and recreate
      try { execSync(`git branch -D ${branchName}`, { cwd: workDir, encoding: "utf-8", stdio: "pipe" }); } catch {}
      execSync(`git checkout -b ${branchName}`, { cwd: workDir, encoding: "utf-8", stdio: "pipe" });
    }
  }

  private pushBranch(branchName: string, workDir: string): void {
    try {
      execSync(`git push -u origin ${branchName}`, { cwd: workDir, encoding: "utf-8", stdio: "pipe" });
      log.info(`[qwen] Pushed branch: ${branchName}`);
    } catch (e: any) {
      log.warn(`[qwen] Push failed (may be OK): ${e.message?.slice(0, 200)}`);
    }
  }

  private commitChanges(message: string, workDir: string): string | null {
    try {
      execSync("git add -A", { cwd: workDir, encoding: "utf-8", stdio: "pipe" });
      const status = execSync("git status --porcelain", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      if (!status) return null;

      // Write commit message to temp file for safe multiline handling
      const msgFile = join(workDir, ".tz-commit-msg.txt");
      writeFileSync(msgFile, message, "utf-8");
      execSync(`git commit -F "${msgFile}"`, { cwd: workDir, encoding: "utf-8", stdio: "pipe" });
      try { unlinkSync(msgFile); } catch {}

      return execSync("git rev-parse --short HEAD", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
    } catch (e: any) {
      log.warn(`[qwen] Commit failed: ${e.message?.slice(0, 200)}`);
      return null;
    }
  }

  private getChangedFiles(workDir: string): string[] {
    try {
      const staged = execSync("git diff --name-only HEAD", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      return [...staged.split("\n"), ...untracked.split("\n")].filter(Boolean);
    } catch {
      return [];
    }
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  private systemPrompt(): string {
    return [
      "You are an elite autonomous coding agent. You think, plan, and write code without human intervention.",
      "",
      "## Your Tools",
      "",
      "- **read_file(path)**: Read a file. ALWAYS read relevant files before changing them.",
      "- **write_file(path, content)**: Write complete file contents. Creates directories. Overwrites existing.",
      "- **run_command(command)**: Run ANY shell command. Use this for tests, git, npm, etc.",
      "- **list_dir(path)**: List directory contents. Use '.' for root.",
      "- **finish(summary)**: Call when ALL work is done. Tests MUST pass.",
      "",
      "## Workflow",
      "",
      "1. **READ FIRST**: Before TOUCHING any code, read the relevant source files to understand the current architecture.",
      "2. **PLAN**: Think about what changes are needed. Consider edge cases.",
      "3. **WRITE FILES**: Make your changes. Write complete file content, not diffs.",
      "4. **TEST**: Run `npm test` (or whatever the test command is). Read the output carefully.",
      "5. **FIX**: If tests fail, READ the failures, fix the code, re-run tests. Repeat until green.",
      "6. **FINISH**: Only call finish() when all tests pass. Include a detailed summary.",
      "",
      "## Hard Rules",
      "",
      "- NEVER call finish() until tests pass (run them first!)",
      "- NEVER modify test files or change test expectations (unless the task explicitly asks for adding NEW tests)",
      "- NEVER add new npm dependencies without strong justification",
      "- ALWAYS read files before modifying them",
      "- Write complete file contents with write_file (not partial edits)",
      "- Use TypeScript strict mode",
      "- Follow the existing code style and patterns",
      "- If you don't know something, READ the file first - don't guess file contents",
      "- Tool output has limits: keep command output under ~40K chars",
      "",
    ].join("\n");
  }

  private buildTaskContent(issue: IssueContext, priorKnowledge: KnowledgeEntry[], repoLayout: string): string {
    const sections = [
      `# TASK: Issue #${issue.number} - ${issue.title}`,
      "",
      "## Description",
      issue.description,
      "",
    ];

    if (issue.comments.length > 0) {
      sections.push("## Discussion", ...issue.comments.map(c => `> ${c}`), "");
    }

    if (issue.labels.length > 0) {
      sections.push(`## Labels: ${issue.labels.join(", ")}`, "");
    }

    if (priorKnowledge.length > 0) {
      sections.push("## Prior Relevant Knowledge", "");
      for (const entry of priorKnowledge) {
        sections.push(`### ${entry.title} (confidence: ${entry.confidence.toFixed(2)})`, entry.content, "");
      }
    }

    sections.push(
      "## Acceptance Criteria",
      "- Task is complete when all requirements described above are met",
      "- All existing tests pass (run `npm test`)",
      "- New tests are added for new functionality",
      "- Code follows existing patterns and conventions",
      "",
      "## Important",
      "- Start by reading relevant source files",
      "- NEVER change test expectations - fix source code only",
      "- Use node:test for testing (import { describe, it } from 'node:test')",
      "- Use node:assert/strict for assertions",
      "",
    );

    return sections.join("\n");
  }

  private exploreRepo(workDir: string): string {
    try {
      return execSync("find . -maxdepth 3 -not -path '*/node_modules/*' -not -path '*/.git/*' -not -path './.next/*' | head -200", {
        cwd: workDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
    } catch {
      return "(could not explore repo)";
    }
  }

  private searchPriorKnowledge(issue: IssueContext): Promise<KnowledgeEntry[]> {
    if (!this.knowledgeStore) return Promise.resolve([]);
    return this.knowledgeStore.search(`${issue.title} ${issue.description.slice(0, 500)}`, { limit: 5, minConfidence: 0.5 })
      .then(async entries => {
        for (const e of entries) await this.knowledgeStore!.recordUsage(e.id);
        return entries;
      })
      .catch(() => [] as KnowledgeEntry[]);
  }

  private async extractKnowledge(
    issue: IssueContext,
    messages: ApiMessage[],
    filesChanged: string[],
    workDir: string,
  ): Promise<void> {
    if (!this.knowledgeExtractor || !this.knowledgeStore) return;
    try {
      let gitDiff = "";
      try { gitDiff = execSync("git diff main", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).slice(0, 5000); } catch {}

      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.content.length > 50);
      const context: ExtractionContext = {
        taskId: `issue-${issue.number}`,
        taskTitle: issue.title,
        taskDescription: issue.description,
        agentName: "qwen-3.6-plus",
        gitDiff,
        agentOutput: lastAssistant?.content.slice(-2000) ?? "",
        filesModified: filesChanged,
      };

      const entries = await this.knowledgeExtractor.extract(context);
      for (const e of entries) await this.knowledgeStore!.add(e);
      if (entries.length > 0) log.info(`[qwen] Extracted ${entries.length} knowledge entries`);
    } catch (err) {
      log.error(`[qwen] Knowledge extraction failed: ${(err as Error).message}`);
    }
  }

  private extractFinalSummary(messages: ApiMessage[]): string {
    // Look for finish call with summary
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i];
      if (m.role === "assistant" && m.tool_calls) {
        const finishCall = m.tool_calls.find(tc => tc.function.name === "finish");
        if (finishCall) {
          try { return JSON.parse(finishCall.function.arguments).summary ?? ""; } catch {}
        }
      }
    }
    // Fallback: last meaningful assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant" && messages[i].content.length > 30) {
        return messages[i].content.slice(0, 500);
      }
    }
    return "(no summary available)";
  }

  private looksDone(content: string): boolean {
    const lower = content.toLowerCase();
    return [
      "is complete", "all done", "i'm done", "i am done",
      "has been completed", "implementation is complete",
      "everything is working", "task complete",
      "ready for review", "all tests pass",
    ].some(p => lower.includes(p));
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 50);
  }

  private truncate(str: string, max: number): string {
    return str.length > max ? str.slice(0, max) + "..." : str;
  }
}
