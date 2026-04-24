import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { inspect } from "node:util";

import { createKnowledgeStore } from "../../src/knowledge/factory";
import { AgentRegistry } from "../../src/orchestrator/agent-registry";
import { createAgentExecutor } from "../../src/orchestrator/agent-executor";
import { AgentSupervisor } from "../../src/orchestrator/supervisor";
import { TaskRouter } from "../../src/orchestrator/task-router";
import { WebhookAdapter } from "../../src/orchestrator/adapters/webhook-adapter";
import { TaskQueueStore } from "../../src/read-models/task-queue";
import type { ExtractedEntry, ExtractionContext, KnowledgeExtractor } from "../../src/knowledge/extractor";
import type { KnowledgeStore } from "../../src/knowledge/store";

const cleanupPaths: string[] = [];

afterEach(async () => {
  while (cleanupPaths.length > 0) {
    const path = cleanupPaths.pop();
    if (!path) continue;
    rmSync(path, { recursive: true, force: true });
  }
});

describe("Memory/context integration harness", () => {
  it("routes webhook tasks through the real executor with scoped recall and no leakage", async () => {
    const harness = await createHarness();
    try {
      await harness.knowledgeStore.add({
        type: "solution",
        title: "Acme password reset runbook",
        content: "Use the ACME reset flow and verify the identity challenge.",
        source: { taskId: "seed-acme", agentName: "seed", timestamp: new Date().toISOString() },
        tags: ["password", "reset", "runbook"],
        relatedFiles: ["README.md"],
        scope: { tenant: "acme", workflowType: "password-reset", queue: "service desk" },
        confidence: 0.95,
        supersededBy: null,
      });
      await harness.knowledgeStore.add({
        type: "solution",
        title: "Globex password reset runbook",
        content: "Use the GLOBEX reset flow and route approvals through the Globex desk.",
        source: { taskId: "seed-globex", agentName: "seed", timestamp: new Date().toISOString() },
        tags: ["password", "reset", "runbook"],
        relatedFiles: ["README.md"],
        scope: { tenant: "globex", workflowType: "password-reset", queue: "service desk" },
        confidence: 0.95,
        supersededBy: null,
      });

      const taskId = await harness.submitWebhookTask({
        title: "Reset employee password",
        description: "Employee cannot log in after a password expiry.",
        category: "code",
        metadata: {
          tenant: "acme",
          workflowType: "password-reset",
          queue: "service desk",
        },
      });

      await waitForTaskStatus(harness.taskStore, taskId, "completed", 8000);

      const prompt = await waitForLatestPrompt(harness.repoDir, 3000);
      assert.match(prompt, /Acme password reset runbook/);
      assert.doesNotMatch(prompt, /Globex password reset runbook/);

      const record = harness.taskStore.get(taskId);
      assert.ok(record);
      assert.equal(record?.status, "completed");
    } finally {
      await harness.cleanup();
    }
  });

  it("writes scoped knowledge back and compounds into the next matching task", async () => {
    const harness = await createHarness();
    try {
      const firstTaskId = await harness.submitWebhookTask({
        title: "Unlock employee account",
        description: "The employee is locked out after too many failed attempts.",
        category: "code",
        metadata: {
          tenant: "acme",
          workflowType: "password-reset",
          queue: "service desk",
        },
      });

      await waitForTaskStatus(harness.taskStore, firstTaskId, "completed", 8000);
      await new Promise((resolve) => setTimeout(resolve, 200));

      assert.ok(harness.extractor.lastContext, "Extractor should receive context");
      assert.ok(harness.extractor.lastContext?.filesModified.includes("README.md"));

      const learnedEntries = await harness.knowledgeStore.search("learned unlock employee account", {
        scope: { tenant: "acme", workflowType: "password-reset", queue: "service desk" },
      });
      assert.ok(learnedEntries.length > 0, "Expected extracted knowledge to be stored");
      assert.equal(learnedEntries[0].scope?.tenant, "acme");
      assert.equal(learnedEntries[0].scope?.workflowType, "password-reset");
      assert.equal(learnedEntries[0].scope?.queue, "service desk");

      const secondTaskId = await harness.submitWebhookTask({
        title: "Unlock employee account again",
        description: "A second employee hit the same lockout flow.",
        category: "code",
        metadata: {
          tenant: "acme",
          workflowType: "password-reset",
          queue: "service desk",
        },
      });

      await waitForTaskStatus(harness.taskStore, secondTaskId, "completed", 8000);

      const secondPrompt = await waitForLatestPrompt(harness.repoDir, 3000);
      assert.match(secondPrompt, /Learned fix for Unlock employee account/);

      const thirdTaskId = await harness.submitWebhookTask({
        title: "Unlock employee account for Globex",
        description: "Globex employee is locked out too.",
        category: "code",
        metadata: {
          tenant: "globex",
          workflowType: "password-reset",
          queue: "service desk",
        },
      });

      await waitForTaskStatus(harness.taskStore, thirdTaskId, "completed", 8000);

      const thirdPrompt = await waitForLatestPrompt(harness.repoDir, 3000);
      assert.doesNotMatch(thirdPrompt, /Learned fix for Unlock employee account/);
    } finally {
      await harness.cleanup();
    }
  });
});

class MockKnowledgeExtractor implements KnowledgeExtractor {
  lastContext: ExtractionContext | null = null;

  async extract(context: ExtractionContext): Promise<ExtractedEntry[]> {
    this.lastContext = context;
    return [
      {
        type: "solution",
        title: `Learned fix for ${context.taskTitle}`,
        content: `Re-use the successful flow from ${context.taskTitle}.`,
        source: {
          taskId: context.taskId,
          agentName: context.agentName,
          timestamp: new Date().toISOString(),
        },
        tags: ["password", "reset", "learned"],
        relatedFiles: context.filesModified,
        confidence: 0.88,
        supersededBy: null,
      },
    ];
  }
}

async function createHarness() {
  const repoDir = mkdtempSync(join(tmpdir(), "tierzero-memory-e2e-"));
  cleanupPaths.push(repoDir);
  initTempGitRepo(repoDir);

  const wrapperPath = createFakeClaudeWrapper(repoDir);
  const knowledgeStore = await createKnowledgeStore({ enabled: true, backend: "memory" });
  assert.ok(knowledgeStore, "Knowledge store should be created");

  const extractor = new MockKnowledgeExtractor();
  const supervisor = new AgentSupervisor({
    maxTotalAgents: 2,
    heartbeatIntervalMs: 60_000,
    heartbeatTimeoutMs: 60_000,
    taskTimeoutMs: 30_000,
    cleanupIntervalMs: 60_000,
    workDirBase: repoDir,
  });

  const registry = new AgentRegistry();
  registry.register({
    name: "memory-agent",
    type: "claude-code",
    capabilities: ["code"],
    maxConcurrent: 1,
    available: true,
    execute: createAgentExecutor({
      supervisor,
      workDir: repoDir,
      claudePath: wrapperPath,
      claudeTimeoutMs: 15_000,
      knowledgeStore: knowledgeStore as KnowledgeStore,
      knowledgeExtractor: extractor,
    }, "memory-agent"),
  });

  const router = new TaskRouter({
    registry,
    logger: { log: () => {}, error: () => {} },
  });
  const taskStore = new TaskQueueStore();
  router.on("event", (event) => taskStore.apply(event));

  const submittedTaskIds: string[] = [];
  const webhook = new WebhookAdapter({ port: 0 });
  webhook.onTask = (source) => {
    const payload = source.payload as Record<string, unknown>;
    const task = router.submit(
      source,
      String(payload.title ?? "Untitled task"),
      String(payload.description ?? ""),
      (payload.category as "code" | "communication" | "research" | "operations" | "monitoring") ?? "code",
    );
    submittedTaskIds.push(task.taskId);
  };

  const server = webhook.getApp().listen(0);
  const port = (server.address() as AddressInfo).port;

  return {
    repoDir,
    extractor,
    knowledgeStore: knowledgeStore as KnowledgeStore,
    taskStore,
    async submitWebhookTask(body: Record<string, unknown>): Promise<string> {
      const beforeCount = submittedTaskIds.length;
      const response = await fetch(`http://127.0.0.1:${port}/api/tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 202);
      const taskId = await waitForSubmittedTask(submittedTaskIds, beforeCount, 3000);
      return taskId;
    },
    async cleanup() {
      await supervisor.shutdown(1000).catch(() => {});
      await new Promise<void>((resolve) => server.close(() => resolve()));
      rmSync(repoDir, { recursive: true, force: true });
    },
  };
}

function initTempGitRepo(repoDir: string): void {
  execFileSync("git", ["init"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tierzero-test@example.com"], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "TierZero Test"], { cwd: repoDir, stdio: "pipe" });
  writeFileSync(join(repoDir, "README.md"), "# TierZero Memory Test\n", "utf-8");
  execFileSync("git", ["add", "."], { cwd: repoDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init"], { cwd: repoDir, stdio: "pipe" });
}

function createFakeClaudeWrapper(repoDir: string): string {
  const nodePath = inspect(process.execPath);
  const runnerPath = join(repoDir, "fake-claude-runner.mjs");
  const wrapperPath = join(repoDir, "fake-claude.ps1");

  writeFileSync(
    runnerPath,
    `import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(process.cwd(), "..");
const args = process.argv.slice(2);
const promptIndex = args.indexOf("--print");
const prompt = promptIndex >= 0 ? args[promptIndex + 1] ?? "" : "";
appendFileSync(join(repoRoot, "agent-prompts.jsonl"), JSON.stringify({ prompt }) + "\\n");
const readmePath = join(repoRoot, "README.md");
const current = readFileSync(readmePath, "utf-8");
writeFileSync(readmePath, current + "\\nupdated-by-fake-claude\\n", "utf-8");
process.stdout.write("fake claude completed");
`,
    "utf-8",
  );

  writeFileSync(
    wrapperPath,
    `& ${nodePath} "$PSScriptRoot\\fake-claude-runner.mjs" @args\nexit $LASTEXITCODE\n`,
    "utf-8",
  );

  return wrapperPath;
}

async function waitForSubmittedTask(taskIds: string[], previousCount: number, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (taskIds.length > previousCount) {
      return taskIds[taskIds.length - 1];
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for webhook task submission");
}

async function waitForTaskStatus(
  store: TaskQueueStore,
  taskId: string,
  status: string,
  timeoutMs: number,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const record = store.get(taskId);
    if (record?.status === status) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const record = store.get(taskId);
  throw new Error(`Task ${taskId} did not reach ${status}. Current: ${record?.status ?? "missing"}`);
}

async function waitForLatestPrompt(repoDir: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      return readLatestPrompt(repoDir);
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  return readLatestPrompt(repoDir);
}

function readLatestPrompt(repoDir: string): string {
  const logPath = join(repoDir, "agent-prompts.jsonl");
  const lines = readFileSync(logPath, "utf-8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  const last = JSON.parse(lines[lines.length - 1]) as { prompt: string };
  return last.prompt;
}
