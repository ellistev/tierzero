/**
 * Tests for Skill Generator.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SkillGenerator } from "./skill-generator";
import type { GeneratedWorkflow } from "./generator";
import type { WorkflowVariable } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWorkflow(overrides: Partial<GeneratedWorkflow> = {}): GeneratedWorkflow {
  return {
    id: "wf-test-123",
    name: "Search Incidents",
    description: "Search for incidents by correlation ID.",
    parameters: [],
    steps: [
      {
        name: "Click search",
        intent: { action: "click", target: "Search button" },
        isParameterized: false,
      },
    ],
    chainSteps: [
      {
        intent: { action: "click", target: "Search button" },
        maxRetries: 2,
        delayAfterMs: 500,
      },
    ],
    source: {
      sessionId: "rec-test",
      recordedAt: "2026-01-01T00:00:00Z",
      actionCount: 1,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SkillGenerator", () => {
  const generator = new SkillGenerator();

  describe("generateSkill", () => {
    it("generates a complete skill structure", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.manifest);
      assert.ok(skill.entryPoint);
      assert.ok(skill.directoryName);
      assert.ok(skill.files["skill.json"]);
      assert.ok(skill.files["index.ts"]);
      assert.ok(skill.files["README.md"]);
    });

    it("uses custom name when provided", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow, "my-custom-skill");

      assert.equal(skill.manifest.name, "my-custom-skill");
      assert.equal(skill.directoryName, "my-custom-skill");
    });

    it("generates skill name from workflow name", () => {
      const workflow = makeWorkflow({ name: "Search ServiceNow Incidents" });
      const skill = generator.generateSkill(workflow);

      assert.equal(skill.manifest.name, "search-servicenow-incidents");
    });
  });

  describe("manifest generation", () => {
    it("includes basic manifest fields", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.equal(skill.manifest.version, "1.0.0");
      assert.equal(skill.manifest.entry, "index.ts");
      assert.ok(skill.manifest.description);
    });

    it("includes execute capability", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.manifest.capabilities?.includes("execute"));
    });

    it("includes parameter capabilities", () => {
      const variables: WorkflowVariable[] = [
        { name: "ticketId", description: "Ticket ID", source: "typed" },
        { name: "priority", description: "Priority level", source: "selected" },
      ];

      const workflow = makeWorkflow({ parameters: variables });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.manifest.capabilities?.includes("set-ticketId"));
      assert.ok(skill.manifest.capabilities?.includes("set-priority"));
    });
  });

  describe("entry point generation", () => {
    it("generates valid TypeScript code", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      // Check for key code structures
      assert.ok(skill.entryPoint.includes("import"));
      assert.ok(skill.entryPoint.includes("implements SkillProvider"));
      assert.ok(skill.entryPoint.includes("async initialize"));
      assert.ok(skill.entryPoint.includes("getCapability"));
      assert.ok(skill.entryPoint.includes("listCapabilities"));
      assert.ok(skill.entryPoint.includes("async execute"));
    });

    it("includes ActionChain execution", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("ActionChain"));
      assert.ok(skill.entryPoint.includes("IntentEngine"));
    });

    it("includes parameter substitution", () => {
      const variables: WorkflowVariable[] = [
        { name: "query", description: "Search query", source: "typed" },
      ];

      const workflow = makeWorkflow({ parameters: variables });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("substituteParams"));
      assert.ok(skill.entryPoint.includes("query"));
    });

    it("includes error handling", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("try"));
      assert.ok(skill.entryPoint.includes("catch"));
    });

    it("includes dispose method", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("async dispose"));
    });

    it("exports a factory function", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("export default function createSkill"));
    });

    it("includes session source info in comments", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes(workflow.source.sessionId));
    });
  });

  describe("README generation", () => {
    it("includes workflow name", () => {
      const workflow = makeWorkflow({ name: "Search Incidents" });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.files["README.md"].includes("search-incidents"));
    });

    it("includes parameter documentation", () => {
      const variables: WorkflowVariable[] = [
        { name: "ticketId", description: "The ticket ID to search for", defaultValue: "INC123", source: "typed" },
      ];

      const workflow = makeWorkflow({ parameters: variables });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.files["README.md"].includes("ticketId"));
      assert.ok(skill.files["README.md"].includes("INC123"));
    });

    it("includes step listing", () => {
      const workflow = makeWorkflow({
        steps: [
          { name: "Click search", intent: { action: "click", target: "Search" }, isParameterized: false },
          { name: "Type query", intent: { action: "fill", target: "Query field", value: "test" }, isParameterized: false },
        ],
      });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.files["README.md"].includes("Click search"));
      assert.ok(skill.files["README.md"].includes("Type query"));
    });
  });

  describe("naming", () => {
    it("converts spaces to hyphens", () => {
      const workflow = makeWorkflow({ name: "My Great Workflow" });
      const skill = generator.generateSkill(workflow);

      assert.equal(skill.manifest.name, "my-great-workflow");
    });

    it("removes special characters", () => {
      const workflow = makeWorkflow({ name: "Search (v2) - Final!" });
      const skill = generator.generateSkill(workflow);

      assert.ok(!skill.manifest.name.includes("("));
      assert.ok(!skill.manifest.name.includes("!"));
    });

    it("generates PascalCase class name", () => {
      const workflow = makeWorkflow({ name: "search-incidents" });
      const skill = generator.generateSkill(workflow);

      assert.ok(skill.entryPoint.includes("SearchIncidentsSkill"));
    });
  });

  describe("skill.json file", () => {
    it("produces valid JSON", () => {
      const workflow = makeWorkflow();
      const skill = generator.generateSkill(workflow);

      const parsed = JSON.parse(skill.files["skill.json"]);
      assert.equal(parsed.name, skill.manifest.name);
      assert.equal(parsed.version, "1.0.0");
    });
  });
});
