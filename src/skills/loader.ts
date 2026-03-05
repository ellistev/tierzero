/**
 * Skill Loader.
 * 
 * Scans skill directories, validates manifests, hot-loads skill modules
 * at runtime via dynamic import. No build step needed - uses tsx.
 */

import fs from "fs";
import path from "path";
import type { SkillManifest, SkillProvider, SkillConfig, SkillFactory } from "./types";

export interface LoadedSkill {
  manifest: SkillManifest;
  provider: SkillProvider;
  source: string; // "bundled" | "demo" | "external"
  dir: string;
}

export interface SkillLoaderOptions {
  /** Directories to scan for skills (in priority order, later overrides) */
  skillDirs: string[];
  /** Config values to inject (from demo config.yaml) */
  config?: Record<string, SkillConfig>;
  /** Logger */
  logger?: {
    log: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export class SkillLoader {
  private skills: Map<string, LoadedSkill> = new Map();
  private opts: SkillLoaderOptions;
  private log: SkillLoaderOptions["logger"];

  constructor(opts: SkillLoaderOptions) {
    this.opts = opts;
    this.log = opts.logger ?? {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
  }

  /**
   * Scan all skill directories and load skills.
   * Later directories override earlier ones (demo skills override bundled).
   */
  async loadAll(): Promise<Map<string, LoadedSkill>> {
    for (const dir of this.opts.skillDirs) {
      if (!fs.existsSync(dir)) continue;

      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const skillDir = path.join(dir, entry.name);
        const manifestPath = path.join(skillDir, "skill.json");

        if (!fs.existsSync(manifestPath)) {
          this.log!.warn(`Skipping ${entry.name}: no skill.json`);
          continue;
        }

        try {
          await this.loadSkill(skillDir, manifestPath);
        } catch (err) {
          this.log!.error(
            `Failed to load skill ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    return this.skills;
  }

  /**
   * Load a single skill from a directory.
   */
  private async loadSkill(skillDir: string, manifestPath: string): Promise<void> {
    const raw = fs.readFileSync(manifestPath, "utf-8");
    const manifest: SkillManifest = JSON.parse(raw);

    // Validate required fields
    if (!manifest.name || !manifest.version) {
      throw new Error("skill.json missing required fields: name, version");
    }

    // Determine entry point
    const entryFile = manifest.entry ?? "index.ts";
    const entryPath = path.join(skillDir, entryFile);

    if (!fs.existsSync(entryPath)) {
      // Try .js fallback
      const jsPath = entryPath.replace(/\.ts$/, ".js");
      if (!fs.existsSync(jsPath)) {
        throw new Error(`Entry point not found: ${entryFile}`);
      }
    }

    // Dynamic import (tsx handles TypeScript at runtime)
    const entryUrl = "file://" + entryPath.replace(/\\/g, "/");
    const mod = await import(entryUrl);

    const factory: SkillFactory = mod.default ?? mod.createSkill;
    if (typeof factory !== "function") {
      throw new Error(
        `Skill ${manifest.name} must export a default function or createSkill`
      );
    }

    const provider = factory(manifest);

    // Resolve config for this skill
    const skillConfig = this.resolveConfig(manifest);

    // Initialize
    await provider.initialize(skillConfig);

    // Determine source based on directory
    const source = skillDir.includes("demos") ? "demo" : "bundled";

    const loaded: LoadedSkill = { manifest, provider, source, dir: skillDir };

    // Override if same name already loaded (demo overrides bundled)
    if (this.skills.has(manifest.name)) {
      this.log!.log(`Skill ${manifest.name} overridden by ${source} version`);
    }

    this.skills.set(manifest.name, loaded);
    this.log!.log(
      `Loaded skill: ${manifest.name}@${manifest.version} [${source}] ` +
      `(${provider.listCapabilities().length} capabilities)`
    );
  }

  /**
   * Resolve config values for a skill from demo config + env vars.
   */
  private resolveConfig(manifest: SkillManifest): SkillConfig {
    const demoConfig = this.opts.config?.[manifest.name] ?? {};
    const resolved: SkillConfig = { ...demoConfig };

    // Apply defaults and env var resolution from manifest schema
    if (manifest.config) {
      for (const [key, field] of Object.entries(manifest.config)) {
        if (resolved[key] !== undefined) {
          // Check for env var reference in value
          if (typeof resolved[key] === "string") {
            const envMatch = (resolved[key] as string).match(/^\$\{(\w+)\}$/);
            if (envMatch) {
              resolved[key] = process.env[envMatch[1]] ?? field.default;
            }
          }
          continue;
        }

        // Try env var from manifest
        if (field.env && process.env[field.env]) {
          resolved[key] = process.env[field.env];
          continue;
        }

        // Apply default
        if (field.default !== undefined) {
          resolved[key] = field.default;
          continue;
        }

        // Required but missing
        if (field.required) {
          throw new Error(
            `Skill ${manifest.name}: missing required config "${key}". ` +
            `Set it in demo config.yaml or env var ${field.env ?? key.toUpperCase()}.`
          );
        }
      }
    }

    return resolved;
  }

  /**
   * Get a loaded skill by name.
   */
  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name);
  }

  /**
   * Get all loaded skills.
   */
  getAll(): LoadedSkill[] {
    return [...this.skills.values()];
  }

  /**
   * Find skills that provide a specific capability.
   */
  findByCapability(capability: string): LoadedSkill[] {
    return this.getAll().filter(
      (s) =>
        s.manifest.capabilities.includes(capability) ||
        s.provider.listCapabilities().includes(capability)
    );
  }

  /**
   * Hot-reload a specific skill (re-import and re-initialize).
   */
  async reload(name: string): Promise<void> {
    const existing = this.skills.get(name);
    if (!existing) throw new Error(`Skill not loaded: ${name}`);

    // Dispose old
    await existing.provider.dispose?.();

    // Re-load
    const manifestPath = path.join(existing.dir, "skill.json");
    await this.loadSkill(existing.dir, manifestPath);
  }

  /**
   * Dispose all skills.
   */
  async disposeAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      await skill.provider.dispose?.();
    }
    this.skills.clear();
  }
}
