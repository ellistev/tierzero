import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import express from "express";
import { runArtifactsRouter } from "./run-artifacts-router";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function request(
  app: express.Application,
  path: string,
): Promise<{ status: number; body: any; text: string }> {
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        throw new Error("Failed to get server address");
      }

      fetch(`http://127.0.0.1:${address.port}${path}`)
        .then(async (res) => {
          const text = await res.text();
          let body: any = null;
          try {
            body = JSON.parse(text);
          } catch {
            body = null;
          }
          server.close();
          resolve({ status: res.status, body, text });
        })
        .catch((err) => {
          server.close();
          throw err;
        });
    });
  });
}

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "tierzero-run-artifacts-"));
  tempDirs.push(root);

  const runDir = join(root, "task-123");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "manifest.json"), JSON.stringify({
    taskId: "task-123",
    title: "Reset ACME password",
    category: "code",
    priority: "normal",
    agentName: "codex",
    status: "completed",
    createdAt: "2026-04-24T20:00:00.000Z",
    updatedAt: "2026-04-24T20:05:00.000Z",
  }, null, 2));
  writeFileSync(join(runDir, "input-task.md"), "# Reset ACME password\n\nInput docs here\n");
  writeFileSync(join(runDir, "input.json"), JSON.stringify({ task: { title: "Reset ACME password" } }, null, 2));
  writeFileSync(join(runDir, "knowledge-bank.json"), JSON.stringify([{ title: "Password reset policy" }], null, 2));
  writeFileSync(join(runDir, "output.json"), JSON.stringify({ success: true, filesChanged: ["docs/answer.md"] }, null, 2));

  const app = express();
  app.use(express.json());
  app.use(runArtifactsRouter({ rootDir: root }));

  return { app, root };
}

describe("runArtifactsRouter", () => {
  it("GET /api/run-artifacts returns captured runs", async () => {
    const { app } = makeRoot();
    const res = await request(app, "/api/run-artifacts");

    assert.equal(res.status, 200);
    assert.equal(res.body.length, 1);
    assert.equal(res.body[0].taskId, "task-123");
    assert.equal(res.body[0].agentName, "codex");
  });

  it("GET /api/run-artifacts/:taskId returns the full artifact payload", async () => {
    const { app } = makeRoot();
    const res = await request(app, "/api/run-artifacts/task-123");

    assert.equal(res.status, 200);
    assert.equal(res.body.summary.taskId, "task-123");
    assert.match(res.body.inputTask, /Input docs here/);
    assert.equal(res.body.knowledgeBank[0].title, "Password reset policy");
    assert.equal(res.body.output.success, true);
  });

  it("GET /run-artifacts renders the UI page", async () => {
    const { app } = makeRoot();
    const res = await request(app, "/run-artifacts");

    assert.equal(res.status, 200);
    assert.match(res.text, /TierZero runs/);
    assert.match(res.text, /Input docs/);
    assert.match(res.text, /Knowledge bank/);
    assert.match(res.text, /Output/);
    assert.match(res.text, /Reset ACME password/);
  });
});
