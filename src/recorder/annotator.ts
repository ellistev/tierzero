/**
 * Action Annotator - Uses LLM to annotate raw recorded actions with semantic meaning.
 */

import type { LLMProvider } from "../intents/types";
import type {
  RecordedAction,
  AnnotatedAction,
  ActionGroup,
  AnnotatedSession,
  RecordedSession,
  WorkflowVariable,
} from "./types";

// ---------------------------------------------------------------------------
// Annotator
// ---------------------------------------------------------------------------

export class ActionAnnotator {
  private llm?: LLMProvider;

  constructor(llm?: LLMProvider) {
    this.llm = llm;
  }

  /**
   * Annotate a single action with a human-readable description.
   */
  annotateAction(action: RecordedAction, context?: string): AnnotatedAction {
    const description = this.describeAction(action, context);
    const isVariable = this.isLikelyVariable(action);
    const variableName = isVariable ? this.inferVariableName(action) : undefined;

    return {
      ...action,
      description,
      isVariable,
      variableName,
    };
  }

  /**
   * Group related actions into logical steps.
   */
  groupActions(actions: AnnotatedAction[]): ActionGroup[] {
    const groups: ActionGroup[] = [];
    let currentGroup: AnnotatedAction[] = [];
    let currentGroupName = "";
    let groupCounter = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      const prevAction = i > 0 ? actions[i - 1] : null;

      // Start a new group when:
      // 1. Page URL changes (navigation)
      // 2. Action type pattern breaks (e.g., going from types to clicks)
      // 3. Significant time gap between actions (>5 seconds)
      const shouldStartNewGroup =
        !prevAction ||
        action.type === "navigate" ||
        action.pageUrl !== prevAction.pageUrl ||
        action.timestamp - prevAction.timestamp > 5000 ||
        (action.type === "click" &&
          prevAction.type === "click" &&
          currentGroup.length > 0 &&
          currentGroup.some((a) => a.type === "type"));

      if (shouldStartNewGroup && currentGroup.length > 0) {
        groupCounter++;
        const groupId = `group-${groupCounter}`;
        const name = currentGroupName || this.nameGroup(currentGroup);
        for (const a of currentGroup) {
          a.groupId = groupId;
          a.groupName = name;
        }
        groups.push({ id: groupId, name, actions: [...currentGroup] });
        currentGroup = [];
        currentGroupName = "";
      }

      currentGroup.push(action);

      // Infer group name from actions
      if (!currentGroupName) {
        currentGroupName = this.inferGroupName(currentGroup);
      }
    }

    // Flush remaining group
    if (currentGroup.length > 0) {
      groupCounter++;
      const groupId = `group-${groupCounter}`;
      const name = currentGroupName || this.nameGroup(currentGroup);
      for (const a of currentGroup) {
        a.groupId = groupId;
        a.groupName = name;
      }
      groups.push({ id: groupId, name, actions: [...currentGroup] });
    }

    return groups;
  }

  /**
   * Identify which values in actions are parameters vs constants.
   */
  identifyVariables(actions: AnnotatedAction[]): WorkflowVariable[] {
    const variables: WorkflowVariable[] = [];
    const seen = new Set<string>();

    for (const action of actions) {
      if (!action.isVariable || !action.variableName) continue;
      if (seen.has(action.variableName)) continue;
      seen.add(action.variableName);

      variables.push({
        name: action.variableName,
        description: `Value for ${action.description}`,
        defaultValue: action.value,
        source: action.type === "type"
          ? "typed"
          : action.type === "select"
            ? "selected"
            : "url",
      });
    }

    return variables;
  }

  /**
   * Generate a descriptive workflow name from annotated actions.
   */
  nameWorkflow(actions: AnnotatedAction[]): string {
    if (actions.length === 0) return "Empty Workflow";

    // Find the primary action types
    const navigations = actions.filter((a) => a.type === "navigate");
    const types = actions.filter((a) => a.type === "type");
    const clicks = actions.filter((a) => a.type === "click");

    // Try to build a meaningful name from the actions
    const parts: string[] = [];

    // Use page title or URL for context
    const lastPage = actions[actions.length - 1];
    if (lastPage.pageTitle) {
      parts.push(this.extractPageContext(lastPage.pageTitle));
    }

    // Describe what was done
    if (types.length > 0 && clicks.some((c) => this.isSubmitLike(c))) {
      parts.unshift("Fill and submit");
    } else if (navigations.length > 1) {
      parts.unshift("Navigate through");
    } else if (clicks.length > 0) {
      parts.unshift("Interact with");
    }

    if (parts.length === 0) {
      return `Recorded workflow (${actions.length} steps)`;
    }

    return parts.join(" ");
  }

  /**
   * Annotate an entire session.
   */
  annotateSession(session: RecordedSession): AnnotatedSession {
    const annotatedActions = session.actions.map((a) => this.annotateAction(a));
    const groups = this.groupActions(annotatedActions);
    const variables = this.identifyVariables(annotatedActions);
    const workflowName = this.nameWorkflow(annotatedActions);

    return {
      ...session,
      actions: annotatedActions,
      groups,
      workflowName,
      variables,
    };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private describeAction(action: RecordedAction, _context?: string): string {
    const element = action.element;

    switch (action.type) {
      case "click": {
        const target = this.describeElement(element);
        return `Click ${target}`;
      }
      case "type": {
        const target = this.describeElement(element);
        const val = action.value
          ? `"${action.value.length > 30 ? action.value.slice(0, 30) + "..." : action.value}"`
          : "text";
        return `Type ${val} into ${target}`;
      }
      case "navigate":
        return `Navigate to ${action.url || action.pageUrl}`;
      case "select": {
        const target = this.describeElement(element);
        return `Select "${action.value}" in ${target}`;
      }
      case "check": {
        const target = this.describeElement(element);
        return `${action.value === "true" ? "Check" : "Uncheck"} ${target}`;
      }
      case "submit": {
        const target = this.describeElement(element);
        return `Submit ${target}`;
      }
      case "upload": {
        const target = this.describeElement(element);
        return `Upload "${action.value}" to ${target}`;
      }
      case "wait":
        return `Wait: ${action.value || "page load"}`;
      default:
        return `Perform ${action.type}`;
    }
  }

  private describeElement(element?: RecordedAction["element"]): string {
    if (!element) return "element";

    // Prefer aria label for accessibility-friendly description
    if (element.ariaLabel) {
      return `the "${element.ariaLabel}" ${element.ariaRole || element.tagName}`;
    }

    // Use visible text
    if (element.text) {
      const truncated =
        element.text.length > 40
          ? element.text.slice(0, 40) + "..."
          : element.text;
      return `the "${truncated}" ${element.ariaRole || element.tagName}`;
    }

    // Use role
    if (element.ariaRole) {
      return `the ${element.ariaRole}`;
    }

    // Fall back to tag
    return `the ${element.tagName} element`;
  }

  private isLikelyVariable(action: RecordedAction): boolean {
    if (!action.value) return false;

    // Typed text in form fields is often variable
    if (action.type === "type") {
      // Check if value looks like a dynamic identifier
      if (this.looksLikeId(action.value)) return true;
      // Long text input is usually variable
      if (action.value.length > 5) return true;
    }

    // Selected dropdown values might be variable
    if (action.type === "select") return true;

    // URLs with query params are often variable
    if (action.type === "navigate" && action.url?.includes("?")) return true;

    return false;
  }

  private looksLikeId(value: string): boolean {
    // Correlation IDs, ticket numbers, UUIDs, etc.
    return (
      /^[A-Z]+-\d+$/i.test(value) || // JIRA-like IDs
      /^[0-9a-f]{8}-/i.test(value) || // UUIDs
      /^INC\d+$/i.test(value) || // ServiceNow incidents
      /^\d{5,}$/.test(value) // Long numeric IDs
    );
  }

  private inferVariableName(action: RecordedAction): string {
    const element = action.element;

    // Try to use the field name/label
    if (element?.ariaLabel) {
      return this.toCamelCase(element.ariaLabel);
    }
    if (element?.attributes?.["name"]) {
      return this.toCamelCase(element.attributes["name"]);
    }
    if (element?.attributes?.["id"]) {
      return this.toCamelCase(element.attributes["id"]);
    }

    // Infer from the action type
    if (action.type === "type") return "inputValue";
    if (action.type === "select") return "selectedOption";
    if (action.type === "navigate") return "targetUrl";

    return "param";
  }

  private toCamelCase(str: string): string {
    return str
      .replace(/[^a-zA-Z0-9]+(.)/g, (_, c) => c.toUpperCase())
      .replace(/^[A-Z]/, (c) => c.toLowerCase())
      .replace(/[^a-zA-Z0-9]/g, "");
  }

  private inferGroupName(actions: AnnotatedAction[]): string {
    const types = new Set(actions.map((a) => a.type));

    if (types.has("type") && types.has("click")) {
      return "Fill form fields";
    }
    if (types.has("navigate")) {
      return "Navigate";
    }
    if (types.size === 1 && types.has("click")) {
      return "Click actions";
    }

    return "";
  }

  private nameGroup(actions: AnnotatedAction[]): string {
    if (actions.length === 0) return "Empty group";
    if (actions.length === 1) return actions[0].description;

    const types = new Set(actions.map((a) => a.type));
    if (types.has("type")) return "Fill form fields";
    if (types.has("navigate")) return "Navigation";
    return `${actions.length} actions`;
  }

  private isSubmitLike(action: AnnotatedAction): boolean {
    if (action.type === "submit") return true;
    const text = (action.element?.text || "").toLowerCase();
    return (
      text.includes("submit") ||
      text.includes("search") ||
      text.includes("save") ||
      text.includes("send") ||
      text.includes("ok") ||
      text.includes("apply")
    );
  }

  private extractPageContext(title: string): string {
    // Remove common suffixes
    return title
      .replace(/\s*[-|–]\s*.*$/, "")
      .trim()
      .slice(0, 50);
  }
}
