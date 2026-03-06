import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { IntentEngine } from "./engine";
import type { Intent, LLMProvider, SelectorCacheQuery, CachedSelector } from "./types";
import { IntentAttempted, SelectorResolved, IntentSucceeded, IntentEscalated, RecoveryAttempted, RecoverySucceeded } from "../domain/intent-execution/events";
import { AttemptIntent, ResolveSelector, SucceedIntent, EscalateIntent, AttemptRecovery, SucceedRecovery } from "../domain/intent-execution/commands";

// ─── Helpers ───

const HAS_API_KEY = !!process.env.ANTHROPIC_API_KEY;

function skipWithoutApiKey() {
  if (!HAS_API_KEY) {
    console.log("  ⏭ Skipped (no ANTHROPIC_API_KEY)");
  }
  return !HAS_API_KEY;
}

/**
 * Real LLM provider that calls the Anthropic API using fetch().
 */
function createRealLLMProvider(): LLMProvider {
  const apiKey = process.env.ANTHROPIC_API_KEY!;

  async function callAnthropic(messages: Array<{ role: string; content: unknown }>): Promise<string> {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Anthropic API error ${res.status}: ${text}`);
    }
    const data = await res.json();
    const block = (data as { content: Array<{ type: string; text?: string }> }).content.find(
      (b: { type: string }) => b.type === "text"
    );
    return block?.text?.trim() ?? "";
  }

  return {
    async findElementFromAccessibilityTree(intent, accessibilityTree) {
      const text = await callAnthropic([
        {
          role: "user",
          content: `You are helping locate an element on a web page. Given the following accessibility tree and intent, return ONLY a CSS selector (no explanation, no quotes, no markdown) that best matches the target element.

Intent: ${intent.goal}
Intent name: ${intent.name}
${intent.value ? `Value: ${intent.value}` : ""}

Accessibility tree:
${accessibilityTree}

Return ONLY the CSS selector, nothing else.`,
        },
      ]);
      if (!text || text.includes(" ") && !text.includes("[") && !text.includes(">")) return null;
      return text;
    },

    async findElementFromScreenshot(intent, screenshotBase64) {
      const text = await callAnthropic([
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: screenshotBase64 },
            },
            {
              type: "text",
              text: `You are helping locate an element on a web page screenshot. Given this screenshot and the intent below, return ONLY a CSS selector that targets the element.

Intent: ${intent.goal}
Intent name: ${intent.name}

Return ONLY the CSS selector, nothing else.`,
            },
          ],
        },
      ]);
      if (!text) return null;
      return text;
    },

    async analyzePageForRecovery(intent, pageContent, error) {
      const text = await callAnthropic([
        {
          role: "user",
          content: `Analyze this page HTML and determine recovery action.

Intent: ${intent.goal}
Error: ${error}

Page HTML (truncated):
${pageContent.slice(0, 3000)}

Respond with ONLY one of these JSON objects (no markdown, no explanation):
{"action":"dismiss","detail":"..."}
{"action":"navigate","detail":"<url>"}
{"action":"wait","detail":"..."}
{"action":"escalate","detail":"..."}`,
        },
      ]);
      try {
        return JSON.parse(text);
      } catch {
        return null;
      }
    },
  };
}

/**
 * In-memory SelectorCache that implements SelectorCacheQuery.
 */
class InMemorySelectorCache implements SelectorCacheQuery {
  private store = new Map<string, CachedSelector>();

  async get(page: string, intentName: string): Promise<CachedSelector | null> {
    return this.store.get(`${page}::${intentName}`) ?? null;
  }

  set(page: string, intentName: string, entry: CachedSelector): void {
    this.store.set(`${page}::${intentName}`, entry);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Event collector for CQRS tests. Captures all commands emitted by the engine.
 */
function createEventCollector() {
  const events: Array<{ command: unknown; intentId: string; metadata?: unknown }> = [];
  const handler = async (_AggregateClass: unknown, aggregateId: string, command: unknown, metadata?: unknown) => {
    events.push({ command, intentId: aggregateId, metadata });
    return {};
  };
  return { events, handler };
}

// ─── Tests ───

describe("IntentEngine Integration Tests", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    await browser?.close();
  });

  async function freshPage(html: string): Promise<Page> {
    if (page && !page.isClosed()) await page.close();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return page;
  }

  // ─── 1. Cached Strategy Tests ───

  describe("Cached Strategy", () => {
    it("should find element instantly via cached selector", async () => {
      const p = await freshPage(`
        <html><body>
          <button id="submit-btn">Submit</button>
        </body></html>
      `);
      const cache = new InMemorySelectorCache();
      cache.set("/test", "click-submit", {
        selector: "#submit-btn",
        method: "cached",
        successCount: 5,
        lastUsed: new Date().toISOString(),
        avgDurationMs: 10,
      });

      const engine = new IntentEngine({ cache });
      const result = await engine.execute(
        { name: "click-submit", goal: "Click the Submit button", page: "/test" },
        p
      );

      assert.equal(result.success, true);
      assert.equal(result.method, "cached");
      assert.equal(result.selector, "#submit-btn");
    });

    it("should fall through to aria when cached selector no longer matches", async () => {
      const p = await freshPage(`
        <html><body>
          <button id="new-submit-btn">Submit</button>
        </body></html>
      `);
      const cache = new InMemorySelectorCache();
      cache.set("/test", "click-submit", {
        selector: "#old-submit-btn",
        method: "cached",
        successCount: 3,
        lastUsed: new Date().toISOString(),
        avgDurationMs: 10,
      });

      const engine = new IntentEngine({ cache });
      const result = await engine.execute(
        { name: "click-submit", goal: "Click the Submit button", page: "/test" },
        p
      );

      assert.equal(result.success, true);
      assert.equal(result.method, "aria");
    });
  });

  // ─── 2. Aria Strategy Tests ───

  describe("Aria Strategy", () => {
    it("should find a labeled textbox via aria role+label", async () => {
      const p = await freshPage(`
        <html><body>
          <label for="email">Email Address</label>
          <input type="text" id="email" />
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "fill-email", goal: "Fill the Email Address textbox", page: "/form", value: "test@example.com" },
        p
      );

      assert.equal(result.success, true);
      assert.equal(result.method, "aria");
    });

    it("should find a button by text", async () => {
      const p = await freshPage(`
        <html><body>
          <button>Save Changes</button>
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "click-save", goal: "Click the Save Changes button", page: "/settings" },
        p
      );

      assert.equal(result.success, true);
      assert.equal(result.method, "aria");
    });

    it("should fill an input with a value", async () => {
      const p = await freshPage(`
        <html><body>
          <label for="username">Username</label>
          <input type="text" id="username" />
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "fill-username", goal: "Fill the Username textbox", page: "/form", value: "john_doe" },
        p
      );

      assert.equal(result.success, true);
      const value = await p.inputValue("#username");
      assert.equal(value, "john_doe");
    });

    it("should select an option in a dropdown", async () => {
      const p = await freshPage(`
        <html><body>
          <label for="country">Country</label>
          <select id="country">
            <option value="">Choose...</option>
            <option value="us">United States</option>
            <option value="uk">United Kingdom</option>
          </select>
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "select-country", goal: "Select the Country combobox", page: "/form", value: "us" },
        p
      );

      assert.equal(result.success, true);
      const value = await p.inputValue("#country");
      assert.equal(value, "us");
    });
  });

  // ─── 3. LLM Strategy Tests ───

  describe("LLM Strategy", () => {
    it("should find a non-standard element via LLM accessibility tree analysis", async () => {
      if (skipWithoutApiKey()) return;

      const p = await freshPage(`
        <html><body>
          <div id="custom-action" data-action="submit" style="padding:10px; background:#007bff; color:white; cursor:pointer; display:inline-block;">
            Submit Form
          </div>
        </body></html>
      `);

      const llm = createRealLLMProvider();
      const engine = new IntentEngine({ llm });
      const result = await engine.execute(
        { name: "click-custom-submit", goal: "Click the Submit Form element", page: "/custom" },
        p
      );

      // LLM or aria may find it - either is acceptable
      assert.equal(result.success, true);
      assert.ok(result.selector);
    });

    it("should pick the right element among ambiguous options via LLM", async () => {
      if (skipWithoutApiKey()) return;

      const p = await freshPage(`
        <html><body>
          <div id="btn-cancel" class="action-btn" style="padding:8px; cursor:pointer;">Cancel Order</div>
          <div id="btn-submit" class="action-btn" style="padding:8px; cursor:pointer;">Submit Order</div>
          <div id="btn-review" class="action-btn" style="padding:8px; cursor:pointer;">Review Order</div>
        </body></html>
      `);

      const llm = createRealLLMProvider();
      const engine = new IntentEngine({ llm });
      const result = await engine.execute(
        { name: "click-submit-order", goal: "Click the Submit Order element", page: "/orders" },
        p
      );

      assert.equal(result.success, true);
      assert.ok(result.selector);
    });
  });

  // ─── 4. Vision Strategy Tests ───

  describe("Vision Strategy", () => {
    it("should locate an element visually when no accessibility info available", async () => {
      if (skipWithoutApiKey()) return;

      const p = await freshPage(`
        <html><body>
          <div id="visual-btn" style="width:120px;height:40px;background:green;color:white;text-align:center;line-height:40px;border-radius:5px;cursor:pointer;">
            Go Now
          </div>
        </body></html>
      `);

      const llm = createRealLLMProvider();
      const engine = new IntentEngine({ llm });
      const result = await engine.execute(
        { name: "click-go", goal: "Click the Go Now element", page: "/visual" },
        p
      );

      // Vision or another strategy may find it
      assert.equal(result.success, true);
    });
  });

  // ─── 5. Recovery Tests ───

  describe("Recovery", () => {
    it("should dismiss a modal dialog and retry successfully", async () => {
      const p = await freshPage(`
        <html><body>
          <button id="target-btn">Target Action</button>
          <div role="dialog" id="modal" style="position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:1000;display:flex;align-items:center;justify-content:center;">
            <div style="background:white;padding:20px;">
              <p>Cookie consent</p>
              <button aria-label="Close" onclick="document.getElementById('modal').remove()">Close</button>
            </div>
          </div>
        </body></html>
      `);

      const engine = new IntentEngine({ maxRecoveryAttempts: 3 });
      const result = await engine.execute(
        { name: "click-target", goal: "Click the Target Action button", page: "/blocked" },
        p
      );

      // Either aria finds it through the modal (Playwright can click covered elements sometimes)
      // or recovery dismisses the modal and retries
      assert.equal(result.success, true);
    });

    it("should handle LLM recovery for unexpected page state", async () => {
      if (skipWithoutApiKey()) return;

      const p = await freshPage(`
        <html><body>
          <div class="login-form" style="padding:20px;">
            <h2>Please Log In</h2>
            <label for="user">Username</label>
            <input type="text" id="user" />
            <label for="pass">Password</label>
            <input type="password" id="pass" />
            <button type="submit">Log In</button>
          </div>
        </body></html>
      `);

      const llm = createRealLLMProvider();
      const engine = new IntentEngine({ llm, maxRecoveryAttempts: 2 });
      const result = await engine.execute(
        { name: "click-dashboard", goal: "Click the Dashboard link", page: "/home" },
        p
      );

      // LLM recovery should identify the login form and escalate or suggest action
      // We just verify the engine completes without crashing
      assert.equal(typeof result.success, "boolean");
      assert.ok(result.durationMs >= 0);
    });
  });

  // ─── 6. Full Fallback Chain ───

  describe("Full Fallback Chain", () => {
    it("should try cache -> aria -> LLM in order, LLM finds it", async () => {
      if (skipWithoutApiKey()) return;

      const p = await freshPage(`
        <html><body>
          <span id="oddly-named" data-purpose="primary-action" style="cursor:pointer;padding:8px;background:blue;color:white;">
            Proceed
          </span>
        </body></html>
      `);

      const cache = new InMemorySelectorCache();
      cache.set("/chain", "click-proceed", {
        selector: "#nonexistent",
        method: "cached",
        successCount: 1,
        lastUsed: new Date().toISOString(),
        avgDurationMs: 5,
      });

      const collector = createEventCollector();
      const llm = createRealLLMProvider();
      const engine = new IntentEngine({
        cache,
        llm,
        commandHandler: collector.handler,
      });

      const result = await engine.execute(
        { name: "click-proceed", goal: "Click the Proceed element", page: "/chain" },
        p
      );

      // Should succeed via LLM or aria fallback to text matching
      assert.equal(result.success, true);
      // Verify resolution method is not cached (since cached selector was wrong)
      assert.notEqual(result.method, "cached");
    });

    it("should escalate when everything fails with proper events", async () => {
      const p = await freshPage(`
        <html><body>
          <p>Nothing useful here</p>
        </body></html>
      `);

      const collector = createEventCollector();
      const engine = new IntentEngine({
        recoveryStrategies: [],
        commandHandler: collector.handler,
      });

      const result = await engine.execute(
        { name: "click-phantom", goal: "Click the Nonexistent button", page: "/empty" },
        p
      );

      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.ok(result.error!.includes("exhausted"));

      // Verify we got AttemptIntent and EscalateIntent events
      const commandTypes = collector.events.map(e => (e.command as { constructor: { type: string } }).constructor.type);
      assert.ok(commandTypes.includes("AttemptIntent"), "Should have AttemptIntent");
      assert.ok(commandTypes.includes("EscalateIntent"), "Should have EscalateIntent");
    });
  });

  // ─── 7. CQRS Event Emission ───

  describe("CQRS Event Emission", () => {
    it("should emit IntentAttempted -> SelectorResolved -> IntentSucceeded on success", async () => {
      const p = await freshPage(`
        <html><body>
          <button>Login</button>
        </body></html>
      `);

      const collector = createEventCollector();
      const engine = new IntentEngine({
        commandHandler: collector.handler,
      });

      await engine.execute(
        { name: "click-login", goal: "Click the Login button", page: "/auth" },
        p
      );

      const types = collector.events.map(e => (e.command as { constructor: { type: string } }).constructor.type);
      assert.deepEqual(types, ["AttemptIntent", "ResolveSelector", "SucceedIntent"]);

      // Verify AttemptIntent data
      const attempt = collector.events[0].command as InstanceType<typeof AttemptIntent>;
      assert.equal(attempt.intentName, "click-login");
      assert.equal(attempt.goal, "Click the Login button");
      assert.equal(attempt.page, "/auth");

      // Verify ResolveSelector data
      const resolve = collector.events[1].command as InstanceType<typeof ResolveSelector>;
      assert.ok(resolve.selector);
      assert.equal(resolve.method, "aria");
      assert.ok(resolve.durationMs >= 0);

      // Verify SucceedIntent data
      const succeed = collector.events[2].command as InstanceType<typeof SucceedIntent>;
      assert.ok(succeed.selector);
      assert.ok(succeed.durationMs >= 0);
    });

    it("should emit AttemptIntent -> EscalateIntent on total failure", async () => {
      const p = await freshPage(`
        <html><body><p>Empty</p></body></html>
      `);

      const collector = createEventCollector();
      const engine = new IntentEngine({
        recoveryStrategies: [],
        commandHandler: collector.handler,
      });

      await engine.execute(
        { name: "click-nothing", goal: "Click the Nothing button", page: "/void" },
        p
      );

      const types = collector.events.map(e => (e.command as { constructor: { type: string } }).constructor.type);
      assert.equal(types[0], "AttemptIntent");
      assert.equal(types[types.length - 1], "EscalateIntent");
    });

    it("should emit recovery events when recovery occurs", async () => {
      const p = await freshPage(`
        <html><body>
          <button id="hidden-target" style="display:none;">Target</button>
          <div role="dialog">
            <p>Popup</p>
            <button aria-label="Close" onclick="document.querySelector('[role=dialog]').remove(); document.getElementById('hidden-target').style.display='block';">Close</button>
          </div>
        </body></html>
      `);

      const collector = createEventCollector();
      const engine = new IntentEngine({
        maxRecoveryAttempts: 3,
        commandHandler: collector.handler,
      });

      const result = await engine.execute(
        { name: "click-hidden-target", goal: "Click the Target button", page: "/popup" },
        p
      );

      const types = collector.events.map(e => (e.command as { constructor: { type: string } }).constructor.type);
      assert.ok(types.includes("AttemptIntent"), "Should have AttemptIntent");

      // If recovery happened, we should see recovery events
      if (result.recoveryAttempts > 0) {
        assert.ok(types.includes("AttemptRecovery"), "Should have AttemptRecovery");
      }
    });

    it("should include correct metadata in events", async () => {
      const p = await freshPage(`
        <html><body>
          <button>OK</button>
        </body></html>
      `);

      const collector = createEventCollector();
      const engine = new IntentEngine({ commandHandler: collector.handler });

      await engine.execute(
        { name: "click-ok", goal: "Click the OK button", page: "/confirm" },
        p
      );

      // AttemptIntent should have metadata with page and intentName
      const attemptEvent = collector.events[0];
      const meta = attemptEvent.metadata as Record<string, unknown>;
      assert.equal(meta.page, "/confirm");
      assert.equal(meta.intentName, "click-ok");
    });
  });

  // ─── 8. SelectorCache Learning ───

  describe("SelectorCache Learning", () => {
    it("should use cached selector on second run after learning from first", async () => {
      const cache = new InMemorySelectorCache();

      // First run: no cache, resolves via aria
      const p1 = await freshPage(`
        <html><body>
          <button id="action-btn">Do It</button>
        </body></html>
      `);

      const collector1 = createEventCollector();
      const engine1 = new IntentEngine({
        cache,
        commandHandler: collector1.handler,
      });

      const result1 = await engine1.execute(
        { name: "click-doit", goal: "Click the Do It button", page: "/learn" },
        p1
      );

      assert.equal(result1.success, true);
      assert.equal(result1.method, "aria");

      // Simulate projecting IntentSucceeded into the cache (as the read model would)
      if (result1.selector) {
        cache.set("/learn", "click-doit", {
          selector: result1.selector,
          method: result1.method!,
          successCount: 1,
          lastUsed: new Date().toISOString(),
          avgDurationMs: result1.durationMs,
        });
      }

      // Second run: same page, should use cached strategy
      const p2 = await freshPage(`
        <html><body>
          <button id="action-btn">Do It</button>
        </body></html>
      `);

      const collector2 = createEventCollector();
      const engine2 = new IntentEngine({
        cache,
        commandHandler: collector2.handler,
      });

      const result2 = await engine2.execute(
        { name: "click-doit", goal: "Click the Do It button", page: "/learn" },
        p2
      );

      assert.equal(result2.success, true);

      // The selector resolved via aria uses role-based selectors like role=button[name="Do It"]
      // which the cached strategy validates by checking visibility.
      // It should resolve via cache now.
      const resolveCmd = collector2.events.find(
        e => (e.command as { constructor: { type: string } }).constructor.type === "ResolveSelector"
      );
      if (resolveCmd) {
        const cmd = resolveCmd.command as InstanceType<typeof ResolveSelector>;
        assert.equal(cmd.method, "cached");
      }
    });
  });

  // ─── 9. Action Execution ───

  describe("Action Execution", () => {
    it("should fill a textbox with the specified value", async () => {
      const p = await freshPage(`
        <html><body>
          <label for="name">Full Name</label>
          <input type="text" id="name" />
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "fill-name", goal: "Fill the Full Name textbox", page: "/form", value: "Jane Smith" },
        p
      );

      assert.equal(result.success, true);
      const value = await p.inputValue("#name");
      assert.equal(value, "Jane Smith");
    });

    it("should click a button and trigger its handler", async () => {
      const p = await freshPage(`
        <html><body>
          <button id="counter-btn" onclick="window.__clicked = true;">Click Me</button>
          <script>window.__clicked = false;</script>
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "click-counter", goal: "Click the Click Me button", page: "/action" },
        p
      );

      assert.equal(result.success, true);
      const clicked = await p.evaluate(() => (window as unknown as { __clicked: boolean }).__clicked);
      assert.equal(clicked, true);
    });

    it("should select the correct option in a dropdown", async () => {
      const p = await freshPage(`
        <html><body>
          <label for="color">Favorite Color</label>
          <select id="color">
            <option value="">Pick one</option>
            <option value="red">Red</option>
            <option value="blue">Blue</option>
            <option value="green">Green</option>
          </select>
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "select-color", goal: "Select the Favorite Color combobox", page: "/form", value: "blue" },
        p
      );

      assert.equal(result.success, true);
      const value = await p.inputValue("#color");
      assert.equal(value, "blue");
    });

    it("should check a checkbox", async () => {
      const p = await freshPage(`
        <html><body>
          <label>
            <input type="checkbox" id="agree" />
            Agree to Terms
          </label>
        </body></html>
      `);

      const engine = new IntentEngine();
      const result = await engine.execute(
        { name: "check-agree", goal: "Check the Agree to Terms checkbox", page: "/form" },
        p
      );

      assert.equal(result.success, true);
      const checked = await p.isChecked("#agree");
      assert.equal(checked, true);
    });
  });

  // ─── 10. Error Resilience ───

  describe("Error Resilience", () => {
    it("should never throw, even with a completely empty page", async () => {
      const p = await freshPage(`<html><body></body></html>`);
      const engine = new IntentEngine({ recoveryStrategies: [] });

      const result = await engine.execute(
        { name: "click-ghost", goal: "Click the Ghost button", page: "/empty" },
        p
      );

      assert.equal(typeof result.success, "boolean");
      assert.equal(result.success, false);
      assert.ok(result.durationMs >= 0);
    });

    it("should never throw with broken/malformed HTML", async () => {
      const p = await freshPage(`<html><body><div><span><<<>>></span></div></body></html>`);
      const engine = new IntentEngine({ recoveryStrategies: [] });

      const result = await engine.execute(
        { name: "click-broken", goal: "Click the Submit button", page: "/broken" },
        p
      );

      assert.equal(typeof result.success, "boolean");
      assert.equal(result.success, false);
    });

    it("should return IntentResult with success: false when page has no matching elements", async () => {
      const p = await freshPage(`
        <html><body>
          <p>Just some text, no interactive elements matching intent.</p>
        </body></html>
      `);

      const engine = new IntentEngine({ recoveryStrategies: [] });
      const result = await engine.execute(
        { name: "fill-search", goal: "Fill the Search Query textbox", page: "/static", value: "test" },
        p
      );

      assert.equal(result.success, false);
      assert.ok(result.error);
      assert.ok(result.durationMs >= 0);
    });

    it("should handle intent with null/undefined value gracefully", async () => {
      const p = await freshPage(`
        <html><body>
          <button>OK</button>
        </body></html>
      `);

      const engine = new IntentEngine({ recoveryStrategies: [] });
      const result = await engine.execute(
        { name: "click-ok", goal: "Click the OK button", page: "/safe" },
        p
      );

      assert.equal(result.success, true);
    });

    it("should not crash when commandHandler throws", async () => {
      const p = await freshPage(`
        <html><body>
          <button>Test</button>
        </body></html>
      `);

      const engine = new IntentEngine({
        recoveryStrategies: [],
        commandHandler: async () => { throw new Error("handler boom"); },
      });

      const result = await engine.execute(
        { name: "click-test", goal: "Click the Test button", page: "/crash" },
        p
      );

      assert.equal(result.success, true);
    });
  });
});
