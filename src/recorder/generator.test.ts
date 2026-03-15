/**
 * Tests for Workflow Generator.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { WorkflowGenerator } from "./generator";
import type { AnnotatedSession, AnnotatedAction, WorkflowVariable } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAnnotatedAction(
  overrides: Partial<AnnotatedAction> = {}
): AnnotatedAction {
  return {
    type: "click",
    timestamp: Date.now(),
    pageUrl: "https://app.example.com/page",
    pageTitle: "Test Page",
    pageStateBefore: "state before",
    pageStateAfter: "state after",
    stateChanges: [],
    description: "Click the button",
    isVariable: false,
    ...overrides,
  };
}

function makeAnnotatedSession(
  actions: AnnotatedAction[],
  variables: WorkflowVariable[] = []
): AnnotatedSession {
  return {
    id: "test-session",
    startTime: new Date().toISOString(),
    actions,
    startUrl: "https://app.example.com",
    metadata: {},
    groups: [{ id: "g1", name: "Test group", actions }],
    workflowName: "Test Workflow",
    variables,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("WorkflowGenerator", () => {
  const generator = new WorkflowGenerator();

  describe("generateWorkflow", () => {
    it("generates a workflow from an annotated session", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({ type: "click", description: "Click Search" }),
      ]);

      const workflow = generator.generateWorkflow(session);

      assert.ok(workflow.id.startsWith("wf-"));
      assert.equal(workflow.name, "Test Workflow");
      assert.equal(workflow.steps.length, 1);
      assert.equal(workflow.chainSteps.length, 1);
      assert.equal(workflow.source.sessionId, "test-session");
    });

    it("converts click actions to click intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "click",
          element: {
            selector: "#btn",
            tagName: "button",
            attributes: {},
            text: "Submit",
            ariaRole: "button",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "click");
      assert.ok(workflow.steps[0].intent.target.includes("Submit"));
    });

    it("converts type actions to fill intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "type",
          value: "hello",
          element: {
            selector: "#input",
            tagName: "input",
            attributes: {},
            ariaLabel: "Search",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "fill");
      assert.equal(workflow.steps[0].intent.value, "hello");
      assert.equal(workflow.steps[0].intent.target, "Search");
    });

    it("converts navigate actions to navigate intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "navigate",
          url: "https://app.example.com/search",
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "navigate");
      assert.equal(workflow.steps[0].intent.value, "https://app.example.com/search");
    });

    it("converts select actions to select intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "select",
          value: "High",
          element: {
            selector: "#priority",
            tagName: "select",
            attributes: {},
            ariaLabel: "Priority",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "select");
      assert.equal(workflow.steps[0].intent.value, "High");
    });

    it("converts submit actions to click intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "submit",
          element: {
            selector: "form",
            tagName: "form",
            attributes: {},
            text: "Submit Form",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "click");
      assert.deepEqual(workflow.steps[0].intent.meta?.submit, true);
    });

    it("converts check actions to click intents with check meta", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "check",
          value: "true",
          element: {
            selector: "#agree",
            tagName: "input",
            attributes: {},
            ariaLabel: "Agree",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "click");
      assert.deepEqual(workflow.steps[0].intent.meta?.check, true);
    });

    it("converts wait actions to wait intents", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({ type: "wait", value: "page load" }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.action, "wait");
    });
  });

  describe("parameterization", () => {
    it("parameterizes variable values with template syntax", () => {
      const variables: WorkflowVariable[] = [
        { name: "ticketId", description: "Ticket ID", defaultValue: "INC123", source: "typed" },
      ];

      const session = makeAnnotatedSession(
        [
          makeAnnotatedAction({
            type: "type",
            value: "INC123",
            isVariable: true,
            variableName: "ticketId",
            element: {
              selector: "#f",
              tagName: "input",
              attributes: {},
              ariaLabel: "Ticket",
            },
          }),
        ],
        variables
      );

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.value, "{{ticketId}}");
      assert.equal(workflow.steps[0].isParameterized, true);
      assert.equal(workflow.steps[0].parameterName, "ticketId");
    });

    it("does not parameterize non-variable actions", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "type",
          value: "fixed text",
          isVariable: false,
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].isParameterized, false);
    });

    it("includes parameters in workflow", () => {
      const variables: WorkflowVariable[] = [
        { name: "query", description: "Search query", source: "typed" },
      ];

      const session = makeAnnotatedSession([], variables);
      const workflow = generator.generateWorkflow(session);

      assert.equal(workflow.parameters.length, 1);
      assert.equal(workflow.parameters[0].name, "query");
    });
  });

  describe("expected state inference", () => {
    it("infers expected state for navigation", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "navigate",
          url: "https://app.example.com/search?q=test",
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.ok(workflow.steps[0].expectedState);
      assert.ok(workflow.steps[0].expectedState?.urlContains);
    });

    it("infers expected state for submit", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({ type: "submit" }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.ok(workflow.steps[0].expectedState);
      assert.equal(workflow.steps[0].expectedState?.noErrors, true);
    });
  });

  describe("chain steps", () => {
    it("generates chain steps with retries and delays", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({ type: "click" }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.chainSteps.length, 1);
      assert.equal(workflow.chainSteps[0].maxRetries, 2);
      assert.equal(workflow.chainSteps[0].delayAfterMs, 500);
    });
  });

  describe("description generation", () => {
    it("generates a description with source info", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction(),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.ok(workflow.description.includes("https://app.example.com"));
      assert.ok(workflow.description.includes("1 steps"));
    });

    it("includes parameter names in description", () => {
      const variables: WorkflowVariable[] = [
        { name: "query", description: "Search query", source: "typed" },
      ];

      const session = makeAnnotatedSession([], variables);
      const workflow = generator.generateWorkflow(session);
      assert.ok(workflow.description.includes("query"));
    });
  });

  describe("intent target description", () => {
    it("uses aria label when available", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "click",
          element: {
            selector: "#btn",
            tagName: "button",
            attributes: {},
            ariaLabel: "Close dialog",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.target, "Close dialog");
    });

    it("uses element text when no aria label", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "click",
          element: {
            selector: "#btn",
            tagName: "button",
            attributes: {},
            text: "Save Changes",
          },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.equal(workflow.steps[0].intent.target, "Save Changes");
    });

    it("falls back to generic target when no text", () => {
      const session = makeAnnotatedSession([
        makeAnnotatedAction({
          type: "click",
          element: { selector: "div", tagName: "div", attributes: {} },
        }),
      ]);

      const workflow = generator.generateWorkflow(session);
      assert.ok(workflow.steps[0].intent.target);
    });
  });
});
