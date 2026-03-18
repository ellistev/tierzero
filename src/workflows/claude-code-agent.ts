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

import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./issue-pipeline";

export interface ClaudeCodeAgentConfig {
  /** Path to claude CLI (default: auto-detect) */
  claudePath?: string;
  /** Timeout for Claude Code execution in ms (default: 600000 = 10min) */
  timeoutMs?: number;
  /** Additional context to include in TASK.md */
  extraContext?: string;
}

export class ClaudeCodeAgent implements CodeAgent {
  private readonly claudePath: string;
  private readonly timeoutMs: number;
  private readonly extraContext: string;

  constructor(config: ClaudeCodeAgentConfig = {}) {
    this.claudePath = config.claudePath ?? "claude";
    this.timeoutMs = config.timeoutMs ?? 600_000;
    this.extraContext = config.extraContext ?? "";
  }

  async solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult> {
    // 1. Write TASK.md
    const taskPath = join(workDir, "TASK.md");
    const taskContent = this.buildTaskFile(issue);
    writeFileSync(taskPath, taskContent, "utf-8");

    try {
      // 2. Run Claude Code
      console.log(`[claude-code-agent] Solving issue #${issue.number}: ${issue.title}`);
      console.log(`[claude-code-agent] TASK.md written (${taskContent.length} chars)`);

      const prompt = "Read TASK.md. Implement everything described. Run tests and make sure they pass. Do NOT modify any existing test files unless the task specifically requires it. Delete TASK.md when done.";

      let output = "";
      try {
        output = execSync(
          `${this.claudePath} --permission-mode bypassPermissions --print "${prompt.replace(/"/g, '\\"')}"`,
          {
            cwd: workDir,
            encoding: "utf-8",
            stdio: "pipe",
            timeout: this.timeoutMs,
            env: { ...process.env, FORCE_COLOR: "0" },
          }
        );
      } catch (err: unknown) {
        // Claude Code may exit non-zero but still produce changes
        const execErr = err as { stdout?: string; stderr?: string; status?: number };
        output = execErr.stdout ?? "";
        if (execErr.stderr) {
          console.error(`[claude-code-agent] stderr: ${execErr.stderr.slice(0, 500)}`);
        }
        console.log(`[claude-code-agent] Exit code: ${execErr.status}`);
      }

      // 3. Get changed files from git
      const filesChanged = this.getChangedFiles(workDir);
      console.log(`[claude-code-agent] Files changed: ${filesChanged.length}`);

      // 4. Extract summary from output (last meaningful paragraph)
      const summary = this.extractSummary(output, issue);

      return { summary, filesChanged };

    } finally {
      // Clean up TASK.md if Claude didn't delete it
      try { if (existsSync(taskPath)) unlinkSync(taskPath); } catch { /* ok */ }
    }
  }

  async fixTests(failures: string, workDir: string): Promise<CodeAgentResult> {
    console.log(`[claude-code-agent] Fixing test failures...`);

    const prompt = `Fix these test failures. Do NOT change the test expectations - fix the source code to make the tests pass:\n\n${failures.slice(0, 3000)}`;

    let output = "";
    try {
      output = execSync(
        `${this.claudePath} --permission-mode bypassPermissions --print "${prompt.replace(/"/g, '\\"')}"`,
        {
          cwd: workDir,
          encoding: "utf-8",
          stdio: "pipe",
          timeout: this.timeoutMs,
          env: { ...process.env, FORCE_COLOR: "0" },
        }
      );
    } catch (err: unknown) {
      const execErr = err as { stdout?: string };
      output = execErr.stdout ?? "";
    }

    const filesChanged = this.getChangedFiles(workDir);
    return {
      summary: `Claude Code fix attempt: ${filesChanged.length} files modified`,
      filesChanged,
    };
  }

  private buildTaskFile(issue: IssueContext): string {
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
