/**
 * App Insights Skill.
 * 
 * Generic Azure Application Insights KQL query runner.
 * Instance-specific config (app ID, subscription) injected via skill config.
 * KQL templates are loaded from the skill's templates/ dir or demo config.
 */

import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import type { SkillManifest, SkillProvider, SkillConfig, SkillFactory } from "../../src/skills/types";

export interface KqlResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

class AppInsightsSkill implements SkillProvider {
  readonly manifest: SkillManifest;
  private appId = "";
  private subscription = "";
  private offsetDays = 90;
  private templates: Map<string, string> = new Map();

  constructor(manifest: SkillManifest) {
    this.manifest = manifest;
  }

  async initialize(config: SkillConfig): Promise<void> {
    this.appId = config.appId as string;
    this.subscription = config.subscription as string;
    this.offsetDays = (config.offsetDays as number) ?? 90;

    // Load KQL templates from config
    if (config.templates && typeof config.templates === "object") {
      for (const [name, query] of Object.entries(config.templates as Record<string, string>)) {
        this.templates.set(name, query);
      }
    }
  }

  getCapability(name: string): ((...args: unknown[]) => Promise<unknown>) | null {
    const caps: Record<string, (...args: unknown[]) => Promise<unknown>> = {
      "kql-query": async (query: unknown, opts?: unknown) =>
        this.executeKql(query as string, opts as { offsetDays?: number }),
      "kql-template": async (templateName: unknown, params?: unknown) =>
        this.executeTemplate(templateName as string, params as Record<string, string>),
    };
    return caps[name] ?? null;
  }

  listCapabilities(): string[] {
    return ["kql-query", "kql-template"];
  }

  /**
   * Execute a raw KQL query.
   */
  async executeKql(query: string, options?: { offsetDays?: number }): Promise<KqlResult> {
    const offset = options?.offsetDays ?? this.offsetDays;

    execSync(`az account set --subscription "${this.subscription}"`, { stdio: "pipe" });

    const tmpFile = path.join(process.cwd(), `_tmp_query_${Date.now()}.kql`);
    fs.writeFileSync(tmpFile, query, "utf-8");

    try {
      const result = execSync(
        `az monitor app-insights query --app "${this.appId}" --analytics-query @${tmpFile} --offset ${offset}d --output json`,
        { encoding: "utf-8", maxBuffer: 10 * 1024 * 1024, shell: "cmd.exe" as unknown as boolean }
      );

      const data = JSON.parse(result);
      if (!data.tables || data.tables.length === 0 || data.tables[0].rows.length === 0) {
        return { rows: [], columns: [] };
      }

      const table = data.tables[0];
      const columns: string[] = table.columns.map((c: { name: string }) => c.name);
      const rows = table.rows.map((row: unknown[]) => {
        const obj: Record<string, unknown> = {};
        columns.forEach((col, idx) => { obj[col] = row[idx]; });
        return obj;
      });

      return { rows, columns };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch {}
    }
  }

  /**
   * Execute a named KQL template with parameter substitution.
   */
  async executeTemplate(
    templateName: string,
    params?: Record<string, string>
  ): Promise<KqlResult> {
    const template = this.templates.get(templateName);
    if (!template) {
      throw new Error(
        `KQL template "${templateName}" not found. Available: ${[...this.templates.keys()].join(", ")}`
      );
    }

    let query = template;
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        query = query.replace(new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"), value);
      }
    }

    return this.executeKql(query);
  }
}

const createSkill: SkillFactory = (manifest) => new AppInsightsSkill(manifest);
export default createSkill;
export { createSkill, AppInsightsSkill };
