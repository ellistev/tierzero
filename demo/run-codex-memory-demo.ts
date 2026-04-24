import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { InMemoryKnowledgeStore } from "../src/knowledge/in-memory-store";
import { CodexCliAgent } from "../src/workflows/codex-cli-agent";
import type { IssueContext } from "../src/workflows/issue-pipeline";

async function main() {
  const rootDir = join(process.cwd(), "demo", "codex-memory-artifacts");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const workDir = join(rootDir, `workdir-${runId}`);
  const artifactsDir = join(rootDir, "last-run");

  rmSync(artifactsDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });
  mkdirSync(artifactsDir, { recursive: true });
  mkdirSync(join(workDir, "docs"), { recursive: true });
  mkdirSync(join(workDir, "scripts"), { recursive: true });

  writeFileSync(
    join(workDir, "package.json"),
    JSON.stringify({
      name: "codex-memory-demo",
      private: true,
      version: "1.0.0",
      scripts: {
        test: "node scripts/verify-answer.mjs",
      },
    }, null, 2) + "\n",
    "utf-8",
  );

  writeFileSync(
    join(workDir, "scripts", "verify-answer.mjs"),
    `import { readFileSync } from "node:fs";
const answer = readFileSync(new URL("../docs/answer.md", import.meta.url), "utf-8");
if (!answer.includes("manager approval")) throw new Error("missing manager approval note");
if (!answer.includes("identity")) throw new Error("missing identity verification note");
if (!answer.includes("tenant-specific")) throw new Error("missing tenant-specific note");
console.log("answer verified");
`,
    "utf-8",
  );

  writeFileSync(
    join(workDir, "README.md"),
    "# Codex Memory Demo\n\nCreate docs/answer.md from the task context.\n",
    "utf-8",
  );

  execFileSync("git", ["init"], { cwd: workDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "tierzero-demo@example.com"], { cwd: workDir, stdio: "pipe" });
  execFileSync("git", ["config", "user.name", "TierZero Demo"], { cwd: workDir, stdio: "pipe" });
  execFileSync("git", ["add", "."], { cwd: workDir, stdio: "pipe" });
  execFileSync("git", ["commit", "-m", "init demo"], { cwd: workDir, stdio: "pipe" });

  const knowledgeStore = new InMemoryKnowledgeStore();
  await knowledgeStore.add({
    type: "solution",
    title: "ACME password reset policy",
    content: "Always verify the user's identity before starting a reset. Contractor accounts require manager approval before unlocking or resetting.",
    source: { taskId: "seed-1", agentName: "seed", timestamp: new Date().toISOString() },
    tags: ["password-reset", "acme", "approval"],
    relatedFiles: ["README.md"],
    confidence: 0.95,
    supersededBy: null,
  });
  await knowledgeStore.add({
    type: "pattern",
    title: "Tenant-specific reset guidance",
    content: "Password reset notes must explicitly say the workflow is tenant-specific so operators do not reuse the wrong playbook across customers.",
    source: { taskId: "seed-2", agentName: "seed", timestamp: new Date().toISOString() },
    tags: ["tenant", "password-reset"],
    relatedFiles: ["README.md"],
    confidence: 0.9,
    supersededBy: null,
  });

  const issue: IssueContext = {
    number: 101,
    title: "Document the ACME password reset flow",
    description: [
      "Create docs/answer.md.",
      "Requirements:",
      "- include a short heading",
      "- include three bullets covering identity verification, manager approval for contractors, and tenant-specific handling",
      "- end with a one-line operator takeaway",
    ].join("\n"),
    labels: ["documentation", "password-reset"],
    comments: [
      "Keep it short and operational.",
      "Use the prior knowledge rather than inventing policy.",
    ],
  };

  const agent = new CodexCliAgent({
    codexPath: "codex",
    model: "gpt-5.4",
    timeoutMs: 180_000,
    knowledgeStore,
    artifactsDir,
    extraContext: "This is a demo harness. Keep the diff small and write only the requested answer file.",
  });

  const result = await agent.solve(issue, workDir);

  const answerPath = join(workDir, "docs", "answer.md");
  if (existsSync(answerPath)) {
    copyFileSync(answerPath, join(artifactsDir, "output-answer.md"));
  }

  let diff = "";
  try {
    diff = execFileSync("git", ["diff", "HEAD", "--", "docs/answer.md"], {
      cwd: workDir,
      encoding: "utf-8",
      stdio: "pipe",
    });
  } catch {
    // ignore
  }
  writeFileSync(join(artifactsDir, "output-diff.patch"), diff, "utf-8");
  writeFileSync(join(artifactsDir, "run-result.json"), JSON.stringify(result, null, 2) + "\n", "utf-8");
  writeFileSync(join(artifactsDir, "knowledge-stats.json"), JSON.stringify(await knowledgeStore.stats(), null, 2) + "\n", "utf-8");

  writeFileSync(join(rootDir, "LATEST_RUN.txt"), `${runId}\n${workDir}\n${artifactsDir}\n`, "utf-8");

  console.log(`Artifacts written to: ${artifactsDir}`);
  console.log(`Workdir: ${workDir}`);
  console.log(`Answer file: ${answerPath}`);
  console.log(readFileSync(join(artifactsDir, "run-result.json"), "utf-8"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
