import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateConfig, cmdInit } from "./init-command";
import { validateConfig } from "./config-validator";
import { existsSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("init-command", () => {
  describe("generateConfig", () => {
    it("generates a valid config with defaults", () => {
      const config = generateConfig({});
      const result = validateConfig(config);
      assert.equal(result.valid, true, `Errors: ${result.errors.map(e => e.message).join(", ")}`);
    });

    it("generates a valid config with custom options", () => {
      const config = generateConfig({
        owner: "myorg",
        repo: "myapp",
        agent: "native",
        interval: 60,
      });

      const result = validateConfig(config);
      assert.equal(result.valid, true);
      assert.equal(config.adapters?.github?.owner, "myorg");
      assert.equal(config.adapters?.github?.repo, "myapp");
      assert.equal(config.adapters?.github?.interval, 60);

      const agents = config.agents as Record<string, any>;
      assert.equal(agents["default-agent"].type, "native");
    });

    it("includes sensible defaults", () => {
      const config = generateConfig({});

      assert.equal(config.apiPort, 3500);
      assert.equal(config.maxConcurrent, 3);
      assert.equal(config.taskTimeoutMs, 900_000);
      assert.ok(config.adapters?.github?.trustedAuthors);
      assert.equal(config.adapters?.github?.requireTrustedAuthor, true);
    });

    it("includes prReview defaults", () => {
      const config = generateConfig({});
      const prReview = config.prReview as Record<string, unknown>;
      assert.ok(prReview);
      assert.equal(prReview.enabled, true);
      assert.ok(Array.isArray(prReview.rules));
    });
  });

  describe("cmdInit", () => {
    it("writes a valid config file", async () => {
      const outputPath = join(tmpdir(), `tierzero-test-${Date.now()}.json`);
      try {
        const result = await cmdInit({
          owner: "testorg",
          repo: "testrepo",
          output: outputPath,
          force: true,
        });

        assert.equal(result, outputPath);
        assert.ok(existsSync(outputPath));

        const content = JSON.parse(readFileSync(outputPath, "utf-8"));
        assert.equal(content.adapters.github.owner, "testorg");
        assert.equal(content.adapters.github.repo, "testrepo");

        // Validate the written config
        const validation = validateConfig(content);
        assert.equal(validation.valid, true);
      } finally {
        try { unlinkSync(outputPath); } catch {}
      }
    });

    it("does not overwrite existing file without --force", async () => {
      const outputPath = join(tmpdir(), `tierzero-test-${Date.now()}.json`);
      try {
        // Write initial file
        const { writeFileSync } = await import("fs");
        writeFileSync(outputPath, '{"existing": true}', "utf-8");

        await cmdInit({ output: outputPath, force: false });

        // File should remain unchanged
        const content = readFileSync(outputPath, "utf-8");
        assert.ok(content.includes('"existing"'));
      } finally {
        try { unlinkSync(outputPath); } catch {}
      }
    });
  });
});
