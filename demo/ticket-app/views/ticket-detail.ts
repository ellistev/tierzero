/**
 * Ticket detail page view.
 */
import type { Ticket } from "../data";
import type { LayoutConfig } from "../layouts";
import { ASSIGNEES } from "../data";

export function renderTicketDetail(
  layout: LayoutConfig,
  ticket: Ticket,
  user: string,
  message?: string
): string {
  const version = layout.containerClass === "main-content" ? "v2" : "v1";
  const qs = version === "v2" ? "?layout=v2" : "";
  const badgeClass = version === "v2" ? "tag" : "badge";
  const fieldGroupClass = version === "v2" ? "field-group" : "form-group";
  const btnClass = version === "v2" ? "action-btn" : "btn";
  const commentClass = version === "v2" ? "note" : "comment";
  const authorClass = version === "v2" ? "note-author" : "comment-author";
  const dateClass = version === "v2" ? "note-date" : "comment-date";

  const commentsHtml = ticket.comments
    .map(
      (c) => `
    <div class="${commentClass}">
      <span class="${authorClass}">${c.author}</span>
      <span class="${dateClass}"> - ${c.date}</span>
      <p>${c.text}</p>
    </div>`
    )
    .join("");

  const assigneeOptions = ASSIGNEES.map(
    (a) =>
      `<option value="${a}" ${a === ticket.assignee ? "selected" : ""}>${a}</option>`
  ).join("");

  const messageHtml = message
    ? `<div role="status" style="background:#d4edda;padding:10px;border-radius:4px;margin-bottom:16px;">${message}</div>`
    : "";

  // In v2, the confirm modal is shown before resolve
  const confirmModalHtml = layout.confirmModal
    ? `
    <div class="confirm-overlay" id="confirmModal" role="dialog" aria-label="Confirm action">
      <div class="confirm-dialog">
        <h3>Are you sure?</h3>
        <p>This will resolve ticket ${ticket.id}. This action cannot be undone.</p>
        <div style="display:flex;gap:10px;justify-content:flex-end;">
          <button class="${btnClass} action-btn-danger" onclick="document.getElementById('confirmModal').classList.remove('active')" aria-label="Cancel">${layout.cancelButton}</button>
          <button class="${btnClass} action-btn-success" onclick="document.getElementById('resolveForm').submit()" aria-label="Confirm resolve">${layout.confirmButton}</button>
        </div>
      </div>
    </div>`
    : "";

  const resolveAction = layout.confirmModal
    ? `onclick="event.preventDefault();document.getElementById('confirmModal').classList.add('active')"`
    : "";

  // v2 puts action buttons at the TOP; v1 at the bottom-right
  const actionButtons = `
    <form id="resolveForm" method="POST" action="/ticket/${ticket.id}/resolve${qs}" style="display:inline;">
      <button type="${layout.confirmModal ? "button" : "submit"}" ${resolveAction}
        class="${btnClass} ${version === "v2" ? "action-btn-success" : "btn-success"}"
        aria-label="Resolve ticket"
        ${ticket.status === "resolved" ? "disabled" : ""}>
        ${layout.resolveButton}
      </button>
    </form>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${ticket.id} - ${ticket.title} - TicketApp</title>
  <style>${layout.css}</style>
</head>
<body>
  <div class="${layout.headerClass}">
    <h1>TicketApp</h1>
    <div class="${version === "v2" ? "toolbar" : "nav"}">
      <a href="/dashboard${qs}" aria-label="Dashboard">Dashboard</a>
      <a href="/search${qs}" aria-label="Search">Search</a>
      <span style="color:#ccc;">Logged in as ${user}</span>
    </div>
  </div>
  <div class="${layout.containerClass}">
    ${messageHtml}
    ${version === "v2" ? `<div class="button-bar">${actionButtons}</div>` : ""}
    <div class="${layout.cardClass}">
      <h2>${ticket.id}: ${ticket.title}</h2>
      <div style="display:flex;gap:12px;margin-bottom:16px;">
        <span class="${badgeClass} ${badgeClass}-${ticket.status}">${ticket.status.replace("_", " ")}</span>
        <span class="${badgeClass} ${badgeClass}-${ticket.priority}">${ticket.priority}</span>
        <span>Assignee: <strong>${ticket.assignee}</strong></span>
      </div>
      <p>${ticket.description}</p>
      ${version === "v1" ? `<div class="${layout.actionsClass}">${actionButtons}</div>` : ""}
    </div>

    <div class="${layout.cardClass}">
      <h3>Assign Ticket</h3>
      <form method="POST" action="/ticket/${ticket.id}/assign${qs}" aria-label="Assign ticket">
        <div class="${fieldGroupClass}">
          <label for="assignee">Assign To</label>
          <select id="assignee" name="assignee" aria-label="Assign to">${assigneeOptions}</select>
        </div>
        <div class="${version === "v2" ? "button-bar" : layout.actionsClass}">
          <button type="submit" class="${btnClass} ${version === "v2" ? "action-btn-primary" : "btn-primary"}" aria-label="Save assignment">
            ${layout.saveButton}
          </button>
        </div>
      </form>
    </div>

    <div class="${layout.cardClass}">
      <h3>Comments</h3>
      ${commentsHtml || "<p>No comments yet.</p>"}
      <form method="POST" action="/ticket/${ticket.id}/comment${qs}" aria-label="Comment form" style="margin-top:16px;">
        <div class="${fieldGroupClass}">
          <label for="comment">Add Comment</label>
          <textarea id="comment" name="comment" required aria-label="Comment text" placeholder="Write your comment here..."></textarea>
        </div>
        <div class="${version === "v2" ? "button-bar" : layout.actionsClass}">
          <button type="submit" class="${btnClass} ${version === "v2" ? "action-btn-primary" : "btn-primary"}" aria-label="Add comment">
            ${layout.addCommentButton}
          </button>
        </div>
      </form>
    </div>
  </div>
  ${confirmModalHtml}
</body>
</html>`;
}
