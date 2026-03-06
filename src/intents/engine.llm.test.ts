import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { IntentEngine } from "./engine";
import type { Intent, LLMProvider } from "./types";

// ─── Configuration ───

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const HAS_KEY = !!OPENROUTER_API_KEY;
const BASE_URL = "https://openrouter.ai/api/v1/chat/completions";

const MODELS = [
  "anthropic/claude-haiku-4-5",
  "google/gemini-2.0-flash-001",
  "openai/gpt-4o-mini",
] as const;

type ModelId = (typeof MODELS)[number];

// ─── Structured Logger ───

interface TestLog {
  model: string;
  test: string;
  intent?: string;
  accessibilityTreeChars?: number;
  screenshotDimensions?: string;
  llmResponse?: string;
  selector?: string;
  method?: string;
  resolvedTo?: string;
  correct?: boolean;
  suggestedAction?: string;
  actionDetail?: string;
  success: boolean;
  responseTimeMs: number;
  error?: string;
  firstAttempt?: { method: string; timeMs: number };
  secondAttempt?: { method: string; timeMs: number };
}

const allLogs: TestLog[] = [];

function logResult(log: TestLog) {
  allLogs.push(log);
  const lines = [
    `\n[LLM TEST] Model: ${log.model} | Test: ${log.test}`,
  ];
  if (log.intent) lines.push(`  Intent: ${log.intent}`);
  if (log.accessibilityTreeChars != null) lines.push(`  Accessibility tree sent: ${log.accessibilityTreeChars} chars`);
  if (log.screenshotDimensions) lines.push(`  Screenshot sent: ${log.screenshotDimensions}`);
  if (log.llmResponse) lines.push(`  LLM response: ${log.llmResponse}`);
  if (log.selector) lines.push(`  Selector: ${log.selector}`);
  if (log.method) lines.push(`  Method: ${log.method}`);
  if (log.resolvedTo) lines.push(`  Resolved to: ${log.resolvedTo}`);
  if (log.correct != null) lines.push(`  Correct: ${log.correct}`);
  if (log.suggestedAction) lines.push(`  Suggested action: ${log.suggestedAction}`);
  if (log.actionDetail) lines.push(`  Action detail: ${log.actionDetail}`);
  if (log.firstAttempt) lines.push(`  First attempt: method=${log.firstAttempt.method}, time=${log.firstAttempt.timeMs}ms`);
  if (log.secondAttempt) lines.push(`  Second attempt: method=${log.secondAttempt.method}, time=${log.secondAttempt.timeMs}ms`);
  lines.push(`  Success: ${log.success}`);
  lines.push(`  Response time: ${log.responseTimeMs}ms`);
  if (log.error) lines.push(`  Error: ${log.error}`);
  console.log(lines.join("\n"));
}

// ─── OpenRouter LLM Provider ───

function createOpenRouterProvider(model: ModelId): LLMProvider {
  const apiKey = OPENROUTER_API_KEY!;

  async function callOpenRouter(messages: Array<{ role: string; content: unknown }>): Promise<string> {
    const res = await fetch(BASE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "HTTP-Referer": "https://tierzero.dev",
        "X-Title": "TierZero LLM Tests",
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        messages,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter API error ${res.status} (${model}): ${text}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? "";
  }

  return {
    async findElementFromAccessibilityTree(intent, accessibilityTree) {
      const text = await callOpenRouter([
        {
          role: "user",
          content: `You are helping locate an element on a web page. Given the following accessibility tree and intent, return ONLY a CSS selector (no explanation, no quotes, no markdown, no backticks) that best matches the target element.

Intent: ${intent.goal}
Intent name: ${intent.name}
${intent.value ? `Value: ${intent.value}` : ""}

Accessibility tree:
${accessibilityTree}

Return ONLY the CSS selector, nothing else.`,
        },
      ]);
      // Strip markdown backticks if the model wraps them
      const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      if (!cleaned || (cleaned.includes(" ") && !cleaned.includes("[") && !cleaned.includes(">") && !cleaned.includes("."))) return null;
      return cleaned;
    },

    async findElementFromScreenshot(intent, screenshotBase64) {
      const text = await callOpenRouter([
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: `data:image/png;base64,${screenshotBase64}` },
            },
            {
              type: "text",
              text: `You are helping locate an element on a web page screenshot. Given this screenshot and the intent below, return ONLY a CSS selector that targets the element. No explanation, no quotes, no markdown, no backticks.

Intent: ${intent.goal}
Intent name: ${intent.name}

Return ONLY the CSS selector, nothing else.`,
            },
          ],
        },
      ]);
      const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
      if (!cleaned) return null;
      return cleaned;
    },

    async analyzePageForRecovery(intent, pageContent, error) {
      const text = await callOpenRouter([
        {
          role: "user",
          content: `Analyze this page HTML and determine recovery action.

Intent: ${intent.goal}
Error: ${error}

Page HTML (truncated):
${pageContent.slice(0, 3000)}

Respond with ONLY one of these JSON objects (no markdown, no explanation, no backticks):
{"action":"dismiss","detail":"..."}
{"action":"navigate","detail":"<url>"}
{"action":"wait","detail":"..."}
{"action":"escalate","detail":"..."}`,
        },
      ]);
      try {
        // Strip markdown wrapping if present
        const cleaned = text.replace(/^```[a-z]*\n?/i, "").replace(/\n?```$/i, "").trim();
        return JSON.parse(cleaned);
      } catch {
        // Try to extract JSON from the response
        const match = text.match(/\{[^}]+\}/);
        if (match) {
          try { return JSON.parse(match[0]); } catch { /* fall through */ }
        }
        return null;
      }
    },
  };
}

// ─── Test HTML Pages ───

const FORM_HTML = `<html><body>
  <h2>Registration Form</h2>
  <form>
    <label for="fullName">Full Name</label>
    <input type="text" id="fullName" name="fullName" />
    <label for="email">Email Address</label>
    <input type="email" id="email" name="email" />
    <label for="country">Country</label>
    <select id="country" name="country">
      <option value="">Select...</option>
      <option value="us">United States</option>
      <option value="uk">United Kingdom</option>
      <option value="ca">Canada</option>
    </select>
    <button type="submit">Submit</button>
  </form>
</body></html>`;

const AMBIGUOUS_BUTTONS_HTML = `<html><body>
  <div style="display:flex; gap:10px; padding:20px;">
    <button id="btn-order" class="submit-btn" data-action="order">Submit Order</button>
    <button id="btn-review" class="submit-btn" data-action="review">Submit Review</button>
    <button id="btn-form" class="submit-btn" data-action="form">Submit Form</button>
  </div>
</body></html>`;

const CUSTOM_ELEMENTS_HTML = `<html><body>
  <div style="padding:20px;">
    <div id="save-action" class="action-item" onclick="window.__saved=true" style="padding:12px 24px; background:#28a745; color:white; cursor:pointer; display:inline-block; border-radius:4px; font-weight:bold;">
      Save Changes
    </div>
    <span id="delete-action" class="action-item" onclick="window.__deleted=true" style="padding:12px 24px; background:#dc3545; color:white; cursor:pointer; display:inline-block; border-radius:4px; margin-left:10px;">
      Delete Item
    </span>
    <custom-button id="custom-btn" style="padding:12px 24px; background:#007bff; color:white; cursor:pointer; display:inline-block; border-radius:4px; margin-left:10px;">
      Refresh Data
    </custom-button>
  </div>
</body></html>`;

const SEARCH_BAR_HTML = `<html><body>
  <div style="padding:20px;">
    <div style="display:flex; align-items:center; border:1px solid #ccc; border-radius:25px; padding:8px 16px; max-width:500px;">
      <span style="font-size:18px; margin-right:8px;">&#128269;</span>
      <input type="search" id="search-input" name="search" placeholder="Search for anything..." style="border:none; outline:none; flex:1; font-size:16px;" />
    </div>
  </div>
</body></html>`;

const LOGIN_REDIRECT_HTML = `<html><body>
  <div class="sso-container" style="text-align:center; padding:60px;">
    <h1>Single Sign-On</h1>
    <p>You have been redirected to the login page. Please authenticate to continue.</p>
    <form action="/auth/login" method="POST">
      <label for="sso-user">Username or Email</label>
      <input type="text" id="sso-user" name="username" />
      <label for="sso-pass">Password</label>
      <input type="password" id="sso-pass" name="password" />
      <button type="submit">Sign In</button>
    </form>
    <p><a href="/auth/forgot">Forgot password?</a></p>
    <p class="redirect-info">After authentication, you will be redirected to: <code>/dashboard</code></p>
  </div>
</body></html>`;

const LABELED_FORM_HTML = `<html><body>
  <h2>Contact Form</h2>
  <form>
    <label for="firstName">First Name</label>
    <input type="text" id="firstName" name="firstName" />
    <label for="lastName">Last Name</label>
    <input type="text" id="lastName" name="lastName" />
    <button type="submit">Send</button>
  </form>
</body></html>`;

const UNLABELED_FORM_HTML = `<html><body>
  <h2>Contact Form</h2>
  <form>
    <div class="field-group">
      <div class="field-hint">Enter your first name</div>
      <input type="text" id="firstName" name="firstName" data-field="first-name" />
    </div>
    <div class="field-group">
      <div class="field-hint">Enter your last name</div>
      <input type="text" id="lastName" name="lastName" data-field="last-name" />
    </div>
    <div class="action" onclick="document.querySelector('form').submit()" style="padding:10px 20px; background:#333; color:#fff; cursor:pointer; display:inline-block;">Send</div>
  </form>
</body></html>`;

// ─── Tests ───

function skipWithoutKey(): boolean {
  if (!HAS_KEY) {
    console.log("  ⏭ Skipped (no OPENROUTER_API_KEY)");
  }
  return !HAS_KEY;
}

describe("IntentEngine LLM Integration Tests (OpenRouter)", () => {
  let browser: Browser;
  let page: Page;

  before(async () => {
    if (!HAS_KEY) return;
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();

    // Print summary
    if (allLogs.length > 0) {
      console.log("\n" + "=".repeat(80));
      console.log("[LLM TEST SUMMARY]");
      console.log("=".repeat(80));
      const grouped: Record<string, TestLog[]> = {};
      for (const log of allLogs) {
        if (!grouped[log.model]) grouped[log.model] = [];
        grouped[log.model].push(log);
      }
      for (const model of Object.keys(grouped)) {
        const logs = grouped[model];
        const passed = logs.filter((l) => l.success).length;
        const total = logs.length;
        const avgTime = Math.round(logs.reduce((s, l) => s + l.responseTimeMs, 0) / total);
        console.log(`  ${model}: ${passed}/${total} passed, avg ${avgTime}ms`);
        for (const l of logs) {
          console.log(`    ${l.success ? "PASS" : "FAIL"} ${l.test} (${l.responseTimeMs}ms)`);
        }
      }
      console.log("=".repeat(80));
    }
  });

  /**
   * Build an accessibility-tree-like representation from the DOM.
   * Playwright 1.58+ removed page.accessibility.snapshot(), so we extract
   * roles, labels, names, and structure directly via page.evaluate().
   */
  /**
   * Build an accessibility-tree-like representation from the DOM.
   * Uses a string expression to avoid tsx __name transform leaking into evaluate.
   */
  async function getAccessibilityTree(p: Page): Promise<string> {
    return p.evaluate(`(function() {
      function walk(el, depth) {
        var tag = el.tagName.toLowerCase();
        var role = el.getAttribute("role") || "";
        var id = el.id ? 'id="' + el.id + '"' : "";
        var name = el.getAttribute("name") ? 'name="' + el.getAttribute("name") + '"' : "";
        var type = el.getAttribute("type") ? 'type="' + el.getAttribute("type") + '"' : "";
        var placeholder = el.getAttribute("placeholder") ? 'placeholder="' + el.getAttribute("placeholder") + '"' : "";
        var ariaLabel = el.getAttribute("aria-label") ? 'aria-label="' + el.getAttribute("aria-label") + '"' : "";
        var forAttr = el.getAttribute("for") ? 'for="' + el.getAttribute("for") + '"' : "";
        var text = el.childNodes.length === 1 && el.childNodes[0].nodeType === 3
          ? el.childNodes[0].textContent.trim() : "";
        var dataAction = el.getAttribute("data-action") ? 'data-action="' + el.getAttribute("data-action") + '"' : "";
        var dataField = el.getAttribute("data-field") ? 'data-field="' + el.getAttribute("data-field") + '"' : "";
        var onclick = el.hasAttribute("onclick") ? "onclick" : "";
        var cls = el.className ? 'class="' + el.className + '"' : "";
        var value = el.getAttribute("value") != null ? 'value="' + el.getAttribute("value") + '"' : "";

        var attrs = [role && ("role=" + role), id, name, type, placeholder, ariaLabel, forAttr, dataAction, dataField, onclick, cls, value]
          .filter(Boolean).join(" ");
        var indent = "";
        for (var i = 0; i < depth; i++) indent += "  ";
        var line = indent + "<" + tag + (attrs ? " " + attrs : "") + ">";
        if (text) line += ' "' + text + '"';

        var children = Array.from(el.children).map(function(c) { return walk(c, depth + 1); }).join("\\n");
        if (children) return line + "\\n" + children;
        return line;
      }
      return walk(document.body, 0);
    })()`);
  }

  async function freshPage(html: string): Promise<Page> {
    if (page && !page.isClosed()) await page.close();
    page = await browser.newPage();
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return page;
  }

  for (const model of MODELS) {
    describe(`Model: ${model}`, () => {
      // ─── A. Accessibility Tree Resolution ───

      it("A. Accessibility tree resolution - fill name field", async () => {
        if (skipWithoutKey()) return;

        const p = await freshPage(FORM_HTML);
        const llm = createOpenRouterProvider(model);
        const start = Date.now();

        // Get accessibility tree
        const tree = await getAccessibilityTree(p);

        const intent: Intent = {
          name: "fill-name",
          goal: "Fill the name field",
          page: "/register",
          value: "John Doe",
        };

        const selector = await llm.findElementFromAccessibilityTree(intent, tree);
        const responseTime = Date.now() - start;

        let selectorWorks = false;
        if (selector) {
          try {
            const el = p.locator(selector).first();
            selectorWorks = await el.isVisible({ timeout: 3000 });
            if (selectorWorks) {
              await el.fill("John Doe");
              const val = await p.inputValue("#fullName");
              selectorWorks = val === "John Doe";
            }
          } catch {
            selectorWorks = false;
          }
        }

        logResult({
          model,
          test: "accessibility-tree-resolution",
          intent: intent.goal,
          accessibilityTreeChars: tree.length,
          llmResponse: selector ?? "(null)",
          selector: selector ?? undefined,
          success: selectorWorks,
          responseTimeMs: responseTime,
          error: selectorWorks ? undefined : `Selector ${selector} did not resolve to the name field`,
        });

        assert.ok(selector, "LLM should return a selector");
        assert.ok(selectorWorks, `Selector '${selector}' should work on the page and fill the name field`);
      });

      // ─── B. Ambiguous Element Resolution ───

      it("B. Ambiguous element resolution - pick Submit Review", async () => {
        if (skipWithoutKey()) return;

        const p = await freshPage(AMBIGUOUS_BUTTONS_HTML);
        const llm = createOpenRouterProvider(model);
        const start = Date.now();

        const tree = await getAccessibilityTree(p);

        const intent: Intent = {
          name: "click-submit-review",
          goal: "Click the Submit Review button",
          page: "/reviews",
        };

        const selector = await llm.findElementFromAccessibilityTree(intent, tree);
        const responseTime = Date.now() - start;

        let resolvedTo = "(none)";
        let correct = false;
        if (selector) {
          try {
            const el = p.locator(selector).first();
            const text = await el.textContent();
            resolvedTo = text?.trim() ?? "(empty)";
            correct = resolvedTo === "Submit Review";
          } catch {
            resolvedTo = "(selector error)";
          }
        }

        logResult({
          model,
          test: "ambiguous-element-resolution",
          intent: intent.goal,
          accessibilityTreeChars: tree.length,
          llmResponse: selector ?? "(null)",
          selector: selector ?? undefined,
          resolvedTo,
          correct,
          success: correct,
          responseTimeMs: responseTime,
          error: correct ? undefined : `Resolved to '${resolvedTo}' instead of 'Submit Review'`,
        });

        assert.ok(selector, "LLM should return a selector");
        assert.ok(correct, `Should pick 'Submit Review', got '${resolvedTo}'`);
      });

      // ─── C. Non-Standard Element Resolution ───

      it("C. Non-standard element resolution - click styled div", async () => {
        if (skipWithoutKey()) return;

        const p = await freshPage(CUSTOM_ELEMENTS_HTML);
        const llm = createOpenRouterProvider(model);
        const start = Date.now();

        const tree = await getAccessibilityTree(p);

        const intent: Intent = {
          name: "click-save-changes",
          goal: "Click the save changes action",
          page: "/settings",
        };

        const selector = await llm.findElementFromAccessibilityTree(intent, tree);
        const responseTime = Date.now() - start;

        let selectorWorks = false;
        let resolvedTo = "(none)";
        if (selector) {
          try {
            const el = p.locator(selector).first();
            const visible = await el.isVisible({ timeout: 3000 });
            if (visible) {
              const text = await el.textContent();
              resolvedTo = text?.trim() ?? "(empty)";
              selectorWorks = resolvedTo.includes("Save Changes");
            }
          } catch {
            resolvedTo = "(selector error)";
          }
        }

        logResult({
          model,
          test: "non-standard-element-resolution",
          intent: intent.goal,
          accessibilityTreeChars: tree.length,
          llmResponse: selector ?? "(null)",
          selector: selector ?? undefined,
          method: "llm (accessibility tree)",
          resolvedTo,
          success: selectorWorks,
          responseTimeMs: responseTime,
          error: selectorWorks ? undefined : `Could not resolve to 'Save Changes' div, got '${resolvedTo}'`,
        });

        assert.ok(selector, "LLM should return a selector");
        assert.ok(selectorWorks, `Selector should resolve to Save Changes div, got '${resolvedTo}'`);
      });

      // ─── D. Vision-Based Resolution ───

      it("D. Vision-based resolution - fill search box", async () => {
        if (skipWithoutKey()) return;

        const p = await freshPage(SEARCH_BAR_HTML);
        const llm = createOpenRouterProvider(model);
        const start = Date.now();

        // Take screenshot
        const screenshot = await p.screenshot({ type: "png" });
        const base64 = screenshot.toString("base64");
        const viewport = p.viewportSize();
        const dims = viewport ? `${viewport.width}x${viewport.height}` : "unknown";

        const intent: Intent = {
          name: "fill-search",
          goal: "Fill the search box",
          page: "/search",
          value: "test query",
        };

        const selector = await llm.findElementFromScreenshot(intent, base64);
        const responseTime = Date.now() - start;

        let selectorWorks = false;
        if (selector) {
          try {
            const el = p.locator(selector).first();
            const visible = await el.isVisible({ timeout: 3000 });
            if (visible) {
              await el.fill("test query");
              const val = await p.inputValue("#search-input");
              selectorWorks = val === "test query";
            }
          } catch {
            selectorWorks = false;
          }
        }

        logResult({
          model,
          test: "vision-based-resolution",
          intent: intent.goal,
          screenshotDimensions: dims,
          llmResponse: selector ?? "(null)",
          selector: selector ?? undefined,
          method: "vision",
          success: selectorWorks,
          responseTimeMs: responseTime,
          error: selectorWorks ? undefined : `Vision selector '${selector}' did not fill search box`,
        });

        assert.ok(selector, "LLM should return a selector from screenshot");
        assert.ok(selectorWorks, `Vision selector '${selector}' should work on the search input`);
      });

      // ─── E. Page Recovery Analysis ───

      it("E. Page recovery analysis - login redirect", async () => {
        if (skipWithoutKey()) return;

        const p = await freshPage(LOGIN_REDIRECT_HTML);
        const llm = createOpenRouterProvider(model);
        const start = Date.now();

        const content = await p.content();
        const intent: Intent = {
          name: "click-dashboard",
          goal: "Click the Dashboard link",
          page: "/home",
        };

        const analysis = await llm.analyzePageForRecovery(
          intent,
          content,
          "No strategy could resolve intent - element not found on page"
        );
        const responseTime = Date.now() - start;

        const validActions = ["navigate", "dismiss", "wait", "escalate"];
        const hasValidAction = analysis != null && validActions.includes(analysis.action);
        const hasDetail = analysis != null && typeof analysis.detail === "string" && analysis.detail.length > 0;

        logResult({
          model,
          test: "page-recovery-analysis",
          intent: intent.goal,
          suggestedAction: analysis?.action ?? "(null)",
          actionDetail: analysis?.detail ?? "(null)",
          success: hasValidAction && hasDetail,
          responseTimeMs: responseTime,
          error: hasValidAction && hasDetail
            ? undefined
            : `Invalid recovery response: ${JSON.stringify(analysis)}`,
        });

        assert.ok(analysis, "LLM should return a recovery analysis");
        assert.ok(hasValidAction, `Action '${analysis?.action}' should be one of ${validActions.join(", ")}`);
        assert.ok(hasDetail, "Recovery should include detail string");
      });

      // ─── F. Full Intent Execution (End-to-End) ───

      it("F. Full intent execution - aria then LLM fallback", async () => {
        if (skipWithoutKey()) return;

        const llm = createOpenRouterProvider(model);

        // Step 1: Labeled form - should resolve via aria (no LLM needed)
        const p1 = await freshPage(LABELED_FORM_HTML);
        const engine1 = new IntentEngine({ llm });

        const intent: Intent = {
          name: "fill-first-name",
          goal: "Fill the First Name textbox",
          page: "/contact",
          value: "Alice",
        };

        const start1 = Date.now();
        const result1 = await engine1.execute(intent, p1);
        const time1 = Date.now() - start1;

        const val1 = result1.success ? await p1.inputValue("#firstName") : null;

        // Step 2: Unlabeled form - aria will fail, should fall through to LLM
        const p2 = await freshPage(UNLABELED_FORM_HTML);
        const engine2 = new IntentEngine({ llm });

        const intent2: Intent = {
          name: "fill-first-name",
          goal: "Fill the first name field",
          page: "/contact",
          value: "Alice",
        };

        const start2 = Date.now();
        const result2 = await engine2.execute(intent2, p2);
        const time2 = Date.now() - start2;

        const val2 = result2.success ? await p2.inputValue("#firstName") : null;

        const bothSucceeded = result1.success && result2.success;
        const secondUsedLLM = result2.method === "llm" || result2.method === "vision";

        logResult({
          model,
          test: "full-intent-execution-e2e",
          intent: "Fill the first name field (labeled then unlabeled)",
          firstAttempt: {
            method: result1.method ?? "unknown",
            timeMs: time1,
          },
          secondAttempt: {
            method: result2.method ?? "unknown",
            timeMs: time2,
          },
          success: bothSucceeded,
          responseTimeMs: time1 + time2,
          error: bothSucceeded
            ? undefined
            : `First: success=${result1.success} val=${val1}, Second: success=${result2.success} val=${val2}`,
        });

        assert.ok(result1.success, "First attempt (labeled form) should succeed");
        assert.equal(result1.method, "aria", "First attempt should use aria");
        assert.equal(val1, "Alice", "First attempt should fill value");

        assert.ok(result2.success, "Second attempt (unlabeled form) should succeed");
        assert.ok(secondUsedLLM, `Second attempt should use LLM/vision, got '${result2.method}'`);
        assert.equal(val2, "Alice", "Second attempt should fill value");
      });
    });
  }
});
