/**
 * Central exports for the TierZero Workflow Recording System.
 */

// Types
export type {
  RecordedAction,
  RecordedElement,
  RecordedActionType,
  RecordedSession,
  AnnotatedAction,
  ActionGroup,
  AnnotatedSession,
  WorkflowVariable,
  RecordingOptions,
  RecordingStatus,
  RecordingEvent,
  RecordingEventHandler,
} from "./types";

// CDP Recorder
export { CDPRecorder } from "./cdp-recorder";

// Annotator
export { ActionAnnotator } from "./annotator";

// Workflow Generator
export { WorkflowGenerator } from "./generator";
export type { GeneratedWorkflow, GeneratedStep } from "./generator";

// Skill Generator
export { SkillGenerator } from "./skill-generator";
export type { GeneratedSkill } from "./skill-generator";

// Controller
export { RecordingController } from "./controller";

// CLI
export { RecordCLI } from "./cli";
