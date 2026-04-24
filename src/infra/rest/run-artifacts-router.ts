import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Router } from "express";

export interface RunArtifactsRouterDeps {
  rootDir?: string;
}

interface RunArtifactSummary {
  taskId: string;
  title: string;
  category: string | null;
  priority: string | null;
  agentName: string | null;
  status: string;
  createdAt: string | null;
  updatedAt: string | null;
}

interface RunArtifactRecord {
  summary: RunArtifactSummary;
  inputTask: string;
  input: Record<string, unknown>;
  knowledgeBank: unknown[];
  output: Record<string, unknown>;
}

export function runArtifactsRouter(deps: RunArtifactsRouterDeps = {}): Router {
  const rootDir = deps.rootDir ?? join(process.cwd(), ".tierzero", "run-artifacts");
  const router = Router();

  router.get("/api/run-artifacts", (_req, res) => {
    res.json(listRuns(rootDir));
  });

  router.get("/api/run-artifacts/latest", (_req, res) => {
    const latest = listRuns(rootDir)[0];
    if (!latest) {
      res.status(404).json({ message: "No run artifacts found" });
      return;
    }

    const record = readRun(rootDir, latest.taskId);
    if (!record) {
      res.status(404).json({ message: "Run artifacts not found" });
      return;
    }

    res.json(record);
  });

  router.get("/api/run-artifacts/:taskId", (req, res) => {
    const record = readRun(rootDir, req.params.taskId);
    if (!record) {
      res.status(404).json({ message: "Run artifacts not found" });
      return;
    }

    res.json(record);
  });

  router.get("/run-artifacts", (req, res) => {
    const runs = listRuns(rootDir);
    const selectedTaskId = typeof req.query.taskId === "string" ? req.query.taskId : runs[0]?.taskId;
    const selected = selectedTaskId ? readRun(rootDir, selectedTaskId) : null;

    res.type("html").send(renderRunArtifactsPage(runs, selected));
  });

  return router;
}

function listRuns(rootDir: string): RunArtifactSummary[] {
  if (!existsSync(rootDir)) return [];

  return readdirSync(rootDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readSummary(rootDir, entry.name))
    .filter((entry): entry is RunArtifactSummary => entry !== null)
    .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""));
}

function readRun(rootDir: string, taskId: string): RunArtifactRecord | null {
  const summary = readSummary(rootDir, taskId);
  if (!summary) return null;

  const runDir = join(rootDir, taskId);
  return {
    summary,
    inputTask: readText(join(runDir, "input-task.md")),
    input: readObject(join(runDir, "input.json")),
    knowledgeBank: readArray(join(runDir, "knowledge-bank.json")),
    output: readObject(join(runDir, "output.json")),
  };
}

function readSummary(rootDir: string, taskId: string): RunArtifactSummary | null {
  const manifest = readObject(join(rootDir, taskId, "manifest.json"));
  if (!manifest.taskId) return null;

  return {
    taskId: String(manifest.taskId),
    title: valueOrNull(manifest.title) ?? String(manifest.taskId),
    category: valueOrNull(manifest.category),
    priority: valueOrNull(manifest.priority),
    agentName: valueOrNull(manifest.agentName),
    status: valueOrNull(manifest.status) ?? "unknown",
    createdAt: valueOrNull(manifest.createdAt),
    updatedAt: valueOrNull(manifest.updatedAt),
  };
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return "";
  }
}

function readObject(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function readArray(path: string): unknown[] {
  try {
    const value = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function valueOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function renderRunArtifactsPage(runs: RunArtifactSummary[], selected: RunArtifactRecord | null): string {
  const title = selected?.summary.title ?? "No run artifacts yet";
  const selectedTaskId = selected?.summary.taskId ?? "";

  const runLinks = runs.length > 0
    ? runs.map((run) => {
        const active = run.taskId === selectedTaskId;
        return `<a class="run-link${active ? " active" : ""}" href="/run-artifacts?taskId=${encodeURIComponent(run.taskId)}">
          <strong>${escapeHtml(run.title)}</strong>
          <span>${escapeHtml(run.taskId)}</span>
          <span>${escapeHtml(run.status)}</span>
        </a>`;
      }).join("")
    : `<div class="empty">No runs captured yet.</div>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>TierZero Run Artifacts</title>
  <style>
    :root { color-scheme: dark; }
    body { margin: 0; font-family: Inter, Arial, sans-serif; background: #0b1020; color: #e5e7eb; }
    .layout { display: grid; grid-template-columns: 320px 1fr; min-height: 100vh; }
    .sidebar { border-right: 1px solid #1f2937; padding: 20px; background: #0f172a; }
    .content { padding: 20px; }
    .run-link { display: grid; gap: 4px; padding: 12px; margin-bottom: 10px; border: 1px solid #1f2937; border-radius: 10px; color: inherit; text-decoration: none; background: #111827; }
    .run-link.active { border-color: #60a5fa; background: #172554; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; color: #93c5fd; }
    .grid { display: grid; gap: 16px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .card { border: 1px solid #1f2937; border-radius: 12px; background: #111827; overflow: hidden; }
    .card h2 { margin: 0; padding: 14px 16px; font-size: 15px; border-bottom: 1px solid #1f2937; }
    pre { margin: 0; padding: 16px; overflow: auto; white-space: pre-wrap; word-break: break-word; font: 12px/1.5 ui-monospace, SFMono-Regular, Consolas, monospace; }
    .empty-state { border: 1px dashed #334155; border-radius: 12px; padding: 24px; background: #111827; }
    .subtle { color: #9ca3af; }
  </style>
</head>
<body>
  <div class="layout">
    <aside class="sidebar">
      <h1>TierZero runs</h1>
      <p class="subtle">Codex / managed-agent artifact viewer</p>
      ${runLinks}
    </aside>
    <main class="content">
      <h1>${escapeHtml(title)}</h1>
      ${selected ? `
        <div class="meta">
          <span>task: ${escapeHtml(selected.summary.taskId)}</span>
          <span>agent: ${escapeHtml(selected.summary.agentName ?? "unknown")}</span>
          <span>status: ${escapeHtml(selected.summary.status)}</span>
          <span>updated: ${escapeHtml(selected.summary.updatedAt ?? "n/a")}</span>
        </div>
        <div class="grid">
          <section class="card">
            <h2>Input docs</h2>
            <pre>${escapeHtml(selected.inputTask)}</pre>
          </section>
          <section class="card">
            <h2>Knowledge bank</h2>
            <pre>${escapeHtml(JSON.stringify(selected.knowledgeBank, null, 2))}</pre>
          </section>
          <section class="card">
            <h2>Output</h2>
            <pre>${escapeHtml(JSON.stringify(selected.output, null, 2))}</pre>
          </section>
        </div>
      ` : `<div class="empty-state">No run artifact selected yet.</div>`}
    </main>
  </div>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}
