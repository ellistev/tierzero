/**
 * Sophisticated Mock LLM for E2E tests.
 * Parses accessibility trees and page content to return realistic selectors.
 */

import type { Intent, LLMProvider } from "../../src/intents/types";

interface TreeNode {
  role?: string;
  name?: string;
  children?: TreeNode[];
  [key: string]: unknown;
}

/**
 * MockLLM that provides realistic element finding by parsing the
 * accessibility tree and page content.
 */
export class MockLLM implements LLMProvider {
  private callLog: Array<{ method: string; args: unknown[] }> = [];

  getCallLog() {
    return this.callLog;
  }

  /**
   * Find element from accessibility tree by matching intent target
   * against node names and roles.
   */
  async findElementFromAccessibilityTree(
    intent: Intent,
    tree: string
  ): Promise<string | null> {
    this.callLog.push({
      method: "findElementFromAccessibilityTree",
      args: [intent, tree.slice(0, 200)],
    });

    let parsed: TreeNode;
    try {
      parsed = JSON.parse(tree);
    } catch {
      return null;
    }

    const target = intent.target.toLowerCase();
    const action = intent.action;

    // Search the tree for a matching element
    const match = this.findBestMatch(parsed, target, action, intent.value);
    if (match) return match;

    // Fallback: try common patterns
    return this.fallbackSelector(intent);
  }

  /**
   * Find element from screenshot - returns coordinates from a predetermined map.
   */
  async findElementFromScreenshot(
    intent: Intent,
    _base64: string
  ): Promise<{ selector?: string; coordinates?: { x: number; y: number } } | null> {
    this.callLog.push({
      method: "findElementFromScreenshot",
      args: [intent],
    });

    // For the mock, we use selector-based fallback
    const selector = this.fallbackSelector(intent);
    if (selector) return { selector };

    // Return center-ish coordinates as last resort
    return { coordinates: { x: 500, y: 400 } };
  }

  /**
   * Analyze page for recovery - detects error pages, modals, etc.
   */
  async analyzePageForRecovery(
    intent: Intent,
    pageContent: string,
    error: string
  ): Promise<{ action: string; detail: string } | null> {
    this.callLog.push({
      method: "analyzePageForRecovery",
      args: [intent, pageContent.slice(0, 200), error],
    });

    const content = pageContent.toLowerCase();

    // Detect error pages
    if (content.includes("500") || content.includes("internal server error")) {
      return { action: "escalate", detail: "Server error detected (500)" };
    }
    if (content.includes("404") || content.includes("not found")) {
      return { action: "escalate", detail: "Page not found (404)" };
    }

    // Detect modals that need dismissing
    if (content.includes("are you sure") || content.includes("confirm")) {
      return { action: "dismiss_modal", detail: "Confirmation dialog detected" };
    }

    // If element not found, try scrolling
    if (error.includes("Could not resolve") || error.includes("not found")) {
      return { action: "scroll", detail: "Element not visible, try scrolling" };
    }

    // If timeout, wait
    if (error.includes("timeout") || error.includes("Timeout")) {
      return { action: "wait", detail: "Page still loading" };
    }

    return null;
  }

  /**
   * Parse a goal string into an intent.
   */
  async parseGoalToIntent(goal: string): Promise<Intent> {
    this.callLog.push({ method: "parseGoalToIntent", args: [goal] });

    const lower = goal.toLowerCase();

    if (lower.includes("click") || lower.includes("press")) {
      const target = goal.replace(/click|press|the|on|button/gi, "").trim();
      return { action: "click", target: target || goal };
    }
    if (lower.includes("type") || lower.includes("fill") || lower.includes("enter")) {
      const parts = lower.split(/into|in|to/);
      const value = parts[0].replace(/type|fill|enter|"|'/gi, "").trim();
      const target = (parts[1] || "input").trim();
      return { action: "fill", target, value };
    }
    if (lower.includes("select") || lower.includes("choose")) {
      const parts = lower.split(/from|in/);
      const value = parts[0].replace(/select|choose|"|'/gi, "").trim();
      const target = (parts[1] || "dropdown").trim();
      return { action: "select", target, value };
    }
    if (lower.includes("navigate") || lower.includes("go to")) {
      const target = goal.replace(/navigate|go to|to/gi, "").trim();
      return { action: "navigate", target, value: target };
    }

    return { action: "click", target: goal };
  }

  /**
   * Decompose a complex goal into atomic intents.
   */
  async decomposeGoal(goal: string): Promise<Intent[]> {
    this.callLog.push({ method: "decomposeGoal", args: [goal] });
    const intent = await this.parseGoalToIntent(goal);
    return [intent];
  }

  /**
   * Find coordinates from screenshot.
   */
  async findCoordinatesFromScreenshot(
    intent: Intent,
    _base64: string,
    viewport: { width: number; height: number }
  ): Promise<{ x: number; y: number; width: number; height: number } | null> {
    this.callLog.push({
      method: "findCoordinatesFromScreenshot",
      args: [intent, viewport],
    });
    return {
      x: Math.floor(viewport.width / 2),
      y: Math.floor(viewport.height / 2),
      width: 100,
      height: 30,
    };
  }

  // ---------------------------------------------------------------------------
  // Tree matching logic
  // ---------------------------------------------------------------------------

  private findBestMatch(
    node: TreeNode,
    target: string,
    action: string,
    value?: string
  ): string | null {
    const name = ((node.name as string) || "").toLowerCase();
    const role = ((node.role as string) || "").toLowerCase();

    // Direct name match
    if (name && this.isMatch(name, target)) {
      return this.buildSelector(node, role);
    }

    // For fill actions, match input fields by label
    if (action === "fill" || action === "select") {
      if (this.isInputRole(role) && this.isMatch(name, target)) {
        return this.buildSelector(node, role);
      }
    }

    // Recurse into children
    const children = node.children || [];
    for (const child of children) {
      const found = this.findBestMatch(child, target, action, value);
      if (found) return found;
    }

    return null;
  }

  private isMatch(nodeName: string, target: string): boolean {
    // Exact match
    if (nodeName === target) return true;
    // Contains match
    if (nodeName.includes(target)) return true;
    if (target.includes(nodeName) && nodeName.length > 2) return true;
    // Word match - check if key words overlap
    const nodeWords = nodeName.split(/\s+/);
    const targetWords = target.split(/\s+/);
    const overlap = targetWords.filter((w) =>
      nodeWords.some((nw) => nw.includes(w) || w.includes(nw))
    );
    return overlap.length > 0 && overlap.length >= targetWords.length * 0.5;
  }

  private isInputRole(role: string): boolean {
    return ["textbox", "combobox", "searchbox", "spinbutton", "slider"].includes(role);
  }

  private buildSelector(node: TreeNode, role: string): string {
    const name = node.name as string;
    if (name) {
      // Always use aria-label for reliable cross-layout matching
      return `[aria-label="${name}"]`;
    }
    if (role) return `[role="${role}"]`;
    return "*";
  }

  /**
   * Fallback selectors based on common patterns.
   */
  private fallbackSelector(intent: Intent): string | null {
    const target = intent.target.toLowerCase();
    const action = intent.action;

    // Login-related
    if (target.includes("username") || target.includes("user name")) {
      return 'input[name="username"], #username, [aria-label="Username"]';
    }
    if (target.includes("password")) {
      return 'input[name="password"], #password, [aria-label="Password"]';
    }
    if (target.includes("sign in") || target.includes("login") || target.includes("enter")) {
      return '[aria-label="Sign in"], button[type="submit"]';
    }

    // Search - navigation link
    if (target === "search" && action === "click") {
      return 'a[aria-label="Search"]';
    }
    // Search query input
    if (target.includes("search query") || target.includes("search")) {
      if (action === "fill") {
        return '#searchQuery, input[type="search"], [aria-label="Search query"]';
      }
      return '[aria-label="Search tickets"], button[type="submit"]';
    }

    // Ticket actions
    if (target.includes("resolve") || target.includes("done") || target.includes("✓")) {
      return '[aria-label="Resolve ticket"]';
    }
    if (target.includes("comment text") || target.includes("write your comment") || target.includes("comment")) {
      if (action === "fill") {
        return '#comment, textarea[name="comment"], [aria-label="Comment text"]';
      }
      return 'button[aria-label="Add comment"]';
    }
    if (target.includes("add comment") || target.includes("💬")) {
      return 'button[aria-label="Add comment"]';
    }
    if (target.includes("save") || target.includes("💾")) {
      return '[aria-label="Save assignment"]';
    }
    if (target.includes("assign") && action === "select") {
      return '#assignee, select[name="assignee"], [aria-label="Assign to"]';
    }

    // Confirm modal
    if (target.includes("confirm") || target.includes("yes, proceed") || target.includes("proceed")) {
      return '[aria-label="Confirm resolve"]';
    }
    if (target.includes("cancel") || target.includes("go back")) {
      return '[aria-label="Cancel"]';
    }

    // Navigation links
    if (target.includes("dashboard")) {
      return '[aria-label="Dashboard"]';
    }

    // Ticket links - match by aria-label pattern
    const ticketMatch = target.match(/(?:open ticket |ticket )(tkt-\d+)/i);
    if (ticketMatch) {
      return `[aria-label="Open ticket ${ticketMatch[1].toUpperCase()}"]`;
    }

    // Generic link with text
    if (action === "click") {
      // Try to find by text content
      return null; // Let aria strategy handle it
    }

    return null;
  }
}
