/**
 * Recording CLI - CLI commands for the recording system.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { RecordingController } from "./controller";
import { WorkflowGenerator } from "./generator";
import { SkillGenerator } from "./skill-generator";
import { ActionAnnotator } from "./annotator";
import type { RecordedSession } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SESSIONS_DIR = ".tierzero/recordings";
const WORKFLOWS_DIR = ".tierzero/workflows";
const SKILLS_DIR = ".tierzero/skills";

// ---------------------------------------------------------------------------
// CLI Commands
// ---------------------------------------------------------------------------

export interface RecordCLIOptions {
  workDir?: string;
}

export class RecordCLI {
  private workDir: string;

  constructor(options: RecordCLIOptions = {}) {
    this.workDir = options.workDir || process.cwd();
  }

  /**
   * Parse and execute a record CLI command.
   */
  async execute(args: string[]): Promise<string> {
    const command = args[0];

    switch (command) {
      case "start":
        return this.handleStart(args.slice(1));
      case "stop":
        return this.handleStop();
      case "generate":
        return this.handleGenerate(args.slice(1));
      case "replay":
        return this.handleReplay(args.slice(1));
      case "list":
        return this.handleList();
      default:
        return this.showHelp();
    }
  }

  /**
   * Handle `record start <url>` command.
   */
  private async handleStart(args: string[]): Promise<string> {
    const url = args[0];
    if (!url) {
      return "Error: URL is required. Usage: record start <url>";
    }

    // Validate URL
    try {
      new URL(url);
    } catch {
      return `Error: Invalid URL "${url}". Please provide a valid URL.`;
    }

    return `Recording started. Navigate to ${url} and perform actions.\nUse 'record stop' when finished.`;
  }

  /**
   * Handle `record stop` command.
   */
  private async handleStop(): Promise<string> {
    return "Recording stopped. Use 'record generate <session-file>' to generate a workflow.";
  }

  /**
   * Handle `record generate <session-file>` command.
   */
  private async handleGenerate(args: string[]): Promise<string> {
    const sessionFile = args[0];
    if (!sessionFile) {
      return "Error: Session file is required. Usage: record generate <session-file>";
    }

    const sessionPath = path.resolve(this.workDir, sessionFile);
    if (!fs.existsSync(sessionPath)) {
      return `Error: Session file not found: ${sessionPath}`;
    }

    try {
      const raw = fs.readFileSync(sessionPath, "utf-8");
      const session: RecordedSession = JSON.parse(raw);

      // Annotate
      const annotator = new ActionAnnotator();
      const annotated = annotator.annotateSession(session);

      // Generate workflow
      const workflowGen = new WorkflowGenerator();
      const workflow = workflowGen.generateWorkflow(annotated);

      // Generate skill
      const skillGen = new SkillGenerator();
      const skill = skillGen.generateSkill(workflow);

      // Save workflow
      const workflowDir = path.join(this.workDir, WORKFLOWS_DIR);
      this.ensureDir(workflowDir);
      const workflowPath = path.join(workflowDir, `${workflow.id}.json`);
      fs.writeFileSync(workflowPath, JSON.stringify(workflow, null, 2));

      // Save skill files
      const skillDir = path.join(this.workDir, SKILLS_DIR, skill.directoryName);
      this.ensureDir(skillDir);
      for (const [fileName, content] of Object.entries(skill.files)) {
        fs.writeFileSync(path.join(skillDir, fileName), content);
      }

      return [
        `Workflow generated: ${workflowPath}`,
        `Skill generated: ${skillDir}/`,
        `  - ${Object.keys(skill.files).join(", ")}`,
        `Workflow: "${workflow.name}" with ${workflow.steps.length} steps and ${workflow.parameters.length} parameters.`,
      ].join("\n");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return `Error generating workflow: ${msg}`;
    }
  }

  /**
   * Handle `record replay <workflow-file>` command.
   */
  private async handleReplay(args: string[]): Promise<string> {
    const workflowFile = args[0];
    if (!workflowFile) {
      return "Error: Workflow file is required. Usage: record replay <workflow-file>";
    }

    const workflowPath = path.resolve(this.workDir, workflowFile);
    if (!fs.existsSync(workflowPath)) {
      return `Error: Workflow file not found: ${workflowPath}`;
    }

    return `Replay requires a browser instance. Use the programmatic API to replay workflows.`;
  }

  /**
   * Handle `record list` command.
   */
  private async handleList(): Promise<string> {
    const sessionsDir = path.join(this.workDir, SESSIONS_DIR);

    if (!fs.existsSync(sessionsDir)) {
      return "No recorded sessions found.";
    }

    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith(".json"));

    if (files.length === 0) {
      return "No recorded sessions found.";
    }

    const lines = ["Recorded sessions:"];
    for (const file of files) {
      try {
        const raw = fs.readFileSync(path.join(sessionsDir, file), "utf-8");
        const session: RecordedSession = JSON.parse(raw);
        lines.push(
          `  - ${session.id} (${session.actions.length} actions, ${session.startTime})`
        );
      } catch {
        lines.push(`  - ${file} (invalid)`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Save a recorded session to disk.
   */
  saveSession(session: RecordedSession): string {
    const sessionsDir = path.join(this.workDir, SESSIONS_DIR);
    this.ensureDir(sessionsDir);
    const filePath = path.join(sessionsDir, `${session.id}.json`);
    fs.writeFileSync(filePath, JSON.stringify(session, null, 2));
    return filePath;
  }

  /**
   * Show CLI help.
   */
  private showHelp(): string {
    return [
      "TierZero Workflow Recorder",
      "",
      "Commands:",
      "  record start <url>           - Open browser and start recording",
      "  record stop                  - Stop recording and save session",
      "  record generate <session>    - Generate workflow + skill from session",
      "  record replay <workflow>     - Replay a generated workflow",
      "  record list                  - List recorded sessions",
    ].join("\n");
  }

  private ensureDir(dir: string): void {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
