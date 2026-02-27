/**
 * Code Implementer — orchestrates the full cycle of reading a codebase,
 * asking a coding LLM to plan changes, applying file edits, running tests,
 * and creating a git branch with the changes.
 *
 * Flow:
 *   1. gatherFileContext() — read relevant source files
 *   2. codingModel.chat() — ask the LLM to produce an implementation plan
 *   3. parseEditPlan()    — extract structured file edits from the response
 *   4. applyEdits()       — write/modify/delete files on disk
 *   5. runTests()         — execute the test command if configured
 *   6. gitCommit()        — create branch + commit
 */

import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import type { Ticket } from "../connectors/types.js";
import type {
  CodebaseConfig,
  CodingModel,
  FileEdit,
  ImplementationPlan,
  ImplementationResult,
} from "./types.js";
import { gatherFileContext, formatFileContext } from "./file-context.js";

// ---------------------------------------------------------------------------
// Pure helpers (exported for testing)
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for the coding LLM.
 */
export function buildSystemPrompt(): string {
  return [
    "You are a senior software engineer implementing a bug fix or feature from a ticket.",
    "You will be given the ticket details and relevant source files from the codebase.",
    "",
    "Your response MUST contain a structured edit plan in the following format:",
    "",
    "## Summary",
    "A brief explanation of what you're changing and why.",
    "",
    "## Edits",
    "For each file change, use this exact format:",
    "",
    "### CREATE path/to/new-file.ts",
    "```",
    "full file content here",
    "```",
    "",
    "### MODIFY path/to/existing-file.ts",
    "```",
    "complete new file content (not a diff -- the entire file after your changes)",
    "```",
    "",
    "### DELETE path/to/obsolete-file.ts",
    "",
    "Rules:",
    "- MODIFY must contain the COMPLETE new file content, not a diff or partial edit.",
    "- Keep changes minimal and focused. Don't refactor unrelated code.",
    "- Follow existing code style, naming conventions, and patterns.",
    "- Add or update tests when appropriate.",
    "- Do not remove existing comments.",
    "- If you cannot confidently implement the change, say so in the Summary and provide no Edits.",
  ].join("\n");
}

/**
 * Build the user prompt with ticket details and file context.
 */
export function buildUserPrompt(ticket: Ticket, fileContext: string): string {
  return [
    "## Ticket",
    `**Title:** ${ticket.title}`,
    `**Type:** ${ticket.type} | **Priority:** ${ticket.priority}`,
    `**Description:**`,
    ticket.description,
    "",
    "## Codebase",
    fileContext,
  ].join("\n");
}

/**
 * Parse the LLM's response into a structured ImplementationPlan.
 * Extracts CREATE / MODIFY / DELETE blocks from the markdown response.
 */
export function parseEditPlan(response: string): ImplementationPlan {
  const lines = response.split("\n");
  const edits: FileEdit[] = [];
  let summary = "";

  // Extract summary
  const summaryIdx = lines.findIndex((l) => /^##\s+Summary/i.test(l));
  if (summaryIdx >= 0) {
    const summaryLines: string[] = [];
    for (let i = summaryIdx + 1; i < lines.length; i++) {
      if (/^##\s+/i.test(lines[i])) break;
      summaryLines.push(lines[i]);
    }
    summary = summaryLines.join("\n").trim();
  }

  // Extract edits
  const editHeaderRegex = /^###\s+(CREATE|MODIFY|DELETE)\s+(.+)$/i;
  let i = 0;

  while (i < lines.length) {
    const match = editHeaderRegex.exec(lines[i]);
    if (!match) {
      i++;
      continue;
    }

    const action = match[1].toLowerCase() as "create" | "modify" | "delete";
    const filePath = match[2].trim();
    i++;

    if (action === "delete") {
      edits.push({ action: "delete", path: filePath });
      continue;
    }

    // Find the code block content
    // Skip until we find the opening ```
    while (i < lines.length && !lines[i].startsWith("```")) i++;
    i++; // skip the opening ```

    const contentLines: string[] = [];
    while (i < lines.length && !lines[i].startsWith("```")) {
      contentLines.push(lines[i]);
      i++;
    }
    i++; // skip the closing ```

    const content = contentLines.join("\n");
    edits.push({ action, path: filePath, content });
  }

  return { summary, edits, filesRead: [] };
}

/**
 * Generate a git branch name from a ticket.
 */
export function branchName(ticket: Ticket, prefix: string): string {
  const id = ticket.externalId ?? ticket.id;
  const slug = ticket.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${prefix}${id}-${slug}`;
}

// ---------------------------------------------------------------------------
// Implementer class
// ---------------------------------------------------------------------------

export class Implementer {
  private readonly codebase: CodebaseConfig;
  private readonly model: CodingModel;

  constructor(codebase: CodebaseConfig, model: CodingModel) {
    this.codebase = codebase;
    this.model = model;
  }

  /**
   * Run the full implementation cycle for a ticket.
   */
  async implement(ticket: Ticket): Promise<ImplementationResult> {
    const start = Date.now();
    const result: ImplementationResult = {
      success: false,
      summary: "",
      filesChanged: [],
      filesDeleted: [],
      durationMs: 0,
    };

    try {
      // 1. Gather file context
      const ticketText = `${ticket.title} ${ticket.description}`;
      const files = await gatherFileContext(this.codebase, ticketText);

      if (!files.length) {
        result.error = `No source files found in codebase "${this.codebase.name}" at ${this.codebase.path}`;
        result.durationMs = Date.now() - start;
        return result;
      }

      const fileContext = formatFileContext(files);

      // 2. Ask the coding LLM
      const systemPrompt = buildSystemPrompt();
      const userPrompt = buildUserPrompt(ticket, fileContext);

      const response = await this.model.chat([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      // 3. Parse the edit plan
      const plan = parseEditPlan(response);
      plan.filesRead = files.map((f) => f.relativePath);
      result.summary = plan.summary;

      if (!plan.edits.length) {
        result.summary = plan.summary || "LLM produced no file edits — the change may require manual implementation.";
        result.durationMs = Date.now() - start;
        return result;
      }

      // 4. Create git branch
      const prefix = this.codebase.branchPrefix ?? "tierzero/";
      const branch = branchName(ticket, prefix);
      result.branch = branch;

      try {
        execSync("git stash --include-untracked", { cwd: this.codebase.path, stdio: "pipe" });
        execSync(`git checkout -b "${branch}"`, { cwd: this.codebase.path, stdio: "pipe" });
      } catch (err) {
        // Branch might already exist, try switching to it
        try {
          execSync(`git checkout "${branch}"`, { cwd: this.codebase.path, stdio: "pipe" });
        } catch {
          result.error = `Failed to create/switch to branch "${branch}": ${err}`;
          result.durationMs = Date.now() - start;
          return result;
        }
      }

      // 5. Apply edits
      for (const edit of plan.edits) {
        const fullPath = path.join(this.codebase.path, edit.path);

        if (edit.action === "delete") {
          try {
            await fs.unlink(fullPath);
            result.filesDeleted.push(edit.path);
          } catch {
            // File may not exist
          }
        } else {
          await fs.mkdir(path.dirname(fullPath), { recursive: true });
          await fs.writeFile(fullPath, edit.content, "utf-8");
          result.filesChanged.push(edit.path);
        }
      }

      // 6. Run tests if configured
      if (this.codebase.testCommand) {
        try {
          const testOutput = execSync(this.codebase.testCommand, {
            cwd: this.codebase.path,
            timeout: 120_000, // 2 minute timeout for tests
            encoding: "utf-8",
            stdio: "pipe",
          });
          result.testOutput = testOutput;
          result.testsPassed = true;
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string; message?: string };
          result.testOutput = (execErr.stdout ?? "") + "\n" + (execErr.stderr ?? "");
          result.testsPassed = false;
          // Tests failed — still commit but note it
          result.summary += "\n\nNote: Tests failed after applying changes. Manual review required.";
        }
      }

      // 7. Git commit
      try {
        const ticketId = ticket.externalId ?? ticket.id;
        const commitMsg = `${ticket.type}: ${ticket.title} [${ticketId}]\n\n${plan.summary}`;

        execSync("git add -A", { cwd: this.codebase.path, stdio: "pipe" });
        // Use a temp file for the commit message to avoid shell quoting issues
        const msgFile = path.join(this.codebase.path, ".git", "TIERZERO_COMMIT_MSG");
        await fs.writeFile(msgFile, commitMsg, "utf-8");
        execSync(`git commit -F "${msgFile}"`, { cwd: this.codebase.path, stdio: "pipe" });
        await fs.unlink(msgFile).catch(() => {});

        const hash = execSync("git rev-parse --short HEAD", {
          cwd: this.codebase.path,
          encoding: "utf-8",
        }).trim();
        result.commitHash = hash;
      } catch (err) {
        result.error = `Git commit failed: ${err}`;
      }

      result.success = !result.error && (result.testsPassed !== false);
      result.durationMs = Date.now() - start;
      return result;
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      result.durationMs = Date.now() - start;
      return result;
    }
  }
}

/**
 * Format an ImplementationResult as a markdown summary suitable for
 * posting on the ticket as a comment.
 */
export function formatResultForTicket(result: ImplementationResult, modelName: string): string {
  const lines: string[] = [
    `## Code Implementation ${result.success ? "Completed" : "Attempted"}`,
    "",
    `**Model:** ${modelName}`,
    `**Duration:** ${(result.durationMs / 1000).toFixed(1)}s`,
  ];

  if (result.branch) lines.push(`**Branch:** \`${result.branch}\``);
  if (result.commitHash) lines.push(`**Commit:** \`${result.commitHash}\``);

  lines.push("");
  lines.push("### Summary");
  lines.push(result.summary || "_No summary provided._");

  if (result.filesChanged.length) {
    lines.push("");
    lines.push("### Files Changed");
    result.filesChanged.forEach((f) => lines.push(`- \`${f}\``));
  }

  if (result.filesDeleted.length) {
    lines.push("");
    lines.push("### Files Deleted");
    result.filesDeleted.forEach((f) => lines.push(`- \`${f}\``));
  }

  if (result.testsPassed !== undefined) {
    lines.push("");
    lines.push(`### Tests: ${result.testsPassed ? "Passed" : "Failed"}`);
    if (result.testOutput) {
      // Truncate test output for the ticket comment
      const truncated = result.testOutput.length > 2000
        ? result.testOutput.slice(-2000) + "\n...(truncated)"
        : result.testOutput;
      lines.push("```");
      lines.push(truncated);
      lines.push("```");
    }
  }

  if (result.error) {
    lines.push("");
    lines.push("### Error");
    lines.push(result.error);
  }

  return lines.join("\n");
}
