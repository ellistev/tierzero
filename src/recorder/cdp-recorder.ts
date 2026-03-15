/**
 * CDP Event Recorder - Captures raw browser events via Chrome DevTools Protocol.
 */

import type { Page, CDPSession } from "playwright";
import { capturePageState, describePageState, diffPageState } from "../browser/page-state";
import type {
  RecordedAction,
  RecordedSession,
  RecordedElement,
  RecordedActionType,
  RecordingOptions,
} from "./types";

// ---------------------------------------------------------------------------
// CDPRecorder
// ---------------------------------------------------------------------------

export class CDPRecorder {
  private page: Page;
  private session: CDPSession | null = null;
  private actions: RecordedAction[] = [];
  private recording = false;
  private sessionId: string;
  private startUrl = "";
  private startTime = "";
  private options: Required<RecordingOptions>;
  private lastActionTime = 0;

  constructor(page: Page, options: RecordingOptions = {}) {
    this.page = page;
    this.sessionId = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.options = {
      captureScreenshots: options.captureScreenshots ?? false,
      throttleMs: options.throttleMs ?? 100,
      excludeSelectors: options.excludeSelectors ?? [],
    };
  }

  /**
   * Start recording browser events.
   */
  async start(): Promise<void> {
    if (this.recording) return;
    this.recording = true;
    this.startTime = new Date().toISOString();
    this.startUrl = this.page.url();
    this.actions = [];

    // Connect CDP session
    try {
      this.session = await this.page.context().newCDPSession(this.page);
      await this.session.send("Page.enable");
      await this.session.send("Network.enable");
    } catch {
      // CDP not available (e.g., Firefox) - fall back to Playwright events only
      this.session = null;
    }

    // Listen to Playwright-level events
    this.page.on("framenavigated", this.handleNavigation);
    this.page.on("console", this.handleConsole);
  }

  /**
   * Stop recording and return the session.
   */
  async stop(): Promise<RecordedSession> {
    this.recording = false;

    // Remove listeners
    this.page.off("framenavigated", this.handleNavigation);
    this.page.off("console", this.handleConsole);

    // Disconnect CDP
    if (this.session) {
      try {
        await this.session.detach();
      } catch {
        // Already detached
      }
      this.session = null;
    }

    return {
      id: this.sessionId,
      startTime: this.startTime,
      endTime: new Date().toISOString(),
      actions: [...this.actions],
      startUrl: this.startUrl,
      metadata: {},
    };
  }

  /**
   * Record a click action.
   */
  async recordClick(element: RecordedElement): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("click", element);
  }

  /**
   * Record a type/fill action.
   */
  async recordType(element: RecordedElement, value: string): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("type", element, value);
  }

  /**
   * Record a select action.
   */
  async recordSelect(element: RecordedElement, value: string): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("select", element, value);
  }

  /**
   * Record a check/uncheck action.
   */
  async recordCheck(element: RecordedElement, checked: boolean): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("check", element, String(checked));
  }

  /**
   * Record a form submission.
   */
  async recordSubmit(element: RecordedElement): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("submit", element);
  }

  /**
   * Record a file upload.
   */
  async recordUpload(element: RecordedElement, fileName: string): Promise<void> {
    if (!this.recording || this.isThrottled()) return;
    await this.recordAction("upload", element, fileName);
  }

  /**
   * Record a wait/pause.
   */
  async recordWait(reason: string): Promise<void> {
    if (!this.recording) return;
    const stateBefore = await this.captureState();
    this.actions.push({
      type: "wait",
      timestamp: Date.now(),
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      pageStateBefore: stateBefore,
      pageStateAfter: stateBefore,
      stateChanges: [],
      value: reason,
    });
  }

  /**
   * Get current recorded actions.
   */
  getActions(): RecordedAction[] {
    return [...this.actions];
  }

  /**
   * Check if currently recording.
   */
  isRecording(): boolean {
    return this.recording;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async recordAction(
    type: RecordedActionType,
    element?: RecordedElement,
    value?: string
  ): Promise<void> {
    const stateBefore = await this.captureState();
    const pageUrl = this.page.url();
    const pageTitle = await this.page.title();

    // Small delay to let the action take effect
    await new Promise((r) => setTimeout(r, 50));

    const stateAfter = await this.captureState();

    // Compute state changes
    const stateChanges = this.computeStateChanges(stateBefore, stateAfter);

    this.actions.push({
      type,
      timestamp: Date.now(),
      element,
      value,
      pageUrl,
      pageTitle,
      pageStateBefore: stateBefore,
      pageStateAfter: stateAfter,
      stateChanges,
    });

    this.lastActionTime = Date.now();
  }

  private async captureState(): Promise<string> {
    try {
      const state = await capturePageState(this.page);
      return describePageState(state);
    } catch {
      return `Page: ${this.page.url()}`;
    }
  }

  private computeStateChanges(before: string, after: string): string[] {
    if (before === after) return [];
    const changes: string[] = [];

    const beforeLines = new Set(before.split("\n"));
    const afterLines = after.split("\n");

    for (const line of afterLines) {
      if (!beforeLines.has(line) && line.trim()) {
        changes.push(line.trim());
      }
    }

    return changes.length > 0 ? changes : ["Page state changed"];
  }

  private isThrottled(): boolean {
    return Date.now() - this.lastActionTime < this.options.throttleMs;
  }

  private handleNavigation = async (): Promise<void> => {
    if (!this.recording) return;
    const stateBefore = await this.captureState();
    this.actions.push({
      type: "navigate",
      timestamp: Date.now(),
      url: this.page.url(),
      pageUrl: this.page.url(),
      pageTitle: await this.page.title(),
      pageStateBefore: stateBefore,
      pageStateAfter: stateBefore,
      stateChanges: ["Page navigated"],
    });
  };

  private handleConsole = (): void => {
    // Console messages can be used for debugging but we don't record them as actions
  };
}
