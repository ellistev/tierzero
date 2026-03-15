/**
 * Skill Generator - Converts a workflow into a hot-loadable TierZero skill.
 */

import type { SkillManifest } from "../skills/types";
import type { GeneratedWorkflow } from "./generator";
import type { WorkflowVariable } from "./types";

// ---------------------------------------------------------------------------
// Generated Skill Output
// ---------------------------------------------------------------------------

export interface GeneratedSkill {
  manifest: SkillManifest;
  entryPoint: string;
  files: Record<string, string>;
  directoryName: string;
}

// ---------------------------------------------------------------------------
// SkillGenerator
// ---------------------------------------------------------------------------

export class SkillGenerator {
  /**
   * Generate a complete skill from a workflow.
   */
  generateSkill(workflow: GeneratedWorkflow, name?: string): GeneratedSkill {
    const skillName = name || this.toSkillName(workflow.name);
    const directoryName = this.toDirectoryName(skillName);

    const manifest = this.generateManifest(workflow, skillName);
    const entryPoint = this.generateEntryPoint(workflow, skillName);
    const readmeContent = this.generateReadme(workflow, skillName);

    return {
      manifest,
      entryPoint,
      directoryName,
      files: {
        "skill.json": JSON.stringify(manifest, null, 2),
        "index.ts": entryPoint,
        "README.md": readmeContent,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Manifest
  // ---------------------------------------------------------------------------

  private generateManifest(
    workflow: GeneratedWorkflow,
    name: string
  ): SkillManifest {
    const capabilities = this.generateCapabilities(workflow);

    return {
      name,
      version: "1.0.0",
      description: workflow.description,
      entry: "index.ts",
      capabilities,
    };
  }

  private generateCapabilities(workflow: GeneratedWorkflow): string[] {
    const caps: string[] = ["execute"];

    for (const param of workflow.parameters) {
      caps.push(`set-${param.name}`);
    }

    return caps;
  }

  // ---------------------------------------------------------------------------
  // Entry Point Code Generation
  // ---------------------------------------------------------------------------

  private generateEntryPoint(
    workflow: GeneratedWorkflow,
    name: string
  ): string {
    const paramInterface = this.generateParamInterface(workflow.parameters);
    const stepsArray = this.generateStepsArray(workflow);
    const capabilityHandlers = this.generateCapabilityHandlers(workflow);

    return `/**
 * Auto-generated skill: ${name}
 * Generated from recording session: ${workflow.source.sessionId}
 * Recorded at: ${workflow.source.recordedAt}
 *
 * This skill uses IntentEngine + ActionChain for adaptive execution.
 * It describes WHAT to do (goals), not HOW (selectors).
 */

import type { Page } from "playwright";
import type { SkillManifest, SkillConfig, SkillProvider } from "../../skills/types";
import type { ChainStep } from "../../intents/chain";
import { ActionChain } from "../../intents/chain";
import { IntentEngine } from "../../intents/engine";

// ---------------------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------------------

${paramInterface}

// ---------------------------------------------------------------------------
// Skill Provider
// ---------------------------------------------------------------------------

const manifest: SkillManifest = ${JSON.stringify(
      {
        name,
        version: "1.0.0",
        description: workflow.description,
        entry: "index.ts",
        capabilities: this.generateCapabilities(workflow),
      },
      null,
      2
    )};

export class ${this.toPascalCase(name)}Skill implements SkillProvider {
  readonly manifest = manifest;
  private params: Partial<SkillParams> = {};
  private config: SkillConfig = {};

  async initialize(config: SkillConfig): Promise<void> {
    this.config = config;
${workflow.parameters
  .map(
    (p) =>
      `    if (config["${p.name}"] !== undefined) this.params.${p.name} = String(config["${p.name}"]);`
  )
  .join("\n")}
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
${capabilityHandlers}
    return null;
  }

  listCapabilities(): string[] {
    return ${JSON.stringify(this.generateCapabilities(workflow))};
  }

  /**
   * Execute the recorded workflow on a page.
   */
  async execute(page: Page, params?: Partial<SkillParams>): Promise<{ success: boolean; error?: string }> {
    const mergedParams = { ...this.params, ...params };

    // Build intent-based chain steps
    const steps: ChainStep[] = ${stepsArray};

    // Substitute parameters
    for (const step of steps) {
      if (step.intent.value) {
        step.intent.value = this.substituteParams(step.intent.value, mergedParams);
      }
    }

    // Execute via ActionChain (adaptive, not brittle)
    const engine = new IntentEngine({});
    const chain = new ActionChain(steps, { engine, page });

    try {
      const result = await chain.execute();
      return {
        success: result.success,
        error: result.success ? undefined : result.steps.find(s => s.status === "failed")?.error,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private substituteParams(value: string, params: Partial<SkillParams>): string {
    return value.replace(/\\{\\{(\\w+)\\}\\}/g, (_, key) => {
      const val = params[key as keyof SkillParams];
      return val !== undefined ? val : \`{{\${key}}}\`;
    });
  }

  async dispose(): Promise<void> {
    // Nothing to clean up
  }
}

export default function createSkill(): SkillProvider {
  return new ${this.toPascalCase(name)}Skill();
}
`;
  }

  private generateParamInterface(params: WorkflowVariable[]): string {
    if (params.length === 0) {
      return "type SkillParams = Record<string, never>;";
    }

    const fields = params
      .map((p) => `  /** ${p.description} */\n  ${p.name}?: string;`)
      .join("\n");

    return `interface SkillParams {\n${fields}\n}`;
  }

  private generateStepsArray(workflow: GeneratedWorkflow): string {
    const steps = workflow.chainSteps.map((step) => {
      const obj: Record<string, unknown> = {
        intent: {
          action: step.intent.action,
          target: step.intent.target,
          ...(step.intent.value ? { value: step.intent.value } : {}),
        },
      };
      if (step.expectedState) {
        obj.expectedState = step.expectedState;
      }
      if (step.maxRetries !== undefined) {
        obj.maxRetries = step.maxRetries;
      }
      if (step.delayAfterMs !== undefined) {
        obj.delayAfterMs = step.delayAfterMs;
      }
      return obj;
    });

    return JSON.stringify(steps, null, 6);
  }

  private generateCapabilityHandlers(workflow: GeneratedWorkflow): string {
    const lines: string[] = [];

    lines.push(
      '    if (name === "execute") return async (...args: unknown[]) => this.execute(args[0] as Page, args[1] as Partial<SkillParams>);'
    );

    for (const param of workflow.parameters) {
      lines.push(
        `    if (name === "set-${param.name}") return async (...args: unknown[]) => { this.params.${param.name} = String(args[0]); };`
      );
    }

    return lines.join("\n");
  }

  // ---------------------------------------------------------------------------
  // README
  // ---------------------------------------------------------------------------

  private generateReadme(
    workflow: GeneratedWorkflow,
    name: string
  ): string {
    const paramDocs = workflow.parameters
      .map(
        (p) =>
          `- **${p.name}**: ${p.description}${p.defaultValue ? ` (default: ${p.defaultValue})` : ""}`
      )
      .join("\n");

    return `# ${name}

${workflow.description}

## Parameters

${paramDocs || "No parameters."}

## Steps

${workflow.steps.map((s, i) => `${i + 1}. ${s.name}`).join("\n")}

## Source

- Session: ${workflow.source.sessionId}
- Recorded: ${workflow.source.recordedAt}
- Actions: ${workflow.source.actionCount}

*Auto-generated by TierZero Workflow Recorder*
`;
  }

  // ---------------------------------------------------------------------------
  // Naming helpers
  // ---------------------------------------------------------------------------

  private toSkillName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50);
  }

  private toDirectoryName(name: string): string {
    return name.replace(/[^a-z0-9-]/g, "");
  }

  private toPascalCase(str: string): string {
    return str
      .split(/[-_\s]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("");
  }
}
