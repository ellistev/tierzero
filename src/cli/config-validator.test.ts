import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateConfig,
  isValidCron,
  type OrchestratorConfig,
} from "./config-validator";

describe("config-validator", () => {
  describe("validateConfig", () => {
    it("passes with a valid config", () => {
      const config: OrchestratorConfig = {
        adapters: {
          github: {
            owner: "myorg",
            repo: "myrepo",
            interval: 120,
          },
        },
        knowledge: {
          enabled: true,
          backend: "chroma",
          chroma: {
            chromaUrl: "http://localhost:8000",
            collectionName: "tierzero-knowledge",
          },
        },
        agents: {
          "default-agent": {
            type: "claude-code",
            capabilities: ["code", "research"],
            maxConcurrent: 2,
          },
        },
        scheduler: {
          timezone: "UTC",
          jobs: [
            { id: "health-check", schedule: "*/5 * * * *", enabled: true },
          ],
        },
        apiPort: 3500,
      };

      const result = validateConfig(config);
      assert.equal(result.valid, true);
      assert.equal(result.errors.length, 0);
    });

    it("fails when adapters is missing", () => {
      const config = {} as OrchestratorConfig;
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      const err = result.errors.find(e => e.field === "adapters");
      assert.ok(err);
      assert.ok(err.message.includes("Missing required field"));
    });

    it("fails when GitHub owner is missing", () => {
      const config: OrchestratorConfig = {
        adapters: { github: { repo: "myrepo" } },
      };
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      const err = result.errors.find(e => e.field === "adapters.github.owner");
      assert.ok(err);
      assert.ok(err.message.includes("requires 'owner'"));
    });

    it("fails when GitHub repo is missing", () => {
      const config: OrchestratorConfig = {
        adapters: { github: { owner: "myorg" } },
      };
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      const err = result.errors.find(e => e.field === "adapters.github.repo");
      assert.ok(err);
    });

    it("fails when GitHub interval is invalid", () => {
      const config: OrchestratorConfig = {
        adapters: { github: { owner: "o", repo: "r", interval: -1 } },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "adapters.github.interval");
      assert.ok(err);
      assert.ok(err.message.includes("positive number"));
    });

    it("fails when webhook port is out of range", () => {
      const config: OrchestratorConfig = {
        adapters: { webhook: { port: 99999 } },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "adapters.webhook.port");
      assert.ok(err);
      assert.ok(err.message.includes("between 1 and 65535"));
    });

    it("fails when knowledge backend is unrecognized", () => {
      const config = {
        adapters: {},
        knowledge: { enabled: true, backend: "postgres" },
      } as unknown as OrchestratorConfig;
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "knowledge.backend");
      assert.ok(err);
      assert.ok(err.message.includes("memory, chroma"));
    });

    it("fails when knowledge is enabled without an explicit backend", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        knowledge: { enabled: true },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "knowledge.backend");
      assert.ok(err);
      assert.ok(err.message.includes("set explicitly"));
    });

    it("fails when knowledge chromaUrl is not a string", () => {
      const config = {
        adapters: {},
        knowledge: { enabled: true, backend: "chroma", chroma: { chromaUrl: 123 } },
      } as unknown as OrchestratorConfig;
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "knowledge.chroma.chromaUrl");
      assert.ok(err);
    });

    it("fails when knowledge extractor model is not a string", () => {
      const config = {
        adapters: {},
        knowledge: {
          enabled: true,
          backend: "memory",
          extractor: { model: 123 },
        },
      } as unknown as OrchestratorConfig;
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "knowledge.extractor.model");
      assert.ok(err);
    });

    it("fails when apiPort is out of range", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        apiPort: 0,
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "apiPort");
      assert.ok(err);
    });

    it("warns on unrecognized agent type", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        agents: {
          "bad-agent": { type: "unknown-type", capabilities: ["code"] },
        },
      };
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      const err = result.errors.find(e => e.field === "agents.bad-agent.type");
      assert.ok(err);
      assert.ok(err.message.includes("Unrecognized agent type"));
    });

    it("warns on unrecognized capability", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        agents: {
          "my-agent": { type: "claude-code", capabilities: ["flying"] },
        },
      };
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      const err = result.errors.find(e => e.field === "agents.my-agent.capabilities");
      assert.ok(err);
      assert.ok(err.message.includes("Unrecognized capability"));
    });

    it("fails when agent maxConcurrent is invalid", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        agents: {
          "my-agent": { type: "claude-code", maxConcurrent: 0 },
        },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field === "agents.my-agent.maxConcurrent");
      assert.ok(err);
      assert.ok(err.message.includes("positive number"));
    });

    it("fails when scheduler job has no id", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        scheduler: {
          jobs: [{ schedule: "*/5 * * * *", enabled: true }],
        },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field.includes("scheduler.jobs[0].id"));
      assert.ok(err);
    });

    it("fails when scheduler job has invalid cron", () => {
      const config: OrchestratorConfig = {
        adapters: {},
        scheduler: {
          jobs: [{ id: "bad-cron", schedule: "not a cron", enabled: true }],
        },
      };
      const result = validateConfig(config);
      const err = result.errors.find(e => e.field.includes("schedule"));
      assert.ok(err);
      assert.ok(err.message.includes("Invalid cron"));
    });

    it("collects multiple errors at once", () => {
      const config: OrchestratorConfig = {
        adapters: { github: {} }, // missing owner & repo
        agents: {
          "a": { type: "banana" }, // bad type
        },
        apiPort: -1, // bad port
      };
      const result = validateConfig(config);
      assert.equal(result.valid, false);
      assert.ok(result.errors.length >= 3);
    });
  });

  describe("isValidCron", () => {
    it("accepts valid cron expressions", () => {
      assert.equal(isValidCron("* * * * *"), true);
      assert.equal(isValidCron("*/5 * * * *"), true);
      assert.equal(isValidCron("0 12 * * 1-5"), true);
      assert.equal(isValidCron("30 2 1 * *"), true);
      assert.equal(isValidCron("0 0 * * 0"), true);
      assert.equal(isValidCron("*/30 * * * *"), true);
    });

    it("rejects invalid cron expressions", () => {
      assert.equal(isValidCron("not a cron"), false);
      assert.equal(isValidCron("* * *"), false);           // too few fields
      assert.equal(isValidCron("60 * * * *"), false);      // minute out of range
      assert.equal(isValidCron("* 25 * * *"), false);      // hour out of range
      assert.equal(isValidCron("* * 32 * *"), false);      // day out of range
      assert.equal(isValidCron("* * * 13 *"), false);      // month out of range
      assert.equal(isValidCron("* * * * * *"), false);     // too many fields
    });
  });
});
