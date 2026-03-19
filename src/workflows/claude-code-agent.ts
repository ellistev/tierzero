/**
 * Claude Code CodeAgent implementation.
 * 
 * Uses Claude Code CLI (claude --permission-mode bypassPermissions --print)
 * to solve GitHub issues. Zero API cost via Max subscription OAuth.
 * 
 * Flow:
 * 1. Write TASK.md with issue context + acceptance criteria
 * 2. Shell out to Claude Code with a short prompt referencing TASK.md
 * 3. Read git diff to determine what files changed
 * 4. Return summary + changed files
 */

import { execSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./issue-pipeline";
import type { KnowledgeStore, KnowledgeEntry } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";

export interface ClaudeCodeAgentConfig {
  /** Path to claude CLI (default: auto-detect) */
  claudePath?: string;
  /** Timeout for Claude Code execution in ms (default: 600000 = 10min) */
  timeoutMs?: number;
  /** Additional context to include in TASK.md */
  extraContext?: string;
  /** Knowledge store for prior knowledge injection */
  knowledgeStore?: KnowledgeStore;
  /** Knowledge extractor for post-task learning */
  knowledgeExtractor?: KnowledgeExtractor;
}

export class ClaudeCodeAgent implements CodeAgent {
  private readonly claudePath: string;
  private readonly timeoutMs: number;
  private readonly extraContext: string;
  private readonly knowledgeStore: KnowledgeStore | null;
  private readonly knowledgeExtractor: KnowledgeExtractor | null;

  constructor(config: ClaudeCodeAgentConfig = {}) {
    this.claudePath = config.claudePath ?? "claude";
    this.timeoutMs = config.timeoutMs ?? 600_000;
    this.extraContext = config.extraContext ?? "";
    this.knowledgeStore = config.knowledgeStore ?? null;
    this.knowledgeExtractor = config.knowledgeExtractor ?? null;
  }

  async solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult> {
    // 1. Search for prior knowledge
    const priorKnowledge = await this.searchPriorKnowledge(issue);

    // 2. Write TASK.md (with prior knowledge if available)
    const taskPath = join(workDir, "TASK.md");
    const taskContent = this.buildTaskFile(issue, priorKnowledge);
    writeFileSync(taskPath, taskContent, "utf-8");

    try {
      // 3. Run Claude Code
      console.log(`[claude-code-agent] Solving issue #${issue.number}: ${issue.title}`);
      console.log(`[claude-code-agent] TASK.md written (${taskContent.length} chars)`);
      if (priorKnowledge.length > 0) {
        console.log(`[claude-code-agent] Injected ${priorKnowledge.length} prior knowledge entries`);
      }

      const prompt = "Read TASK.md. Implement everything described. Run tests and make sure they pass. Do NOT modify any existing test files unless the task specifically requires it. Delete TASK.md when done.";

      const output = await this.runClaude(prompt, workDir);

      // 4. Get changed files from git
      const filesChanged = this.getChangedFiles(workDir);
      console.log(`[claude-code-agent] Files changed: ${filesChanged.length}`);

      // 5. Extract summary from output (last meaningful paragraph)
      const summary = this.extractSummary(output, issue);

      // 6. Extract knowledge from completed work
      await this.extractKnowledge(issue, output, filesChanged, workDir);

      return { summary, filesChanged };

    } finally {
      // Clean up TASK.md if Claude didn't delete it
      try { if (existsSync(taskPath)) unlinkSync(taskPath); } catch { /* ok */ }
    }
  }

  async fixTests(failures: string, workDir: string): Promise<CodeAgentResult> {
    console.log(`[claude-code-agent] Fixing test failures...`);

    // Write failures to a temp file to avoid shell escaping issues
    const failPath = join(workDir, "TEST_FAILURES.md");
    writeFileSync(failPath, `# Test Failures\n\nFix these test failures. Do NOT change the test expectations - fix the source code to make the tests pass:\n\n\`\`\`\n${failures.slice(0, 3000)}\n\`\`\``, "utf-8");

    const prompt = "Read TEST_FAILURES.md. Fix the source code to make tests pass. Do NOT change test expectations. Run npm test to verify. Delete TEST_FAILURES.md when done.";

    let output = "";
    try {
      output = await this.runClaude(prompt, workDir);
    } finally {
      try { if (existsSync(failPath)) unlinkSync(failPath); } catch { /* ok */ }
    }

    const filesChanged = this.getChangedFiles(workDir);
    return {
      summary: `Claude Code fix attempt: ${filesChanged.length} files modified`,
      filesChanged,
    };
  }

  /**
   * Run Claude Code CLI asynchronously using spawn (not execSync).
   * execSync blocks the event loop and can crash the parent process
   * on non-zero exit codes in some environments.
   */
  private runClaude(prompt: string, workDir: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Write prompt to a temp file to avoid shell escaping issues entirely
      const promptPath = join(workDir, ".claude-prompt.txt");
      writeFileSync(promptPath, prompt, "utf-8");

      const args = [
        "--permission-mode", "bypassPermissions",
        "--print",
        prompt,
      ];

      // Resolve full path to claude binary to avoid shell lookup issues
      let claudeExe = this.claudePath;
      try {
        claudeExe = execSync(`where.exe ${this.claudePath}`, { encoding: "utf-8" }).trim().split("\n")[0].trim();
      } catch {
        // Fall back to configured path
      }
      console.log(`[claude-code-agent] Spawning: ${claudeExe} (shell: false, cwd: ${workDir})`);

      const child = spawn(claudeExe, args, {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
        detached: true,
        windowsHide: true,
      });

      console.log(`[claude-code-agent] Child spawned, pid: ${child.pid}`);

      const chunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString();
        chunks.push(text);
        // Stream output in real-time
        process.stdout.write(text);
      });

      child.stderr.on("data", (buf: Buffer) => {
        stderrChunks.push(buf.toString());
      });

      const timer = setTimeout(() => {
        console.error(`[claude-code-agent] Timed out after ${this.timeoutMs}ms, killing pid ${child.pid}`);
        // On Windows, child.kill() doesn't work for detached processes
        // Use taskkill to kill the entire process tree
        try {
          execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: "pipe" });
        } catch {
          // Process may already be dead
          try { child.kill("SIGKILL"); } catch { /* ok */ }
        }
        const output = chunks.join("");
        // Resolve with whatever output we got - agent may have made changes
        resolve(output);
      }, this.timeoutMs);

      child.on("close", (code) => {
        clearTimeout(timer);
        const output = chunks.join("");
        const stderr = stderrChunks.join("");

        // Clean up prompt file
        try { if (existsSync(promptPath)) unlinkSync(promptPath); } catch { /* ok */ }

        if (code !== 0) {
          console.log(`[claude-code-agent] Exit code: ${code}`);
          if (stderr) {
            console.error(`[claude-code-agent] stderr: ${stderr.slice(0, 500)}`);
          }
        }

        console.log(`[claude-code-agent] Claude Code finished (exit ${code}), output length: ${output.length}`);
        // Always resolve - Claude Code may exit non-zero but still produce changes
        resolve(output);
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        console.error(`[claude-code-agent] Spawn error: ${err.message}`);
        resolve(""); // Don't reject - let pipeline continue and check git diff
      });
    });
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

    if (this.extraContext) {
      sections.push("## Additional Context", this.extraContext, "");
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
      "- Follow existing code patterns and conventions",
      "- Use TypeScript strict mode",
      "- Use node:test for testing (import { describe, it } from 'node:test')",
      "- Use node:assert/strict for assertions",
      "- Run `npm test` to verify all tests pass",
      "- Do NOT add new dependencies without explicit justification",
      "- Do NOT modify existing test files unless the task requires it",
      ""
    );

    return sections.join("\n");
  }

  private async searchPriorKnowledge(issue: IssueContext): Promise<KnowledgeEntry[]> {
    if (!this.knowledgeStore) return [];
    try {
      const query = `${issue.title} ${issue.description.slice(0, 500)}`;
      const entries = await this.knowledgeStore.search(query, { limit: 5, minConfidence: 0.5 });
      // Record usage for each entry returned
      for (const entry of entries) {
        await this.knowledgeStore.recordUsage(entry.id);
      }
      return entries;
    } catch (err) {
      console.error(`[claude-code-agent] Knowledge search failed: ${(err as Error).message}`);
      return [];
    }
  }

  private async extractKnowledge(
    issue: IssueContext,
    agentOutput: string,
    filesChanged: string[],
    workDir: string
  ): Promise<void> {
    if (!this.knowledgeExtractor || !this.knowledgeStore) return;
    try {
      let gitDiff = "";
      try {
        gitDiff = execSync("git diff", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).slice(0, 5000);
      } catch { /* ok */ }

      const context: ExtractionContext = {
        taskId: `issue-${issue.number}`,
        taskTitle: issue.title,
        taskDescription: issue.description,
        agentName: "claude-code",
        gitDiff,
        agentOutput: agentOutput.slice(-2000),
        filesModified: filesChanged,
      };

      const entries = await this.knowledgeExtractor.extract(context);
      for (const entry of entries) {
        await this.knowledgeStore.add(entry);
      }
      if (entries.length > 0) {
        console.log(`[claude-code-agent] Extracted ${entries.length} knowledge entries`);
      }
    } catch (err) {
      console.error(`[claude-code-agent] Knowledge extraction failed: ${(err as Error).message}`);
    }
  }

  private getChangedFiles(workDir: string): string[] {
    try {
      const staged = execSync("git diff --name-only", {
        cwd: workDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard", {
        cwd: workDir, encoding: "utf-8", stdio: "pipe",
      }).trim();
      return [...staged.split("\n"), ...untracked.split("\n")].filter(Boolean);
    } catch {
      return [];
    }
  }

  private extractSummary(output: string, issue: IssueContext): string {
    // Try to find a summary section in Claude's output
    const lines = output.split("\n").filter((l) => l.trim().length > 0);
    if (lines.length === 0) {
      return `Claude Code processed issue #${issue.number}: ${issue.title}`;
    }

    // Take last ~500 chars as summary (Claude typically summarizes at the end)
    const tail = lines.slice(-10).join("\n");
    if (tail.length > 500) return tail.slice(-500);
    return tail || `Claude Code processed issue #${issue.number}`;
  }
}
