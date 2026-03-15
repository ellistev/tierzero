/**
 * Login page view.
 */
import type { LayoutConfig } from "../layouts";

export function renderLogin(layout: LayoutConfig, error?: string, version?: "v1" | "v2"): string {
  const errorHtml = error
    ? `<div role="alert" class="error" style="color:red;margin-bottom:12px;">${error}</div>`
    : "";
  const qs = version === "v2" ? "?layout=v2" : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Login - TicketApp</title>
  <style>${layout.css}</style>
</head>
<body>
  <div class="${layout.headerClass}">
    <h1>TicketApp</h1>
  </div>
  <div class="${layout.containerClass}">
    <div class="${layout.cardClass}" style="max-width:400px;margin:60px auto;">
      <h2>Sign In</h2>
      ${errorHtml}
      <form method="POST" action="/login${qs}" aria-label="Login form">
        <div class="${layout.actionsClass === "button-bar" ? "field-group" : "form-group"}">
          <label for="username">Username</label>
          <input type="text" id="username" name="username" required aria-label="Username" placeholder="Enter username">
        </div>
        <div class="${layout.actionsClass === "button-bar" ? "field-group" : "form-group"}">
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required aria-label="Password" placeholder="Enter password">
        </div>
        <div style="margin-top:20px;">
          <button type="submit" class="${layout.actionsClass === "button-bar" ? "action-btn action-btn-primary" : "btn btn-primary"}" aria-label="Sign in" style="width:100%;">
            ${layout.loginButton}
          </button>
        </div>
      </form>
    </div>
  </div>
</body>
</html>`;
}
