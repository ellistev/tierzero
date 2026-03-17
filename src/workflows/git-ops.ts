/**
 * Git operations helper for the issue pipeline.
 * Wraps git CLI to create branches, commit, push, etc.
 */

import { execSync, type ExecSyncOptions } from "node:child_process";

export interface GitOpsConfig {
  /** Working directory for git operations */
  cwd: string;
  /** Remote name (default: "origin") */
  remote?: string;
}

export class GitOps {
  private readonly cwd: string;
  private readonly remote: string;

  constructor(config: GitOpsConfig) {
    this.cwd = config.cwd;
    this.remote = config.remote ?? "origin";
  }

  private exec(cmd: string): string {
    const opts: ExecSyncOptions = { cwd: this.cwd, encoding: "utf-8", stdio: "pipe" };
    return execSync(cmd, opts).toString().trim();
  }

  /** Get current branch name */
  getCurrentBranch(): string {
    return this.exec("git branch --show-current");
  }

  /** Check if working tree has uncommitted changes */
  hasChanges(): boolean {
    const status = this.exec("git status --porcelain");
    return status.length > 0;
  }

  /** Fetch latest from remote */
  fetch(): void {
    this.exec(`git fetch ${this.remote}`);
  }

  /** Create and checkout a new branch from base (default: main) */
  createBranch(name: string, base?: string): void {
    const baseBranch = base ?? "main";
    this.exec(`git checkout ${baseBranch}`);
    this.exec(`git pull ${this.remote} ${baseBranch}`);
    this.exec(`git checkout -b ${name}`);
  }

  /** Stage all changes and commit */
  commitAll(message: string): string {
    this.exec("git add -A");
    this.exec(`git commit -m "${message.replace(/"/g, '\\"')}"`);
    return this.exec("git rev-parse HEAD");
  }

  /** Push branch to remote */
  push(branch: string): void {
    this.exec(`git push -u ${this.remote} ${branch}`);
  }

  /** Checkout main and pull latest, nuking any dirty state */
  resetToMain(): void {
    // Force-clean any uncommitted changes or untracked files the agent left behind
    this.exec("git reset --hard");
    this.exec("git clean -fd");
    this.exec("git checkout main");
    this.exec(`git pull ${this.remote} main`);
  }

  /** Get list of changed files vs base branch */
  getChangedFiles(baseBranch?: string): string[] {
    const base = baseBranch ?? "main";
    const diff = this.exec(`git diff --name-only ${base}...HEAD`);
    return diff ? diff.split("\n").filter(Boolean) : [];
  }

  /** Get the short SHA of HEAD */
  getHeadSha(): string {
    return this.exec("git rev-parse --short HEAD");
  }

  /** Clean up a branch (delete local) */
  deleteBranch(name: string): void {
    try {
      this.exec(`git branch -D ${name}`);
    } catch {
      // Branch may not exist, that's fine
    }
  }

  /** Generate a branch name from issue number and title */
  static branchName(issueNumber: number, title: string): string {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40);
    return `tierzero/${issueNumber}-${slug}`;
  }
}
