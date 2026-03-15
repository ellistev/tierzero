/**
 * Dashboard page view - shows ticket table.
 */
import type { Ticket } from "../data";
import type { LayoutConfig } from "../layouts";

export function renderDashboard(
  layout: LayoutConfig,
  tickets: Ticket[],
  user: string,
  query?: string
): string {
  const version = layout.containerClass === "main-content" ? "v2" : "v1";
  const qs = version === "v2" ? "?layout=v2" : "";

  const tableClass = version === "v2" ? "data-grid" : "";
  const badgeClass = version === "v2" ? "tag" : "badge";

  const headerRow = layout.tableColumns
    .map((col) => `<th>${col}</th>`)
    .join("");

  const bodyRows = tickets
    .map((t) => {
      const cells = layout.tableFields.map((field) => {
        if (field === "title") {
          return `<td><a href="/ticket/${t.id}${qs}" class="${version === "v2" ? "ticket-ref" : "ticket-link"}" aria-label="Open ticket ${t.id}">${t.title}</a></td>`;
        }
        if (field === "status") {
          return `<td><span class="${badgeClass} ${badgeClass}-${t.status}">${t.status.replace("_", " ")}</span></td>`;
        }
        if (field === "priority") {
          return `<td><span class="${badgeClass} ${badgeClass}-${t.priority}">${t.priority}</span></td>`;
        }
        if (field === "id") {
          return `<td><a href="/ticket/${t.id}${qs}" class="${version === "v2" ? "ticket-ref" : "ticket-link"}">${t.id}</a></td>`;
        }
        return `<td>${(t as Record<string, unknown>)[field] ?? ""}</td>`;
      });
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard - TicketApp</title>
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
    <div class="${layout.cardClass}">
      <h2>Tickets</h2>
      <table class="${tableClass}" aria-label="Tickets table">
        <thead><tr>${headerRow}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
  </div>
</body>
</html>`;
}
