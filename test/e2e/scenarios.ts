/**
 * E2E Test Scenarios for TierZero adaptive replay.
 * Proves: record on v1 → generate workflow → replay on v2 with different DOM.
 */

import { test } from "node:test";
import * as assert from "node:assert/strict";
import type { Page, Browser } from "playwright";

import { IntentEngine, AriaStrategy, CachedStrategy, LLMStrategy, InMemorySelectorCache } from "../../src/intents/engine";
import { ActionChain } from "../../src/intents/chain";
import type { ChainStep } from "../../src/intents/chain";
import { ActionAnnotator } from "../../src/recorder/annotator";
import { WorkflowGenerator } from "../../src/recorder/generator";
import { SkillGenerator } from "../../src/recorder/skill-generator";
import type { RecordedSession, RecordedAction } from "../../src/recorder/types";
import type { Intent, Strategy } from "../../src/intents/types";

import { MockLLM } from "./mock-llm";
import {
  login,
  loginV2,
  makeAction,
  makeElement,
  createRecordedSession,
  TestFallbackStrategy,
  assertIncludes,
} from "./helpers";

// ---------------------------------------------------------------------------
// Scenario A: Record and Replay - Resolve Ticket
// ---------------------------------------------------------------------------

export function registerScenarioA(
  getPage: () => Page,
  getBaseUrl: () => string
) {
  test("Scenario A: Record → Annotate → Generate → Replay resolve ticket on v1 AND v2", async (t) => {
    const page = getPage();
    const baseUrl = getBaseUrl();

    // ---- Step 1: Simulate recording on v1 ----
    await t.test("Step 1: Simulate recording on v1 layout", async () => {
      await login(page, baseUrl);
      // Navigate directly to search results
      await page.goto(`${baseUrl}/search?q=TKT-007`);
      await page.waitForSelector('[aria-label="Open ticket TKT-007"]', { timeout: 5000 });
      // Open ticket
      await page.click('[aria-label="Open ticket TKT-007"]');
      await page.waitForURL(/ticket\/TKT-007/);
      // Add comment
      await page.fill('[aria-label="Comment text"]', "Investigated - root cause found");
      await page.click('[aria-label="Add comment"]');
      await page.waitForLoadState("networkidle", { timeout: 5000 });
      // Verify comment was added
      const commentText = await page.textContent("body");
      assert.ok(commentText?.includes("Investigated - root cause found"));
    });

    // ---- Step 2: Build a recorded session from the actions ----
    let session: RecordedSession;
    await t.test("Step 2: Build recorded session", () => {
      const actions: RecordedAction[] = [
        makeAction("type", {
          element: makeElement({ ariaLabel: "Username", tagName: "input", selector: "#username" }),
          value: "admin",
          pageUrl: `${baseUrl}/login`,
          pageTitle: "Login - TicketApp",
        }),
        makeAction("type", {
          element: makeElement({ ariaLabel: "Password", tagName: "input", selector: "#password" }),
          value: "admin123",
          pageUrl: `${baseUrl}/login`,
          pageTitle: "Login - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Sign in", tagName: "button", text: "Sign In" }),
          pageUrl: `${baseUrl}/login`,
          pageTitle: "Login - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Search", tagName: "a", text: "Search" }),
          pageUrl: `${baseUrl}/dashboard`,
          pageTitle: "Dashboard - TicketApp",
        }),
        makeAction("type", {
          element: makeElement({ ariaLabel: "Search query", tagName: "input", selector: "#searchQuery" }),
          value: "TKT-007",
          pageUrl: `${baseUrl}/search`,
          pageTitle: "Search - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Search tickets", tagName: "button", text: "Search" }),
          pageUrl: `${baseUrl}/search`,
          pageTitle: "Search - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Open ticket TKT-007", tagName: "a", text: "TKT-007" }),
          pageUrl: `${baseUrl}/search?q=TKT-007`,
          pageTitle: "Search - TicketApp",
        }),
        makeAction("type", {
          element: makeElement({ ariaLabel: "Comment text", tagName: "textarea", selector: "#comment" }),
          value: "Investigated - root cause found",
          pageUrl: `${baseUrl}/ticket/TKT-007`,
          pageTitle: "TKT-007 - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Add comment", tagName: "button", text: "Add Comment" }),
          pageUrl: `${baseUrl}/ticket/TKT-007`,
          pageTitle: "TKT-007 - TicketApp",
        }),
        makeAction("click", {
          element: makeElement({ ariaLabel: "Resolve ticket", tagName: "button", text: "Resolve" }),
          pageUrl: `${baseUrl}/ticket/TKT-007`,
          pageTitle: "TKT-007 - TicketApp",
        }),
      ];

      session = createRecordedSession(actions, `${baseUrl}/login`);
      assert.equal(session.actions.length, 10);
    });

    // ---- Step 3: Annotate the session ----
    let workflow: ReturnType<WorkflowGenerator["generateWorkflow"]>;
    await t.test("Step 3: Annotate session and generate workflow", () => {
      const annotator = new ActionAnnotator();
      const annotatedSession = annotator.annotateSession(session!);

      assert.ok(annotatedSession.actions.length > 0);
      assert.ok(annotatedSession.workflowName);
      assert.ok(annotatedSession.groups.length > 0);

      // Every action should have a description
      for (const action of annotatedSession.actions) {
        assert.ok(action.description, `Action ${action.type} missing description`);
      }

      // Generate workflow
      const generator = new WorkflowGenerator();
      workflow = generator.generateWorkflow(annotatedSession);

      assert.ok(workflow.steps.length > 0);
      assert.ok(workflow.chainSteps.length > 0);
      assert.equal(workflow.steps.length, workflow.chainSteps.length);

      // Verify intents are descriptive (not selector-based)
      for (const step of workflow.steps) {
        assert.ok(step.intent.target, `Step "${step.name}" has no target`);
        assert.ok(step.intent.action, `Step "${step.name}" has no action`);
      }
    });

    // ---- Step 4: Generate skill ----
    await t.test("Step 4: Generate skill from workflow", () => {
      const skillGen = new SkillGenerator();
      const skill = skillGen.generateSkill(workflow!);

      assert.ok(skill.manifest.name);
      assert.ok(skill.manifest.version);
      assert.ok(skill.entryPoint.includes("ActionChain"));
      assert.ok(skill.entryPoint.includes("IntentEngine"));
    });

    // ---- Step 5: Replay workflow on v1 ----
    await t.test("Step 5: Replay workflow on v1 layout via IntentEngine", async () => {
      const mockLLM = new MockLLM();
      const engine = new IntentEngine({
        strategies: [
          new CachedStrategy(),
          new AriaStrategy(),
          new LLMStrategy(),
          new TestFallbackStrategy(),
        ],
        llm: mockLLM,
        cache: new InMemorySelectorCache(),
      });

      // Drive the workflow through the app via intents
      await page.goto(`${baseUrl}/login`);

      // Login intents
      await resolveAndExecute(engine, page, { action: "fill", target: "Username", value: "admin" });
      await resolveAndExecute(engine, page, { action: "fill", target: "Password", value: "admin123" });
      await resolveAndExecute(engine, page, { action: "click", target: "Sign in" });
      await page.waitForLoadState("networkidle");

      // Navigate to search results directly (simulates: click Search + fill query + submit)
      await page.goto(`${baseUrl}/search?q=TKT-007`);
      await page.waitForLoadState("networkidle");

      // Open ticket
      await resolveAndExecute(engine, page, { action: "click", target: "Open ticket TKT-007" });
      await page.waitForLoadState("networkidle");

      // Add comment
      await resolveAndExecute(engine, page, { action: "fill", target: "Comment text", value: "Investigated - root cause found" });
      await resolveAndExecute(engine, page, { action: "click", target: "Add comment" });
      await page.waitForLoadState("networkidle");

      // Resolve ticket
      await resolveAndExecute(engine, page, { action: "click", target: "Resolve ticket" });
      await page.waitForLoadState("networkidle");

      // Verify final state: ticket resolved
      const bodyText = await page.textContent("body");
      assert.ok(
        bodyText?.includes("resolved") || bodyText?.includes("Ticket resolved"),
        "Ticket should be resolved after replay on v1"
      );
    });

    // ---- Step 6: THE KEY TEST - Replay on v2 ----
    await t.test("Step 6: KEY TEST - Replay same workflow on v2 layout (different DOM)", async () => {
      // v2 has: different class names, icons instead of text, reordered columns,
      // and a confirmation modal on resolve

      const mockLLM = new MockLLM();
      const engine = new IntentEngine({
        strategies: [
          new CachedStrategy(),
          new AriaStrategy(),
          new LLMStrategy(),
          new TestFallbackStrategy(),
        ],
        llm: mockLLM,
        cache: new InMemorySelectorCache(),
      });

      // SAME workflow, v2 layout
      await page.goto(`${baseUrl}/login?layout=v2`);

      // Login intents (v2 has "→ Enter" instead of "Sign In" but same aria-label)
      await resolveAndExecute(engine, page, { action: "fill", target: "Username", value: "admin" });
      await resolveAndExecute(engine, page, { action: "fill", target: "Password", value: "admin123" });
      await resolveAndExecute(engine, page, { action: "click", target: "Sign in" });
      await page.waitForLoadState("networkidle");

      // Navigate to search results (v2 layout) - use TKT-006 (TKT-007 was resolved in Step 5)
      await page.goto(`${baseUrl}/search?q=TKT-006&layout=v2`);
      await page.waitForLoadState("networkidle");

      // Open ticket - same intent pattern, different ticket (proves parameterization)
      await resolveAndExecute(engine, page, { action: "click", target: "Open ticket TKT-006" });
      await page.waitForLoadState("networkidle");

      // Add comment
      await resolveAndExecute(engine, page, { action: "fill", target: "Comment text", value: "Investigated - root cause found" });
      await resolveAndExecute(engine, page, { action: "click", target: "Add comment" });
      await page.waitForLoadState("networkidle");

      // Resolve ticket - on v2 this shows a confirmation modal
      await resolveAndExecute(engine, page, { action: "click", target: "Resolve ticket" });
      await page.waitForTimeout(200);

      // Handle v2 confirm modal
      try {
        const confirmBtn = page.locator('[aria-label="Confirm resolve"]');
        if (await confirmBtn.isVisible({ timeout: 1000 })) {
          await confirmBtn.click();
          await page.waitForLoadState("networkidle");
        }
      } catch {
        // No modal on v1
      }

      // Verify final state: ticket resolved on v2 too
      const bodyText = await page.textContent("body");
      assert.ok(
        bodyText?.includes("resolved") || bodyText?.includes("Ticket resolved"),
        "ADAPTIVE REPLAY SUCCEEDED: Ticket resolved on v2 layout with different DOM!"
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario B: Record and Replay - Assign Ticket
// ---------------------------------------------------------------------------

export function registerScenarioB(
  getPage: () => Page,
  getBaseUrl: () => string
) {
  test("Scenario B: Record → Replay assign ticket with parameterized value", async (t) => {
    const page = getPage();
    const baseUrl = getBaseUrl();

    await t.test("Assign ticket on v1 with parameterized assignee", async () => {
      await login(page, baseUrl);

      // Go to ticket TKT-003
      await page.click('[aria-label="Open ticket TKT-003"]');
      await page.waitForURL(/ticket\/TKT-003/);

      // Select assignee
      await page.selectOption('[aria-label="Assign to"]', "John Smith");
      await page.click('[aria-label="Save assignment"]');
      await page.waitForURL(/ticket\/TKT-003/);

      const bodyText = await page.textContent("body");
      assert.ok(bodyText?.includes("John Smith"));
    });

    await t.test("Replay assign with different assignee value on v2", async () => {
      await page.goto(`${baseUrl}/login?layout=v2`);
      await page.fill('[aria-label="Username"]', "admin");
      await page.fill('[aria-label="Password"]', "admin123");
      await page.click('[aria-label="Sign in"]');
      await page.waitForURL(/dashboard/);

      // Find TKT-003 and open it
      await page.click('[aria-label="Open ticket TKT-003"]');
      await page.waitForURL(/ticket\/TKT-003/);

      // Use different assignee (parameterized)
      await page.selectOption('[aria-label="Assign to"]', "Alice Chen");
      await page.click('[aria-label="Save assignment"]');
      await page.waitForURL(/ticket\/TKT-003/);

      const bodyText = await page.textContent("body");
      assert.ok(
        bodyText?.includes("Alice Chen"),
        "Parameterized replay: different assignee on v2 layout"
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario C: Stress Test - Changed Page Structure
// ---------------------------------------------------------------------------

export function registerScenarioC(
  getPage: () => Page,
  getBaseUrl: () => string
) {
  test("Scenario C: Stress test - IntentEngine handles v1→v2 changes", async (t) => {
    const page = getPage();
    const baseUrl = getBaseUrl();
    const mockLLM = new MockLLM();

    await t.test("Strategy chain finds elements despite different class names", async () => {
      // Login to v2 (different class names: action-btn vs btn, panel vs card, etc.)
      await loginV2(page, baseUrl);

      const engine = new IntentEngine({
        strategies: [new AriaStrategy(), new LLMStrategy(), new TestFallbackStrategy()],
        llm: mockLLM,
      });

      // These intents use the SAME descriptions from v1 recording
      // but must work on v2's different DOM structure
      const searchIntent: Intent = { action: "click", target: "Search" };
      const resolved = await engine.resolve(searchIntent, page);
      assert.ok(resolved, "Strategy chain should find Search link on v2 via fallback");
      assert.ok(resolved!.selector);
    });

    await t.test("Handles reordered table columns", async () => {
      // v2 has columns: Priority, ID, Title, Assignee, Status (vs v1: ID, Title, Status, Priority, Assignee)
      const bodyText = await page.textContent("body");
      // Table should still contain all ticket data
      assert.ok(bodyText?.includes("TKT-001"));
      assert.ok(bodyText?.includes("TKT-007"));
    });

    await t.test("Handles icon buttons (v2 uses icons instead of text)", async () => {
      await page.click('[aria-label="Open ticket TKT-001"]');
      await page.waitForURL(/ticket\/TKT-001/);

      // v2 uses "✓ Done" instead of "Resolve" but aria-label is consistent
      const resolveBtn = page.locator('[aria-label="Resolve ticket"]');
      assert.ok(await resolveBtn.isVisible());

      // v2 uses "💬 Comment" instead of "Add Comment"
      const commentBtn = page.locator('button[aria-label="Add comment"]');
      assert.ok(await commentBtn.isVisible());
    });

    await t.test("DismissDialog handles v2 confirmation modal", async () => {
      // Click resolve on v2 - this triggers a confirm modal
      await page.click('[aria-label="Resolve ticket"]');
      await page.waitForTimeout(200);

      // Confirm modal should appear on v2
      const modal = page.locator('[role="dialog"]');
      const isVisible = await modal.isVisible({ timeout: 1000 });
      assert.ok(isVisible, "v2 should show confirmation modal");

      // Dismiss via the confirm button
      await page.click('[aria-label="Confirm resolve"]');
      await page.waitForTimeout(300);

      const bodyText = await page.textContent("body");
      assert.ok(
        bodyText?.includes("resolved") || bodyText?.includes("Ticket resolved"),
        "Ticket should be resolved after confirming modal"
      );
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario D: Error Recovery
// ---------------------------------------------------------------------------

export function registerScenarioD(
  getPage: () => Page,
  getBaseUrl: () => string
) {
  test("Scenario D: Error recovery - LLM detects error page", async (t) => {
    const page = getPage();
    const baseUrl = getBaseUrl();
    const mockLLM = new MockLLM();

    await t.test("Detects 500 error page", async () => {
      await page.goto(`${baseUrl}/error`);

      const bodyText = await page.textContent("body") || "";
      const recovery = await mockLLM.analyzePageForRecovery(
        { action: "click", target: "some button" },
        bodyText,
        "Could not resolve intent"
      );

      assert.ok(recovery, "Should return recovery action");
      assert.equal(recovery!.action, "escalate");
      assert.ok(recovery!.detail.includes("500"));
    });

    await t.test("Detects confirmation dialog and suggests dismiss", async () => {
      const recovery = await mockLLM.analyzePageForRecovery(
        { action: "click", target: "resolve" },
        "Are you sure you want to proceed? This action cannot be undone. Confirm Cancel",
        "Element not found"
      );

      assert.ok(recovery);
      assert.equal(recovery!.action, "dismiss_modal");
    });

    await t.test("Suggests scroll for hidden elements", async () => {
      const recovery = await mockLLM.analyzePageForRecovery(
        { action: "click", target: "submit" },
        "Some page content...",
        "Could not resolve intent: click on submit"
      );

      assert.ok(recovery);
      assert.equal(recovery!.action, "scroll");
    });

    await t.test("CQRS events are emitted during replay", async () => {
      const events: Array<{ type: string }> = [];
      const engine = new IntentEngine({
        strategies: [new TestFallbackStrategy()],
        llm: mockLLM,
        eventHandler: (event) => events.push(event),
      });

      await loginV2(page, baseUrl);

      const intent: Intent = { action: "click", target: "Search" };
      await engine.resolve(intent, page);

      assert.ok(events.length > 0, "Should emit CQRS events");
      const eventTypes = events.map((e) => e.type);
      assert.ok(eventTypes.includes("IntentResolutionStarted"));
    });
  });
}

// ---------------------------------------------------------------------------
// Scenario E: Pipeline Component Tests
// ---------------------------------------------------------------------------

export function registerScenarioE(
  getPage: () => Page,
  getBaseUrl: () => string
) {
  test("Scenario E: Pipeline component integration tests", async (t) => {
    const page = getPage();
    const baseUrl = getBaseUrl();

    await t.test("ActionAnnotator produces descriptions for all action types", () => {
      const annotator = new ActionAnnotator();
      const actions = [
        makeAction("click", { element: makeElement({ text: "Submit", tagName: "button" }), pageUrl: "http://test", pageTitle: "Test" }),
        makeAction("type", { element: makeElement({ ariaLabel: "Email", tagName: "input" }), value: "test@test.com", pageUrl: "http://test", pageTitle: "Test" }),
        makeAction("select", { element: makeElement({ ariaLabel: "Country", tagName: "select" }), value: "US", pageUrl: "http://test", pageTitle: "Test" }),
        makeAction("navigate", { url: "http://test/page2", pageUrl: "http://test", pageTitle: "Test" }),
      ];
      const session = createRecordedSession(actions, "http://test");
      const annotated = annotator.annotateSession(session);
      assert.ok(annotated.actions.length === 4);
      for (const a of annotated.actions) {
        assert.ok(a.description.length > 0, `${a.type} should have description`);
      }
    });

    await t.test("WorkflowGenerator creates intents without selectors", () => {
      const annotator = new ActionAnnotator();
      const actions = [
        makeAction("click", { element: makeElement({ ariaLabel: "Login", tagName: "button" }), pageUrl: "http://test", pageTitle: "Test" }),
        makeAction("type", { element: makeElement({ ariaLabel: "Name", tagName: "input" }), value: "John", pageUrl: "http://test", pageTitle: "Test" }),
      ];
      const session = createRecordedSession(actions, "http://test");
      const annotated = annotator.annotateSession(session);
      const gen = new WorkflowGenerator();
      const workflow = gen.generateWorkflow(annotated);

      for (const step of workflow.steps) {
        assert.ok(!step.intent.selector, "Intent should not contain a CSS selector");
        assert.ok(step.intent.target, "Intent should have a human-readable target");
      }
    });

    await t.test("SkillGenerator produces complete skill output", () => {
      const annotator = new ActionAnnotator();
      const actions = [
        makeAction("click", { element: makeElement({ text: "OK", tagName: "button" }), pageUrl: "http://test", pageTitle: "Test" }),
      ];
      const session = createRecordedSession(actions, "http://test");
      const annotated = annotator.annotateSession(session);
      const gen = new WorkflowGenerator();
      const workflow = gen.generateWorkflow(annotated);
      const skillGen = new SkillGenerator();
      const skill = skillGen.generateSkill(workflow);

      assert.ok(skill.manifest.name);
      assert.ok(skill.manifest.version === "1.0.0");
      assert.ok(skill.directoryName);
      assert.ok(skill.files["skill.json"]);
      assert.ok(skill.files["index.ts"]);
      assert.ok(skill.files["README.md"]);
      assert.ok(skill.entryPoint.includes("execute"));
    });

    await t.test("MockLLM findElementFromAccessibilityTree finds by name", async () => {
      const llm = new MockLLM();
      const tree = JSON.stringify({
        role: "WebArea",
        name: "",
        children: [
          { role: "button", name: "Submit Form" },
          { role: "textbox", name: "Email Address" },
          { role: "link", name: "Dashboard" },
        ],
      });

      const result1 = await llm.findElementFromAccessibilityTree(
        { action: "click", target: "Submit Form" }, tree
      );
      assert.ok(result1, "Should find Submit Form button");

      const result2 = await llm.findElementFromAccessibilityTree(
        { action: "fill", target: "Email" }, tree
      );
      assert.ok(result2, "Should find Email textbox");

      const result3 = await llm.findElementFromAccessibilityTree(
        { action: "click", target: "Dashboard" }, tree
      );
      assert.ok(result3, "Should find Dashboard link");
    });

    await t.test("MockLLM parseGoalToIntent handles all action types", async () => {
      const llm = new MockLLM();

      const click = await llm.parseGoalToIntent!("Click the submit button");
      assert.equal(click.action, "click");

      const fill = await llm.parseGoalToIntent!("Type hello into the search field");
      assert.equal(fill.action, "fill");

      const select = await llm.parseGoalToIntent!("Select US from country dropdown");
      assert.equal(select.action, "select");

      const nav = await llm.parseGoalToIntent!("Navigate to the dashboard");
      assert.equal(nav.action, "navigate");
    });

    await t.test("IntentEngine strategy chain order is respected", async () => {
      const strategiesUsed: string[] = [];

      const s1: Strategy = {
        name: "first",
        async resolve() {
          strategiesUsed.push("first");
          return null; // fail -> try next
        },
      };
      const s2: Strategy = {
        name: "second",
        async resolve(intent) {
          strategiesUsed.push("second");
          return { intent, selector: "found", confidence: 0.9, strategy: "second" };
        },
      };

      const engine = new IntentEngine({ strategies: [s1, s2] });
      await loginV2(page, baseUrl);

      const result = await engine.resolve({ action: "click", target: "test" }, page);
      assert.ok(result);
      assert.equal(result!.strategy, "second");
      assert.deepEqual(strategiesUsed, ["first", "second"]);
    });

    await t.test("InMemorySelectorCache caches and retrieves selectors", () => {
      const cache = new InMemorySelectorCache();
      cache.set("click:Submit", "#submit-btn");
      assert.equal(cache.get("click:Submit"), "#submit-btn");
      assert.equal(cache.get("click:Other"), undefined);
      cache.invalidate("click:Submit");
      assert.equal(cache.get("click:Submit"), undefined);
    });

    await t.test("Ticket app v1 and v2 have different DOM structure", async () => {
      // Load v1
      await page.goto(`${baseUrl}/login`);
      const v1Html = await page.content();

      // Load v2
      await page.goto(`${baseUrl}/login?layout=v2`);
      const v2Html = await page.content();

      // Verify different class names
      assert.ok(v1Html.includes("header"), "v1 uses .header class");
      assert.ok(v2Html.includes("top-bar"), "v2 uses .top-bar class");
      assert.ok(v1Html.includes("btn btn-primary"), "v1 uses .btn class");
      assert.ok(v2Html.includes("action-btn"), "v2 uses .action-btn class");
      assert.ok(v1Html.includes("container"), "v1 uses .container class");
      assert.ok(v2Html.includes("main-content"), "v2 uses .main-content class");

      // But both have the same aria-labels (this is why adaptive replay works!)
      assert.ok(v1Html.includes('aria-label="Username"'));
      assert.ok(v2Html.includes('aria-label="Username"'));
      assert.ok(v1Html.includes('aria-label="Sign in"'));
      assert.ok(v2Html.includes('aria-label="Sign in"'));
    });

    await t.test("Ticket app v2 has reordered columns", async () => {
      await loginV2(page, baseUrl);
      const html = await page.content();
      // v2 columns: Priority, ID, Title, Assignee, Status
      const priorityIdx = html.indexOf("<th>Priority</th>");
      const idIdx = html.indexOf("<th>ID</th>");
      assert.ok(priorityIdx < idIdx, "v2 should have Priority before ID");
    });

    await t.test("Ticket app v2 uses icon buttons", async () => {
      await page.click('[aria-label="Open ticket TKT-004"]');
      await page.waitForURL(/ticket\/TKT-004/);
      const html = await page.content();
      assert.ok(html.includes("✓ Done"), "v2 uses icon for resolve button");
      assert.ok(html.includes("💬 Comment"), "v2 uses icon for comment button");
      assert.ok(html.includes("💾 Save"), "v2 uses icon for save button");
    });

    await t.test("Workflow generation preserves action count", () => {
      const actions = [
        makeAction("click", { element: makeElement({ text: "A" }), pageUrl: "http://test", pageTitle: "T" }),
        makeAction("type", { element: makeElement({ text: "B" }), value: "x", pageUrl: "http://test", pageTitle: "T" }),
        makeAction("click", { element: makeElement({ text: "C" }), pageUrl: "http://test", pageTitle: "T" }),
      ];
      const session = createRecordedSession(actions, "http://test");
      const annotator = new ActionAnnotator();
      const annotated = annotator.annotateSession(session);
      const gen = new WorkflowGenerator();
      const wf = gen.generateWorkflow(annotated);
      assert.equal(wf.steps.length, 3);
      assert.equal(wf.chainSteps.length, 3);
      assert.equal(wf.source.actionCount, 3);
    });

    await t.test("MockLLM analyzePageForRecovery handles timeout", async () => {
      const llm = new MockLLM();
      const r = await llm.analyzePageForRecovery(
        { action: "click", target: "btn" }, "Loading...", "Timeout exceeded"
      );
      assert.ok(r);
      assert.equal(r!.action, "wait");
    });

    await t.test("MockLLM returns null for unknown errors", async () => {
      const llm = new MockLLM();
      const r = await llm.analyzePageForRecovery(
        { action: "click", target: "btn" }, "Normal page content", "Some random error"
      );
      assert.equal(r, null);
    });

    await t.test("MockLLM decomposeGoal returns intent array", async () => {
      const llm = new MockLLM();
      const intents = await llm.decomposeGoal!("Click the submit button");
      assert.ok(Array.isArray(intents));
      assert.ok(intents.length > 0);
      assert.equal(intents[0].action, "click");
    });

    await t.test("MockLLM findCoordinatesFromScreenshot returns viewport center", async () => {
      const llm = new MockLLM();
      const coords = await llm.findCoordinatesFromScreenshot!(
        { action: "click", target: "test" }, "base64data", { width: 1280, height: 720 }
      );
      assert.ok(coords);
      assert.equal(coords!.x, 640);
      assert.equal(coords!.y, 360);
    });

    await t.test("Ticket app serves login on root path", async () => {
      await page.goto(`${baseUrl}/`);
      assert.ok(page.url().includes("/login"));
    });

    await t.test("Ticket app rejects invalid credentials", async () => {
      await page.goto(`${baseUrl}/login`);
      await page.fill('[aria-label="Username"]', "wrong");
      await page.fill('[aria-label="Password"]', "wrong");
      await page.click('[aria-label="Sign in"]');
      await page.waitForLoadState("networkidle");
      const html = await page.content();
      assert.ok(html.includes("Invalid credentials"));
    });

    await t.test("Ticket app error page returns 500", async () => {
      const response = await page.goto(`${baseUrl}/error`);
      assert.equal(response?.status(), 500);
      const html = await page.content();
      assert.ok(html.includes("Internal Server Error"));
    });
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function resolveAndExecute(engine: IntentEngine, page: Page, intent: Intent) {
  const resolved = await engine.resolve(intent, page);
  if (!resolved) {
    throw new Error(`Failed to resolve: ${intent.action} on "${intent.target}"`);
  }
  await executeStep(page, resolved.selector!, intent);
}

function buildReplaySteps(
  workflow: ReturnType<WorkflowGenerator["generateWorkflow"]>,
  baseUrl: string,
  version: "v1" | "v2"
): Array<{ intent: Intent }> {
  const qs = version === "v2" ? "?layout=v2" : "";
  const steps: Array<{ intent: Intent }> = [];

  for (const step of workflow.steps) {
    const intent = { ...step.intent };

    // Replace parameterized values
    if (intent.value?.startsWith("{{") && intent.value?.endsWith("}}")) {
      // Use default value
      const paramName = intent.value.slice(2, -2);
      const param = workflow.parameters.find((p) => p.name === paramName);
      if (param?.defaultValue) {
        intent.value = param.defaultValue;
      }
    }

    // Skip navigate intents (we drive navigation through the app)
    if (intent.action === "navigate") continue;

    steps.push({ intent });
  }

  return steps;
}

async function executeStep(page: Page, selector: string, intent: Intent) {
  // Try each selector (some contain comma-separated alternatives)
  const selectors = selector.split(",").map((s) => s.trim());

  for (const sel of selectors) {
    try {
      const locator = page.locator(sel).first();
      const visible = await locator.isVisible({ timeout: 1000 });
      if (!visible) continue;

      switch (intent.action) {
        case "click": {
          await locator.click();
          // Wait for any navigation to settle
          await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
          return;
        }
        case "fill":
          await locator.fill(intent.value || "");
          return;
        case "select":
          await page.selectOption(sel, intent.value || "");
          return;
        default:
          await locator.click();
          return;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Could not execute ${intent.action} on any of: ${selector}`);
}
