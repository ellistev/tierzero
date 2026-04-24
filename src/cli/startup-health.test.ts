import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runStartupHealthCheck,
  checkCodexCLI,
  checkCodexAuth,
  checkClaudeCodeCLI,
  checkClaudeCodeAuth,
  checkGitHubToken,
} from "./startup-health";
import type { OrchestratorConfig } from "./config-validator";

describe("startup-health", () => {
  describe("checkCodexCLI", () => {
    it("returns ok when CLI is installed", async () => {
      const execFn = async () => ({ stdout: "codex-cli 0.121.0", stderr: "" });
      const result = await checkCodexCLI({ execFn });
      assert.equal(result.status, "ok");
      assert.ok(result.message.includes("Installed"));
    });

    it("returns warn when CLI is not installed", async () => {
      const execFn = async () => { throw new Error("not found"); };
      const result = await checkCodexCLI({ execFn });
      assert.equal(result.status, "warn");
      assert.ok(result.message.includes("Not installed"));
    });
  });

  describe("checkCodexAuth", () => {
    it("returns ok when authenticated", async () => {
      const execFn = async () => ({ stdout: "Logged in using ChatGPT", stderr: "" });
      const result = await checkCodexAuth({ execFn });
      assert.equal(result.status, "ok");
      assert.ok(result.message.includes("Authenticated"));
    });

    it("returns warn when not authenticated", async () => {
      const execFn = async () => { throw new Error("not authed"); };
      const result = await checkCodexAuth({ execFn });
      assert.equal(result.status, "warn");
      assert.ok(result.message.includes("Not authenticated"));
    });
  });

  describe("checkClaudeCodeCLI", () => {
    it("returns ok when CLI is installed", async () => {
      const execFn = async () => ({ stdout: "1.0.0", stderr: "" });
      const result = await checkClaudeCodeCLI({ execFn });
      assert.equal(result.status, "ok");
      assert.ok(result.message.includes("Installed"));
    });

    it("returns warn when CLI is not installed", async () => {
      const execFn = async () => { throw new Error("not found"); };
      const result = await checkClaudeCodeCLI({ execFn });
      assert.equal(result.status, "warn");
      assert.ok(result.message.includes("Not installed"));
    });
  });

  describe("checkClaudeCodeAuth", () => {
    it("returns ok when authenticated", async () => {
      const execFn = async () => ({ stdout: "Authenticated", stderr: "" });
      const result = await checkClaudeCodeAuth({ execFn });
      assert.equal(result.status, "ok");
      assert.ok(result.message.includes("Authenticated"));
    });

    it("returns warn when not authenticated", async () => {
      const execFn = async () => { throw new Error("not authed"); };
      const result = await checkClaudeCodeAuth({ execFn });
      assert.equal(result.status, "warn");
      assert.ok(result.message.includes("Not authenticated"));
    });
  });

  describe("checkGitHubToken", () => {
    it("returns fail when no token provided", async () => {
      const origToken = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
      try {
        const result = await checkGitHubToken(undefined);
        assert.equal(result.status, "fail");
        assert.ok(result.message.includes("No token"));
      } finally {
        if (origToken !== undefined) process.env.GITHUB_TOKEN = origToken;
      }
    });
  });

  describe("runStartupHealthCheck", () => {
    it("passes with valid codex config and mocked dependencies", async () => {
      const config: OrchestratorConfig = {
        adapters: {
          github: { owner: "org", repo: "repo" },
        },
        agents: {
          default: { type: "codex", capabilities: ["code"] },
        },
      };

      const execFn = async (cmd: string) => {
        if (cmd === "codex --version") return { stdout: "codex-cli 0.121.0", stderr: "" };
        if (cmd === "codex login status") return { stdout: "Logged in using ChatGPT", stderr: "" };
        return { stdout: "", stderr: "" };
      };

      const result = await runStartupHealthCheck(config, { execFn, skipNetwork: true });
      assert.equal(result.critical, false);

      const configCheck = result.checks.find(c => c.component === "Config");
      assert.ok(configCheck);
      assert.equal(configCheck.status, "ok");

      const cliCheck = result.checks.find(c => c.component === "Codex CLI");
      assert.ok(cliCheck);
      assert.equal(cliCheck.status, "ok");

      const authCheck = result.checks.find(c => c.component === "Codex Auth");
      assert.ok(authCheck);
      assert.equal(authCheck.status, "ok");
    });

    it("marks critical when config is invalid", async () => {
      const config = {} as OrchestratorConfig;
      const execFn = async () => ({ stdout: "ok", stderr: "" });

      const result = await runStartupHealthCheck(config, { execFn, skipNetwork: true });
      assert.equal(result.critical, true);

      const configCheck = result.checks.find(c => c.component === "Config");
      assert.ok(configCheck);
      assert.equal(configCheck.status, "fail");
    });

    it("handles codex CLI not installed gracefully", async () => {
      const config: OrchestratorConfig = {
        adapters: {},
      };

      const execFn = async () => { throw new Error("not found"); };
      const result = await runStartupHealthCheck(config, { execFn, skipNetwork: true });

      const cliCheck = result.checks.find(c => c.component === "Codex CLI");
      assert.ok(cliCheck);
      assert.equal(cliCheck.status, "warn");

      const authCheck = result.checks.find(c => c.component === "Codex Auth");
      assert.equal(authCheck, undefined);
    });
  });
});
