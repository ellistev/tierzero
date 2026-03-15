/**
 * Enhanced Page Understanding module.
 * Captures structured page state for LLM context.
 */

import type { Page } from "playwright";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FormField {
  name: string;
  type: string;
  value: string;
  label: string;
  required: boolean;
}

export interface PageLink {
  text: string;
  href: string;
}

export interface PageButton {
  text: string;
  disabled: boolean;
}

export interface PageState {
  url: string;
  title: string;
  visibleText: string;
  forms: FormField[];
  buttons: PageButton[];
  links: PageLink[];
  modals: string[];
  errorMessages: string[];
  headings: string[];
  timestamp: string;
}

export type PageType =
  | "login"
  | "form"
  | "list"
  | "detail"
  | "dashboard"
  | "error"
  | "search"
  | "settings"
  | "unknown";

export interface PageStateDiff {
  urlChanged: boolean;
  titleChanged: boolean;
  newErrors: string[];
  resolvedErrors: string[];
  newModals: string[];
  dismissedModals: string[];
  newButtons: string[];
  removedButtons: string[];
  formChanges: Array<{ field: string; from: string; to: string }>;
}

// ---------------------------------------------------------------------------
// Core functions
// ---------------------------------------------------------------------------

/**
 * Capture a structured snapshot of the current page state.
 */
export async function capturePageState(page: Page): Promise<PageState> {
  const [url, title, extracted] = await Promise.all([
    page.url(),
    page.title(),
    page.evaluate(() => {
      // Visible text (truncated)
      const body = document.body;
      const visibleText = body?.innerText?.slice(0, 5000) ?? "";

      // Forms
      const forms: Array<{
        name: string;
        type: string;
        value: string;
        label: string;
        required: boolean;
      }> = [];
      for (const input of document.querySelectorAll(
        "input, select, textarea"
      )) {
        const el = input as HTMLInputElement;
        const id = el.id || el.name || "";
        const labelEl = id
          ? document.querySelector(`label[for="${id}"]`)
          : null;
        forms.push({
          name: el.name || el.id || "",
          type: el.type || el.tagName.toLowerCase(),
          value: el.value || "",
          label: labelEl?.textContent?.trim() ?? el.getAttribute("aria-label") ?? el.placeholder ?? "",
          required: el.required || el.getAttribute("aria-required") === "true",
        });
      }

      // Buttons
      const buttons: Array<{ text: string; disabled: boolean }> = [];
      for (const btn of document.querySelectorAll(
        "button, [role='button'], input[type='submit']"
      )) {
        const el = btn as HTMLButtonElement;
        buttons.push({
          text: el.textContent?.trim() ?? el.getAttribute("aria-label") ?? "",
          disabled: el.disabled || el.getAttribute("aria-disabled") === "true",
        });
      }

      // Links
      const links: Array<{ text: string; href: string }> = [];
      for (const a of document.querySelectorAll("a[href]")) {
        const el = a as HTMLAnchorElement;
        const text = el.textContent?.trim() ?? "";
        if (text) {
          links.push({ text, href: el.href });
        }
      }

      // Modals
      const modals: string[] = [];
      for (const modal of document.querySelectorAll(
        "[role='dialog'], [role='alertdialog'], .modal, .MuiDialog-root"
      )) {
        const text = (modal as HTMLElement).textContent?.trim().slice(0, 200) ?? "";
        if (text) modals.push(text);
      }

      // Error messages
      const errorMessages: string[] = [];
      const errorSelectors = [
        "[role='alert']",
        ".error",
        ".alert-danger",
        ".alert-error",
        ".toast-error",
        ".notification-error",
        ".MuiAlert-standardError",
      ];
      for (const sel of errorSelectors) {
        for (const el of document.querySelectorAll(sel)) {
          const text = (el as HTMLElement).textContent?.trim() ?? "";
          if (text && !errorMessages.includes(text)) {
            errorMessages.push(text.slice(0, 300));
          }
        }
      }

      // Headings
      const headings: string[] = [];
      for (const h of document.querySelectorAll("h1, h2, h3")) {
        const text = (h as HTMLElement).textContent?.trim() ?? "";
        if (text) headings.push(text);
      }

      return { visibleText, forms, buttons, links, modals, errorMessages, headings };
    }),
  ]);

  return {
    url,
    title,
    visibleText: extracted.visibleText,
    forms: extracted.forms,
    buttons: extracted.buttons,
    links: extracted.links,
    modals: extracted.modals,
    errorMessages: extracted.errorMessages,
    headings: extracted.headings,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Generate a human-readable description of the page state for LLM context.
 */
export function describePageState(state: PageState): string {
  const parts: string[] = [];

  parts.push(`Page: ${state.title} (${state.url})`);

  if (state.headings.length > 0) {
    parts.push(`Headings: ${state.headings.join(" > ")}`);
  }

  if (state.errorMessages.length > 0) {
    parts.push(`Errors: ${state.errorMessages.join("; ")}`);
  }

  if (state.modals.length > 0) {
    parts.push(`Active modals: ${state.modals.length}`);
  }

  if (state.forms.length > 0) {
    const filled = state.forms.filter((f) => f.value).length;
    const required = state.forms.filter((f) => f.required).length;
    parts.push(
      `Form fields: ${state.forms.length} total, ${filled} filled, ${required} required`
    );
    for (const field of state.forms) {
      const status = field.value ? `= "${field.value}"` : "(empty)";
      const req = field.required ? " *required*" : "";
      parts.push(`  - ${field.label || field.name} [${field.type}] ${status}${req}`);
    }
  }

  if (state.buttons.length > 0) {
    parts.push(
      `Buttons: ${state.buttons.map((b) => `${b.text}${b.disabled ? " (disabled)" : ""}`).join(", ")}`
    );
  }

  if (state.links.length > 0) {
    parts.push(`Links: ${state.links.length} visible`);
  }

  return parts.join("\n");
}

/**
 * Classify the page type based on its state.
 */
export function detectPageType(state: PageState): PageType {
  const url = state.url.toLowerCase();
  const title = state.title.toLowerCase();
  const text = state.visibleText.toLowerCase();

  // Error pages
  if (
    state.errorMessages.length > 0 &&
    state.forms.length === 0 &&
    (text.includes("500") ||
      text.includes("error") ||
      text.includes("not found") ||
      text.includes("404"))
  ) {
    return "error";
  }

  // Login pages
  if (
    url.includes("login") ||
    url.includes("signin") ||
    url.includes("auth") ||
    title.includes("login") ||
    title.includes("sign in")
  ) {
    return "login";
  }

  // Also detect login by form shape
  const hasPasswordField = state.forms.some((f) => f.type === "password");
  const hasUsernameField = state.forms.some(
    (f) =>
      f.name.includes("user") ||
      f.name.includes("email") ||
      f.type === "email"
  );
  if (hasPasswordField && hasUsernameField && state.forms.length <= 4) {
    return "login";
  }

  // Search pages
  if (
    url.includes("search") ||
    title.includes("search") ||
    state.forms.some((f) => f.type === "search")
  ) {
    return "search";
  }

  // Settings pages
  if (
    url.includes("settings") ||
    url.includes("preferences") ||
    title.includes("settings")
  ) {
    return "settings";
  }

  // Dashboard
  if (url.includes("dashboard") || title.includes("dashboard")) {
    return "dashboard";
  }

  // Form pages (many inputs)
  if (state.forms.length >= 3) {
    return "form";
  }

  // List pages (many links, few forms)
  if (state.links.length > 10 && state.forms.length <= 2) {
    return "list";
  }

  // Detail pages (few links, some headings, text-heavy)
  if (state.headings.length >= 2 && state.visibleText.length > 1000) {
    return "detail";
  }

  return "unknown";
}

/**
 * Compute differences between two page states.
 */
export function diffPageState(
  before: PageState,
  after: PageState
): PageStateDiff {
  const newErrors = after.errorMessages.filter(
    (e) => !before.errorMessages.includes(e)
  );
  const resolvedErrors = before.errorMessages.filter(
    (e) => !after.errorMessages.includes(e)
  );
  const newModals = after.modals.filter((m) => !before.modals.includes(m));
  const dismissedModals = before.modals.filter(
    (m) => !after.modals.includes(m)
  );
  const newButtons = after.buttons
    .map((b) => b.text)
    .filter((t) => !before.buttons.some((b) => b.text === t));
  const removedButtons = before.buttons
    .map((b) => b.text)
    .filter((t) => !after.buttons.some((b) => b.text === t));

  const formChanges: Array<{ field: string; from: string; to: string }> = [];
  for (const afterField of after.forms) {
    const beforeField = before.forms.find(
      (f) => f.name === afterField.name || f.label === afterField.label
    );
    if (beforeField && beforeField.value !== afterField.value) {
      formChanges.push({
        field: afterField.label || afterField.name,
        from: beforeField.value,
        to: afterField.value,
      });
    }
  }

  return {
    urlChanged: before.url !== after.url,
    titleChanged: before.title !== after.title,
    newErrors,
    resolvedErrors,
    newModals,
    dismissedModals,
    newButtons,
    removedButtons,
    formChanges,
  };
}
