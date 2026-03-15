/**
 * Search page view.
 */
import type { Ticket } from "../data";
import type { LayoutConfig } from "../layouts";

export function renderSearch(
  layout: LayoutConfig,
  user: string,
  query?: string,
  results?: Ticket[]
): string {
  const version = layout.containerClass === "main-content" ? "v2" : "v1";
  const qs = version === "v2" ? "?layout=v2" : "";
  const badgeClass = version === "v2" ? "tag" : "badge";
  const tableClass = version === "v2" ? "data-grid" : "";
  const searchAreaClass = version === "v2" ? "search-area" : "search-box";
  const fieldGroupClass = version === "v2" ? "field-group" : "form-group";
  const btnClass = version === "v2" ? "action-btn action-btn-primary" : "btn btn-primary";

  let resultsHtml = "";
  if (query !== undefined) {
    if (results && results.length > 0) {
      const rows = results
        .map(
          (t) => `
        <tr>
          <td><a href="/ticket/${t.id}${qs}" class="${version === "v2" ? "ticket-ref" : "ticket-link"}" aria-label="Open ticket ${t.id}">${t.id}</a></td>
          <td>${t.title}</td>
          <td><span class="${badgeClass} ${badgeClass}-${t.status}">${t.status.replace("_", " ")}</span></td>
          <td><span class="${badgeClass} ${badgeClass}-${t.priority}">${t.priority}</span></td>
        </tr>`
        )
        .join("");

      resultsHtml = `
      <div class="${layout.cardClass}" style="margin-top:16px;">
        <h3>Results for "${query}"</h3>
        <table class="${tableClass}" aria-label="Search results">
          <thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Priority</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    } else {
      resultsHtml = `
      <div class="${layout.cardClass}" style="margin-top:16px;">
        <p>No results found for "${query}".</p>
      </div>`;
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Search - TicketApp</title>
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
      <h2>Search Tickets</h2>
      <form method="GET" action="/search" aria-label="Search tickets">
        ${version === "v2" ? '<input type="hidden" name="layout" value="v2">' : ""}
        <div class="${searchAreaClass}">
          <input type="search" name="q" value="${query || ""}" placeholder="Search by ID, title, or description..." aria-label="Search query" id="searchQuery">
          <button type="submit" class="${btnClass}" aria-label="Search tickets">${layout.searchButton}</button>
        </div>
      </form>
    </div>
    ${resultsHtml}
  </div>
</body>
</html>`;
}
