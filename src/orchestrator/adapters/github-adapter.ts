import type { InputAdapter } from "./types";
import type { TaskSource } from "../agent-registry";

export interface GitHubAdapterConfig {
  owner: string;
  repo: string;
  token: string;
  label?: string;
  interval?: number; // seconds
}

/**
 * Wraps GitHub polling logic to emit TaskSource for each labeled issue.
 * Uses the GitHub REST API directly to keep adapter logic self-contained.
 */
export class GitHubAdapter implements InputAdapter {
  readonly name = "github";
  onTask: (source: TaskSource) => void = () => {};

  private readonly config: GitHubAdapterConfig;
  private timer: ReturnType<typeof setInterval> | null = null;
  private seenIssues = new Set<number>();

  constructor(config: GitHubAdapterConfig) {
    this.config = config;
  }

  async start(): Promise<void> {
    const intervalMs = (this.config.interval ?? 180) * 1000;
    await this.poll();
    this.timer = setInterval(() => this.poll().catch(() => {}), intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async poll(): Promise<void> {
    const { owner, repo, token, label = "tierzero-agent" } = this.config;
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?labels=${encodeURIComponent(label)}&state=open`;

    const resp = await fetch(url, {
      headers: {
        Authorization: `token ${token}`,
        Accept: "application/vnd.github.v3+json",
      },
    });

    if (!resp.ok) return;

    const issues = (await resp.json()) as Array<{
      number: number;
      title: string;
      body: string;
      labels: Array<{ name: string }>;
    }>;

    for (const issue of issues) {
      if (this.seenIssues.has(issue.number)) continue;
      this.seenIssues.add(issue.number);

      const source: TaskSource = {
        type: "github",
        id: `${owner}/${repo}#${issue.number}`,
        payload: issue,
        receivedAt: new Date().toISOString(),
        priority: "normal",
        metadata: { owner, repo, issueNumber: issue.number },
      };

      this.onTask(source);
    }
  }
}
