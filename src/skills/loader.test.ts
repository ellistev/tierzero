import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { SkillLoader } from "./loader";

describe("SkillLoader", () => {
  it("scans bundled skills directory", async () => {
    const loader = new SkillLoader({
      skillDirs: [path.resolve(__dirname, "../../skills")],
      config: {
        servicenow: { baseUrl: "https://test.service-now.com" },
        "app-insights": { appId: "test-id", subscription: "test-sub" },
      },
      logger: {
        log: () => {},
        warn: () => {},
        error: () => {},
      },
    });

    const skills = await loader.loadAll();

    // Should find at least servicenow and app-insights
    assert.ok(skills.size >= 2, `Expected >= 2 skills, got ${skills.size}`);
    assert.ok(skills.has("servicenow"), "Should have servicenow skill");
    assert.ok(skills.has("app-insights"), "Should have app-insights skill");
  });

  it("skill has correct capabilities", async () => {
    const loader = new SkillLoader({
      skillDirs: [path.resolve(__dirname, "../../skills")],
      config: {
        servicenow: { baseUrl: "https://test.service-now.com" },
        "app-insights": { appId: "test-id", subscription: "test-sub" },
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await loader.loadAll();

    const sn = loader.get("servicenow");
    assert.ok(sn);
    assert.ok(sn.provider.listCapabilities().includes("ticket-list"));
    assert.ok(sn.provider.listCapabilities().includes("ticket-read"));

    const ai = loader.get("app-insights");
    assert.ok(ai);
    assert.ok(ai.provider.listCapabilities().includes("kql-query"));
  });

  it("findByCapability returns matching skills", async () => {
    const loader = new SkillLoader({
      skillDirs: [path.resolve(__dirname, "../../skills")],
      config: {
        servicenow: { baseUrl: "https://test.service-now.com" },
        "app-insights": { appId: "test-id", subscription: "test-sub" },
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    await loader.loadAll();

    const ticketSkills = loader.findByCapability("ticket-list");
    assert.ok(ticketSkills.length >= 1);
    assert.equal(ticketSkills[0].manifest.name, "servicenow");
  });

  it("skips non-existent directories", async () => {
    const loader = new SkillLoader({
      skillDirs: ["/nonexistent/path"],
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    });

    const skills = await loader.loadAll();
    assert.equal(skills.size, 0);
  });
});
