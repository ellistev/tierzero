import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { IssuePipeline, type CodeAgent, type IssueContext } from "./issue-pipeline";
import type { Ticket } from "../connectors/types";

describe("IssuePipeline security gate integration", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "tz-security-gate-"));
    execSync("git init", { cwd: dir, stdio: "pipe" });
    execSync('git config user.email "zara@example.com"', { cwd: dir, stdio: "pipe" });
    execSync('git config user.name "Zara"', { cwd: dir, stdio: "pipe" });
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const hello = 'world';\n", "utf-8");
    execSync("git add .", { cwd: dir, stdio: "pipe" });
    execSync('git commit -m "init"', { cwd: dir, stdio: "pipe" });
    execSync("git branch -M main", { cwd: dir, stdio: "pipe" });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("fails before PR creation when pending changes contain a secret", async () => {
    const issueComments: string[] = [];
    let createPRCalls = 0;

    const fakeTicket: Ticket = {
      id: 82,
      number: 82,
      title: "Block PR creation when secret scanner finds private data in pending changes",
      body: "Add a pre-PR secret gate.",
      labels: ["tierzero-agent", "priority-1"],
      assignees: [],
      author: "ellistev",
      state: "open",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: "https://github.com/ellistev/tierzero/issues/82",
    };

    const codeAgent: CodeAgent = {
      async solve(_issue: IssueContext, workDir: string) {
        writeFileSync(
          join(workDir, "src", "leak.ts"),
          'export const token = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";\n',
          "utf-8",
        );
        return { summary: "Introduced a secret-bearing file", filesChanged: ["src/leak.ts"] };
      },
      async fixTests() {
        return { summary: "no-op", filesChanged: [] };
      },
      async fixReviewFindings() {
        return { summary: "no-op", filesChanged: [] };
      },
    };

    const pipeline = new IssuePipeline({
      github: {
        addComment: async (_issueId: number, body: string) => { issueComments.push(body); },
        addLabel: async () => {},
        removeLabel: async () => {},
        updateIssueState: async () => {},
      } as any,
      prConfig: {
        githubToken: "fake-token",
        owner: "ellistev",
        repo: "tierzero",
      },
      workDir: dir,
      codeAgent,
      testCommand: "node -e \"process.exit(0)\"",
      logger: { log: () => {}, error: () => {} },
    });

    (pipeline as any).pr = {
      createPR: async () => {
        createPRCalls++;
        return { number: 999, url: "https://example.com/pr/999" };
      },
      commentOnPR: async () => {},
      mergePR: async () => {},
    };

    const result = await pipeline.run(fakeTicket);

    assert.equal(result.status, "failed");
    assert.equal(result.prNumber, undefined);
    assert.equal(createPRCalls, 0);
    assert.ok(issueComments.some((c) => c.includes("blocked PR creation")));
    assert.ok(issueComments.some((c) => c.includes("github-token")));
  });
});
