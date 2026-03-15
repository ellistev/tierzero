/**
 * Recording Controller - Orchestrates the recording flow.
 */

import type { Page } from "playwright";
import { CDPRecorder } from "./cdp-recorder";
import { ActionAnnotator } from "./annotator";
import { WorkflowGenerator } from "./generator";
import { SkillGenerator } from "./skill-generator";
import type { GeneratedWorkflow } from "./generator";
import type { GeneratedSkill } from "./skill-generator";
import type {
  RecordedSession,
  AnnotatedSession,
  RecordingOptions,
  RecordingStatus,
  RecordingEvent,
  RecordingEventHandler,
} from "./types";
import type { LLMProvider } from "../intents/types";

// ---------------------------------------------------------------------------
// RecordingController
// ---------------------------------------------------------------------------

export class RecordingController {
  private recorder: CDPRecorder | null = null;
  private page: Page | null = null;
  private status: RecordingStatus = "idle";
  private annotations: string[] = [];
  private eventHandlers: RecordingEventHandler[] = [];
  private llm?: LLMProvider;
  private options: RecordingOptions;
  private lastSession: RecordedSession | null = null;

  constructor(llm?: LLMProvider, options: RecordingOptions = {}) {
    this.llm = llm;
    this.options = options;
  }

  /**
   * Begin recording on a Playwright page.
   */
  async startRecording(page: Page, options?: RecordingOptions): Promise<void> {
    if (this.status === "recording") {
      throw new Error("Already recording. Stop the current recording first.");
    }

    this.page = page;
    this.annotations = [];
    this.recorder = new CDPRecorder(page, options || this.options);
    await this.recorder.start();
    this.setStatus("recording");
  }

  /**
   * Stop recording and return the recorded session.
   */
  async stopRecording(): Promise<RecordedSession> {
    if (!this.recorder) {
      throw new Error("No active recording to stop.");
    }

    const session = await this.recorder.stop();

    // Add annotations to metadata
    if (this.annotations.length > 0) {
      session.metadata.annotations = [...this.annotations];
    }

    this.lastSession = session;
    this.setStatus("stopped");
    this.recorder = null;

    return session;
  }

  /**
   * Pause the current recording.
   */
  pauseRecording(): void {
    if (this.status !== "recording") {
      throw new Error("Cannot pause: not currently recording.");
    }
    this.setStatus("paused");
  }

  /**
   * Resume a paused recording.
   */
  resumeRecording(): void {
    if (this.status !== "paused") {
      throw new Error("Cannot resume: not currently paused.");
    }
    this.setStatus("recording");
  }

  /**
   * Add a human annotation/note during recording.
   */
  addAnnotation(note: string): void {
    this.annotations.push(note);
    this.emit({
      type: "annotation_added",
      timestamp: new Date().toISOString(),
      data: { note },
    });
  }

  /**
   * Full pipeline: record → annotate → generate workflow → generate skill.
   */
  async generateFromRecording(
    session: RecordedSession
  ): Promise<{ workflow: GeneratedWorkflow; skill: GeneratedSkill }> {
    this.setStatus("generating");

    // Step 1: Annotate
    const annotator = new ActionAnnotator(this.llm);
    const annotatedSession = annotator.annotateSession(session);

    // Step 2: Generate workflow
    const workflowGenerator = new WorkflowGenerator();
    const workflow = workflowGenerator.generateWorkflow(annotatedSession);

    // Step 3: Generate skill
    const skillGenerator = new SkillGenerator();
    const skill = skillGenerator.generateSkill(workflow);

    this.setStatus("stopped");

    return { workflow, skill };
  }

  /**
   * Get the current recording status.
   */
  getStatus(): RecordingStatus {
    return this.status;
  }

  /**
   * Get the last recorded session.
   */
  getLastSession(): RecordedSession | null {
    return this.lastSession;
  }

  /**
   * Get the CDPRecorder instance (for direct action recording).
   */
  getRecorder(): CDPRecorder | null {
    return this.recorder;
  }

  /**
   * Subscribe to recording events.
   */
  onEvent(handler: RecordingEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /**
   * Remove an event handler.
   */
  offEvent(handler: RecordingEventHandler): void {
    this.eventHandlers = this.eventHandlers.filter((h) => h !== handler);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private setStatus(status: RecordingStatus): void {
    const previousStatus = this.status;
    this.status = status;
    this.emit({
      type: "status_change",
      timestamp: new Date().toISOString(),
      data: { from: previousStatus, to: status },
    });
  }

  private emit(event: RecordingEvent): void {
    for (const handler of this.eventHandlers) {
      try {
        handler(event);
      } catch {
        // Don't let handler errors break the controller
      }
    }
  }
}
