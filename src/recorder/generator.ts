/**
 * Workflow Generator - Converts annotated recordings into TierZero workflows.
 */

import type { Intent } from "../intents/types";
import type { WorkflowStep } from "../workflows/types";
import type { ChainStep } from "../intents/chain";
import type {
  AnnotatedAction,
  AnnotatedSession,
  WorkflowVariable,
} from "./types";

// ---------------------------------------------------------------------------
// Generated Workflow
// ---------------------------------------------------------------------------

export interface GeneratedWorkflow {
  id: string;
  name: string;
  description: string;
  parameters: WorkflowVariable[];
  steps: GeneratedStep[];
  chainSteps: ChainStep[];
  source: {
    sessionId: string;
    recordedAt: string;
    actionCount: number;
  };
}

export interface GeneratedStep {
  name: string;
  intent: Intent;
  expectedState?: {
    urlContains?: string;
    titleContains?: string;
    noErrors?: boolean;
  };
  isParameterized: boolean;
  parameterName?: string;
}

// ---------------------------------------------------------------------------
// WorkflowGenerator
// ---------------------------------------------------------------------------

export class WorkflowGenerator {
  /**
   * Generate a workflow from an annotated session.
   */
  generateWorkflow(session: AnnotatedSession): GeneratedWorkflow {
    const steps = this.generateSteps(session.actions, session.variables);
    const chainSteps = this.generateChainSteps(steps);

    return {
      id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: session.workflowName,
      description: this.generateDescription(session),
      parameters: session.variables,
      steps,
      chainSteps,
      source: {
        sessionId: session.id,
        recordedAt: session.startTime,
        actionCount: session.actions.length,
      },
    };
  }

  /**
   * Generate intent-based steps from annotated actions.
   */
  generateSteps(
    actions: AnnotatedAction[],
    variables: WorkflowVariable[]
  ): GeneratedStep[] {
    const variableNames = new Set(variables.map((v) => v.name));

    return actions.map((action, index) => {
      const intent = this.actionToIntent(action);
      const isParameterized = action.isVariable && !!action.variableName;
      const parameterName =
        isParameterized && action.variableName && variableNames.has(action.variableName)
          ? action.variableName
          : undefined;

      // If the action is parameterized, use a template in the intent value
      if (parameterName && intent.value) {
        intent.value = `{{${parameterName}}}`;
      }

      return {
        name: action.description || `Step ${index + 1}`,
        intent,
        expectedState: this.inferExpectedState(action),
        isParameterized: !!parameterName,
        parameterName,
      };
    });
  }

  /**
   * Generate ChainSteps for ActionChain execution.
   */
  generateChainSteps(steps: GeneratedStep[]): ChainStep[] {
    return steps.map((step) => ({
      intent: step.intent,
      expectedState: step.expectedState,
      maxRetries: 2,
      delayAfterMs: 500,
    }));
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Convert a recorded action into an intent-based goal.
   * Key design: intents describe WHAT to do, not HOW (no selectors).
   */
  private actionToIntent(action: AnnotatedAction): Intent {
    const element = action.element;

    switch (action.type) {
      case "click":
        return {
          action: "click",
          target: this.describeTarget(element, "button"),
          meta: { recorded: true },
        };

      case "type":
        return {
          action: "fill",
          target: this.describeTarget(element, "input field"),
          value: action.value || "",
          meta: { recorded: true },
        };

      case "navigate":
        return {
          action: "navigate",
          target: action.url || action.pageUrl,
          value: action.url || action.pageUrl,
          meta: { recorded: true },
        };

      case "select":
        return {
          action: "select",
          target: this.describeTarget(element, "dropdown"),
          value: action.value || "",
          meta: { recorded: true },
        };

      case "check":
        return {
          action: "click",
          target: this.describeTarget(element, "checkbox"),
          meta: { recorded: true, check: action.value === "true" },
        };

      case "submit":
        return {
          action: "click",
          target: this.describeTarget(element, "submit button"),
          meta: { recorded: true, submit: true },
        };

      case "upload":
        return {
          action: "fill",
          target: this.describeTarget(element, "file input"),
          value: action.value || "",
          meta: { recorded: true, upload: true },
        };

      case "wait":
        return {
          action: "wait",
          target: action.value || "page load",
          meta: { recorded: true },
        };

      default:
        return {
          action: action.type,
          target: this.describeTarget(element, "element"),
          value: action.value,
          meta: { recorded: true },
        };
    }
  }

  /**
   * Describe the target element using human-friendly terms (not selectors).
   */
  private describeTarget(
    element: AnnotatedAction["element"],
    fallback: string
  ): string {
    if (!element) return fallback;

    // Prefer aria label
    if (element.ariaLabel) {
      return element.ariaLabel;
    }

    // Use visible text
    if (element.text) {
      const cleaned = element.text.trim().slice(0, 60);
      if (cleaned) return cleaned;
    }

    // Use aria role
    if (element.ariaRole) {
      return `${element.ariaRole} element`;
    }

    return fallback;
  }

  /**
   * Infer expected state after an action.
   */
  private inferExpectedState(
    action: AnnotatedAction
  ): GeneratedStep["expectedState"] | undefined {
    // Navigation actions should verify URL changed
    if (action.type === "navigate" && action.url) {
      try {
        const urlObj = new URL(action.url);
        return {
          urlContains: urlObj.pathname,
          noErrors: true,
        };
      } catch {
        return { noErrors: true };
      }
    }

    // Submit actions should verify no errors
    if (action.type === "submit") {
      return { noErrors: true };
    }

    return undefined;
  }

  /**
   * Generate a human-readable description of the workflow.
   */
  private generateDescription(session: AnnotatedSession): string {
    const parts: string[] = [];
    parts.push(`Workflow recorded from ${session.startUrl}.`);

    if (session.variables.length > 0) {
      const paramNames = session.variables.map((v) => v.name).join(", ");
      parts.push(`Parameters: ${paramNames}.`);
    }

    parts.push(
      `${session.actions.length} steps in ${session.groups.length} groups.`
    );

    return parts.join(" ");
  }
}
