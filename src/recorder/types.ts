/**
 * Types for the TierZero Workflow Recording System.
 */

// ---------------------------------------------------------------------------
// Recorded Action & Session
// ---------------------------------------------------------------------------

export interface RecordedElement {
  selector: string;
  ariaRole?: string;
  ariaLabel?: string;
  text?: string;
  tagName: string;
  attributes: Record<string, string>;
  coordinates?: { x: number; y: number };
}

export type RecordedActionType =
  | "click"
  | "type"
  | "navigate"
  | "select"
  | "check"
  | "submit"
  | "upload"
  | "wait";

export interface RecordedAction {
  type: RecordedActionType;
  timestamp: number;
  element?: RecordedElement;
  value?: string;
  url?: string;
  pageUrl: string;
  pageTitle: string;
  pageStateBefore: string;
  pageStateAfter: string;
  stateChanges: string[];
}

export interface RecordedSession {
  id: string;
  startTime: string;
  endTime?: string;
  actions: RecordedAction[];
  startUrl: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Annotated Actions
// ---------------------------------------------------------------------------

export interface AnnotatedAction extends RecordedAction {
  description: string;
  groupId?: string;
  groupName?: string;
  isVariable: boolean;
  variableName?: string;
}

export interface ActionGroup {
  id: string;
  name: string;
  actions: AnnotatedAction[];
}

export interface AnnotatedSession extends RecordedSession {
  actions: AnnotatedAction[];
  groups: ActionGroup[];
  workflowName: string;
  variables: WorkflowVariable[];
}

export interface WorkflowVariable {
  name: string;
  description: string;
  defaultValue?: string;
  source: "typed" | "selected" | "url";
}

// ---------------------------------------------------------------------------
// Recording Options & Events
// ---------------------------------------------------------------------------

export interface RecordingOptions {
  captureScreenshots?: boolean;
  throttleMs?: number;
  excludeSelectors?: string[];
}

export type RecordingStatus =
  | "idle"
  | "recording"
  | "paused"
  | "stopped"
  | "generating";

export interface RecordingEvent {
  type:
    | "status_change"
    | "action_recorded"
    | "annotation_added"
    | "error";
  timestamp: string;
  data: Record<string, unknown>;
}

export type RecordingEventHandler = (event: RecordingEvent) => void;
