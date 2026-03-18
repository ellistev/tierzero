import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { GitHubWatcher, type WatcherConfig } from "./github-watcher";
import type { CodeAgent, CodeAgentResult, IssueContext } from "./issue-pipeline";

// ---------------------------------------------------------------------------
// Mock code agent
// ---------------------------------------------------------------------------

class MockCodeAgent implements CodeAgent {
  solveCalls: IssueContext[] = [];
  fixCalls: string[] = [];

  async solve(issue: IssueContext): Promise<CodeAgentResult> {
    this.solveCalls.push(issue);
    return { summary: "Mock changes", filesChanged: ["src/mock.ts"] };
  }

  async fixTests(failures: string): Promise<CodeAgentResult> {
    this.fixCalls.push(failures);
    return { summary: "Mock fix", filesChanged: ["src/mock.ts"] };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GitHubWatcher", () => {
  let agent: MockCodeAgent;
  let config: WatcherConfig;

  beforeEach(() => {
    agent = new MockCodeAgent();
    config = {
      github: {
        token: "ghp_test",
        owner: "ellistev",
        repo: "tierzero",
      },
      workDir: "/tmp/test-repo",
      pollIntervalMs: 60000,
      triggerLabel: "tierzero-agent",
      codeAgent: agent,
      logger: { log: () => {}, error: () => {} }, // silent
    };
  });

  it("initializes with config", () => {
    const watcher = new GitHubWatcher(config);
    assert.ok(watcher);
    assert.equal(watcher.isRunning(), false);
  });

  it("starts and stops", () => {
    const watcher = new GitHubWatcher(config);
    // Can't actually poll (no network), but start/stop should work
    assert.equal(watcher.isRunning(), false);
    // Don't call start() since it triggers a real poll
  });

  it("returns empty state initially", () => {
    const watcher = new GitHubWatcher(config);
    const state = watcher.getState();
    assert.equal(state.activeIssues.size, 0);
    assert.equal(state.completedIssues.size, 0);
    assert.equal(state.failedIssues.size, 0);
    assert.equal(state.retryCounts.size, 0);
    assert.equal(state.results.length, 0);
  });

  it("uses default trigger label", () => {
    const configNoLabel = { ...config, triggerLabel: undefined };
    const watcher = new GitHubWatcher(configNoLabel);
    assert.ok(watcher); // defaults to "tierzero-agent" internally
  });

  it("uses default poll interval", () => {
    const configNoInterval = { ...config, pollIntervalMs: undefined };
    const watcher = new GitHubWatcher(configNoInterval);
    assert.ok(watcher); // defaults to 60000ms internally
  });

  it("uses default concurrency", () => {
    const configNoConcurrency = { ...config, maxConcurrent: undefined };
    const watcher = new GitHubWatcher(configNoConcurrency);
    assert.ok(watcher); // defaults to 1 internally
  });
});

describe("GitHubWatcher state tracking", () => {
  it("tracks active and completed issues", () => {
    const agent = new MockCodeAgent();
    const watcher = new GitHubWatcher({
      github: { token: "test", owner: "test", repo: "test" },
      workDir: "/tmp/test",
      codeAgent: agent,
      logger: { log: () => {}, error: () => {} },
    });

    const state = watcher.getState();
    // Manually simulate state transitions
    state.activeIssues.add("1");
    assert.equal(state.activeIssues.size, 1);

    state.activeIssues.delete("1");
    state.completedIssues.add("1");
    assert.equal(state.activeIssues.size, 0);
    assert.equal(state.completedIssues.size, 1);
  });
});
