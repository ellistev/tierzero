/**
 * Codex CLI CodeAgent implementation.
 *
 * Uses Codex CLI authenticated via local OAuth to solve GitHub issues.
 */

import { execFileSync, spawn } from "node:child_process";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { CodeAgent, IssueContext, CodeAgentResult } from "./issue-pipeline";
import type { KnowledgeStore, KnowledgeEntry } from "../knowledge/store";
import type { KnowledgeExtractor, ExtractionContext } from "../knowledge/extractor";
import { createLogger } from "../infra/logger";

const log = createLogger("codex-cli-agent");

export interface CodexCliAgentConfig {
  codexPath?: string;
  timeoutMs?: number;
  model?: string;
  extraContext?: string;
  knowledgeStore?: KnowledgeStore;
  knowledgeExtractor?: KnowledgeExtractor;
}

export class CodexCliAgent implements CodeAgent {
  private readonly codexPath: string;
  private readonly timeoutMs: number;
  private readonly model: string;
  private readonly extraContext: string;
  private readonly knowledgeStore: KnowledgeStore | null;
  private readonly knowledgeExtractor: KnowledgeExtractor | null;

  constructor(config: CodexCliAgentConfig = {}) {
    this.codexPath = config.codexPath ?? "codex";
    this.timeoutMs = config.timeoutMs ?? 600_000;
    this.model = config.model ?? "gpt-5.4";
    this.extraContext = config.extraContext ?? "";
    this.knowledgeStore = config.knowledgeStore ?? null;
    this.knowledgeExtractor = config.knowledgeExtractor ?? null;
  }

  async solve(issue: IssueContext, workDir: string): Promise<CodeAgentResult> {
    const priorKnowledge = await this.searchPriorKnowledge(issue);
    const taskPath = join(workDir, "TASK.md");
    const taskContent = this.buildTaskFile(issue, priorKnowledge);
    writeFileSync(taskPath, taskContent, "utf-8");

    try {
      const output = await this.runCodex(
        "Read TASK.md. Implement everything described. Run tests and make sure they pass. Do NOT modify existing test files unless the task explicitly requires it. Delete TASK.md when done.",
        workDir,
      );
      const filesChanged = this.getChangedFiles(workDir);
      const summary = this.extractSummary(output, issue);
      await this.extractKnowledge(issue, output, filesChanged, workDir);
      return { summary, filesChanged };
    } finally {
      try { if (existsSync(taskPath)) unlinkSync(taskPath); } catch {}
    }
  }

  async fixReviewFindings(instructions: string, workDir: string): Promise<CodeAgentResult> {
    const fixPath = join(workDir, "REVIEW_FIXES.md");
    writeFileSync(fixPath, instructions, "utf-8");
    try {
      await this.runCodex(
        "Read REVIEW_FIXES.md. Fix all listed issues. Run npm test to verify. Delete REVIEW_FIXES.md when done.",
        workDir,
      );
    } finally {
      try { if (existsSync(fixPath)) unlinkSync(fixPath); } catch {}
    }
    const filesChanged = this.getChangedFiles(workDir);
    return { summary: `Codex CLI review fix: ${filesChanged.length} files modified`, filesChanged };
  }

  async fixTests(failures: string, workDir: string): Promise<CodeAgentResult> {
    const failPath = join(workDir, "TEST_FAILURES.md");
    writeFileSync(failPath, `# Test Failures\n\nFix these without changing test expectations:\n\n\`\`\`\n${failures.slice(0, 3000)}\n\`\`\``, "utf-8");
    try {
      await this.runCodex(
        "Read TEST_FAILURES.md. Fix the source code to make tests pass. Do NOT change the tests. Run npm test to verify. Delete TEST_FAILURES.md when done.",
        workDir,
      );
    } finally {
      try { if (existsSync(failPath)) unlinkSync(failPath); } catch {}
    }
    const filesChanged = this.getChangedFiles(workDir);
    return { summary: `Codex CLI fix attempt: ${filesChanged.length} files modified`, filesChanged };
  }

  private resolveCodexExecutable(): { exe: string; argsPrefix: string[] } {
    if (existsSync(this.codexPath)) {
      return { exe: this.codexPath, argsPrefix: [] };
    }

    try {
      const resolved = execFileSync("where.exe", [this.codexPath], { encoding: "utf-8" })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (resolved) return { exe: resolved, argsPrefix: [] };
    } catch {
      // ignore and try npx fallback
    }

    try {
      const npx = execFileSync("where.exe", ["npx"], { encoding: "utf-8" })
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (npx) return { exe: npx, argsPrefix: ["-y", "@openai/codex"] };
    } catch {
      // ignore and let spawn fail clearly
    }

    return { exe: this.codexPath, argsPrefix: [] };
  }

  private runCodex(prompt: string, workDir: string): Promise<string> {
    return new Promise((resolve) => {
      const resolved = this.resolveCodexExecutable();
      const args = [...resolved.argsPrefix, "exec", "--model", this.model, prompt];

      log.info(`Spawning Codex: ${resolved.exe} ${args.join(" ")}`);
      const child = spawn(resolved.exe, args, {
        cwd: workDir,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, FORCE_COLOR: "0" },
        shell: false,
        detached: true,
        windowsHide: true,
      });

      const chunks: string[] = [];
      const stderrChunks: string[] = [];

      child.stdout.on("data", (buf: Buffer) => {
        const text = buf.toString();
        chunks.push(text);
        process.stdout.write(text);
      });
      child.stderr.on("data", (buf: Buffer) => stderrChunks.push(buf.toString()));

      const timer = setTimeout(() => {
        try { execFileSync("taskkill", ["/F", "/T", "/PID", String(child.pid)]); } catch {}
        resolve(chunks.join(""));
      }, this.timeoutMs);

      child.on("close", () => {
        clearTimeout(timer);
        if (stderrChunks.length) log.info(`Codex stderr: ${stderrChunks.join("").slice(0, 500)}`);
        resolve(chunks.join(""));
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        log.error(`Codex spawn error: ${err.message}`);
        resolve("");
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

    if (issue.comments.length > 0) sections.push("## Discussion", ...issue.comments.map((c) => `> ${c}`), "");
    if (issue.labels.length > 0) sections.push(`## Labels: ${issue.labels.join(", ")}`, "");
    if (this.extraContext) sections.push("## Additional Context", this.extraContext, "");
    if (priorKnowledge.length > 0) {
      sections.push("## Prior Knowledge", "");
      for (const entry of priorKnowledge) {
        sections.push(`### ${entry.title} (confidence: ${entry.confidence.toFixed(2)})`, entry.content, "");
      }
    }
    sections.push(
      "## Acceptance Criteria",
      "- Implement the requested change completely",
      "- Run tests and make sure they pass",
      "- Do not change tests unless explicitly required",
      "- Follow existing patterns and keep the diff focused",
      "",
    );
    return sections.join("\n");
  }

  private getChangedFiles(workDir: string): string[] {
    try {
      const { execSync } = require("node:child_process");
      const output = execSync("git diff --name-only HEAD", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      const untracked = execSync("git ls-files --others --exclude-standard", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).trim();
      return [...output.split("\n"), ...untracked.split("\n")].filter(Boolean);
    } catch {
      return [];
    }
  }

  private extractSummary(output: string, issue: IssueContext): string {
    const trimmed = output.trim();
    if (!trimmed) return `Codex CLI completed work for #${issue.number}: ${issue.title}`;
    const paragraphs = trimmed.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return paragraphs[paragraphs.length - 1]?.slice(0, 1000) ?? `Codex CLI completed work for #${issue.number}`;
  }

  private async searchPriorKnowledge(issue: IssueContext): Promise<KnowledgeEntry[]> {
    if (!this.knowledgeStore) return [];
    try {
      const entries = await this.knowledgeStore.search(`${issue.title} ${issue.description.slice(0, 500)}`, { limit: 5, minConfidence: 0.5 });
      for (const entry of entries) await this.knowledgeStore.recordUsage(entry.id);
      return entries;
    } catch {
      return [];
    }
  }

  private async extractKnowledge(issue: IssueContext, output: string, filesChanged: string[], workDir: string): Promise<void> {
    if (!this.knowledgeExtractor || !this.knowledgeStore) return;
    try {
      const { execSync } = require("node:child_process");
      let gitDiff = "";
      try { gitDiff = execSync("git diff", { cwd: workDir, encoding: "utf-8", stdio: "pipe" }).slice(0, 5000); } catch {}
      const ctx: ExtractionContext = {
        taskId: `issue-${issue.number}`,
        taskTitle: issue.title,
        taskDescription: issue.description,
        agentName: "codex-cli",
        gitDiff,
        agentOutput: output.slice(-2000),
        filesModified: filesChanged,
      };
      const entries = await this.knowledgeExtractor.extract(ctx);
      for (const entry of entries) await this.knowledgeStore.add(entry);
    } catch (err) {
      log.error(`Knowledge extraction failed: ${(err as Error).message}`);
    }
  }
}
