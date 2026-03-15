/**
 * Tests for Action Annotator.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ActionAnnotator } from "./annotator";
import type { RecordedAction, RecordedSession, AnnotatedAction } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeAction(overrides: Partial<RecordedAction> = {}): RecordedAction {
  return {
    type: "click",
    timestamp: Date.now(),
    pageUrl: "https://app.example.com/page",
    pageTitle: "Test Page",
    pageStateBefore: "Page state before",
    pageStateAfter: "Page state after",
    stateChanges: [],
    ...overrides,
  };
}

function makeSession(actions: RecordedAction[]): RecordedSession {
  return {
    id: "test-session",
    startTime: new Date().toISOString(),
    actions,
    startUrl: "https://app.example.com",
    metadata: {},
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ActionAnnotator", () => {
  const annotator = new ActionAnnotator();

  describe("annotateAction", () => {
    it("annotates a click action with element text", () => {
      const action = makeAction({
        type: "click",
        element: {
          selector: "#btn",
          tagName: "button",
          attributes: {},
          text: "Search",
          ariaRole: "button",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Click"));
      assert.ok(result.description.includes("Search"));
    });

    it("annotates a click action with aria label", () => {
      const action = makeAction({
        type: "click",
        element: {
          selector: "#btn",
          tagName: "button",
          attributes: {},
          ariaLabel: "Close dialog",
          ariaRole: "button",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Close dialog"));
    });

    it("annotates a type action", () => {
      const action = makeAction({
        type: "type",
        value: "hello world",
        element: {
          selector: "#input",
          tagName: "input",
          attributes: {},
          ariaLabel: "Search query",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Type"));
      assert.ok(result.description.includes("hello world"));
    });

    it("annotates a navigate action", () => {
      const action = makeAction({
        type: "navigate",
        url: "https://app.example.com/search",
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Navigate"));
      assert.ok(result.description.includes("search"));
    });

    it("annotates a select action", () => {
      const action = makeAction({
        type: "select",
        value: "High",
        element: {
          selector: "#priority",
          tagName: "select",
          attributes: {},
          ariaLabel: "Priority",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Select"));
      assert.ok(result.description.includes("High"));
    });

    it("annotates a check action", () => {
      const action = makeAction({
        type: "check",
        value: "true",
        element: {
          selector: "#agree",
          tagName: "input",
          attributes: {},
          ariaLabel: "Agree",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Check"));
    });

    it("annotates a submit action", () => {
      const action = makeAction({
        type: "submit",
        element: {
          selector: "form",
          tagName: "form",
          attributes: {},
          text: "Contact Form",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Submit"));
    });

    it("annotates an upload action", () => {
      const action = makeAction({
        type: "upload",
        value: "report.pdf",
        element: {
          selector: "#file",
          tagName: "input",
          attributes: {},
          ariaLabel: "File upload",
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Upload"));
      assert.ok(result.description.includes("report.pdf"));
    });

    it("annotates a wait action", () => {
      const action = makeAction({
        type: "wait",
        value: "page load",
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("Wait"));
    });

    it("handles element without text or label", () => {
      const action = makeAction({
        type: "click",
        element: {
          selector: "div.widget",
          tagName: "div",
          attributes: {},
        },
      });

      const result = annotator.annotateAction(action);
      assert.ok(result.description.includes("div"));
    });
  });

  describe("variable detection", () => {
    it("detects typed text as variable when it looks like an ID", () => {
      const action = makeAction({
        type: "type",
        value: "INC12345",
        element: {
          selector: "#field",
          tagName: "input",
          attributes: { name: "correlationId" },
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.isVariable, true);
    });

    it("detects long typed text as variable", () => {
      const action = makeAction({
        type: "type",
        value: "some longer text input",
        element: {
          selector: "#field",
          tagName: "input",
          attributes: { name: "description" },
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.isVariable, true);
    });

    it("detects select values as variable", () => {
      const action = makeAction({
        type: "select",
        value: "High",
        element: {
          selector: "#priority",
          tagName: "select",
          attributes: {},
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.isVariable, true);
    });

    it("does not mark clicks as variable", () => {
      const action = makeAction({
        type: "click",
        element: {
          selector: "#btn",
          tagName: "button",
          attributes: {},
          text: "Submit",
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.isVariable, false);
    });

    it("infers variable name from aria label", () => {
      const action = makeAction({
        type: "type",
        value: "INC99999",
        element: {
          selector: "#field",
          tagName: "input",
          attributes: {},
          ariaLabel: "Incident Number",
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.variableName, "incidentNumber");
    });

    it("infers variable name from element name attribute", () => {
      const action = makeAction({
        type: "type",
        value: "INC99999",
        element: {
          selector: "#field",
          tagName: "input",
          attributes: { name: "ticket_id" },
        },
      });

      const result = annotator.annotateAction(action);
      assert.equal(result.variableName, "ticketId");
    });
  });

  describe("groupActions", () => {
    it("groups related actions together", () => {
      const actions: AnnotatedAction[] = [
        { ...annotator.annotateAction(makeAction({ type: "click", timestamp: 1000 })) },
        { ...annotator.annotateAction(makeAction({ type: "type", timestamp: 1500, value: "text" })) },
        { ...annotator.annotateAction(makeAction({ type: "click", timestamp: 2000 })) },
      ];

      const groups = annotator.groupActions(actions);
      assert.ok(groups.length >= 1);
      assert.ok(groups.every((g) => g.id && g.name && g.actions.length > 0));
    });

    it("starts new group on navigation", () => {
      const actions: AnnotatedAction[] = [
        { ...annotator.annotateAction(makeAction({ type: "click", timestamp: 1000 })) },
        {
          ...annotator.annotateAction(
            makeAction({ type: "navigate", timestamp: 2000, url: "https://other.com" })
          ),
        },
        { ...annotator.annotateAction(makeAction({ type: "click", timestamp: 3000 })) },
      ];

      const groups = annotator.groupActions(actions);
      assert.ok(groups.length >= 2);
    });

    it("starts new group on page URL change", () => {
      const actions: AnnotatedAction[] = [
        {
          ...annotator.annotateAction(
            makeAction({ type: "click", timestamp: 1000, pageUrl: "https://a.com" })
          ),
        },
        {
          ...annotator.annotateAction(
            makeAction({ type: "click", timestamp: 2000, pageUrl: "https://b.com" })
          ),
        },
      ];

      const groups = annotator.groupActions(actions);
      assert.ok(groups.length >= 2);
    });

    it("handles empty action list", () => {
      const groups = annotator.groupActions([]);
      assert.equal(groups.length, 0);
    });

    it("assigns group IDs and names to actions", () => {
      const actions: AnnotatedAction[] = [
        { ...annotator.annotateAction(makeAction({ type: "click", timestamp: 1000 })) },
      ];

      const groups = annotator.groupActions(actions);
      assert.ok(groups[0].actions[0].groupId);
      assert.ok(groups[0].actions[0].groupName);
    });
  });

  describe("identifyVariables", () => {
    it("extracts variables from annotated actions", () => {
      const actions: AnnotatedAction[] = [
        {
          ...annotator.annotateAction(
            makeAction({
              type: "type",
              value: "INC12345",
              element: { selector: "#f", tagName: "input", attributes: {}, ariaLabel: "Ticket ID" },
            })
          ),
        },
      ];

      const variables = annotator.identifyVariables(actions);
      assert.ok(variables.length > 0);
      assert.equal(variables[0].source, "typed");
    });

    it("deduplicates variables by name", () => {
      const action = makeAction({
        type: "type",
        value: "INC12345",
        element: { selector: "#f", tagName: "input", attributes: {}, ariaLabel: "Ticket ID" },
      });
      const annotated = annotator.annotateAction(action);
      const actions = [annotated, { ...annotated }];

      const variables = annotator.identifyVariables(actions);
      assert.equal(variables.length, 1);
    });

    it("returns empty for no variables", () => {
      const actions: AnnotatedAction[] = [
        {
          ...annotator.annotateAction(
            makeAction({ type: "click" })
          ),
        },
      ];

      const variables = annotator.identifyVariables(actions);
      assert.equal(variables.length, 0);
    });
  });

  describe("nameWorkflow", () => {
    it("generates a name from actions", () => {
      const actions: AnnotatedAction[] = [
        {
          ...annotator.annotateAction(
            makeAction({ type: "type", value: "query", pageTitle: "ServiceNow Search" })
          ),
        },
        {
          ...annotator.annotateAction(
            makeAction({
              type: "click",
              element: { selector: "#s", tagName: "button", attributes: {}, text: "Search" },
              pageTitle: "ServiceNow Search",
            })
          ),
        },
      ];

      const name = annotator.nameWorkflow(actions);
      assert.ok(name.length > 0);
      assert.ok(typeof name === "string");
    });

    it("returns default name for empty actions", () => {
      const name = annotator.nameWorkflow([]);
      assert.equal(name, "Empty Workflow");
    });
  });

  describe("annotateSession", () => {
    it("annotates an entire session", () => {
      const session = makeSession([
        makeAction({ type: "click", timestamp: 1000 }),
        makeAction({ type: "type", value: "hello", timestamp: 2000 }),
      ]);

      const result = annotator.annotateSession(session);
      assert.equal(result.id, session.id);
      assert.equal(result.actions.length, 2);
      assert.ok(result.groups.length > 0);
      assert.ok(result.workflowName);
      assert.ok(Array.isArray(result.variables));
    });
  });
});
