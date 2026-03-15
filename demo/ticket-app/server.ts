/**
 * Express server for the demo ticket app.
 * Supports two layout variants via ?layout=v2 query param.
 */

import express from "express";
import { getTickets, USERS } from "./data";
import type { Ticket } from "./data";
import { getLayout } from "./layouts";
import { renderLogin } from "./views/login";
import { renderDashboard } from "./views/dashboard";
import { renderTicketDetail } from "./views/ticket-detail";
import { renderSearch } from "./views/search";

export function createTicketApp(port?: number): {
  start: () => Promise<{ port: number; stop: () => Promise<void> }>;
} {
  const app = express();
  app.use(express.urlencoded({ extended: true }));

  // In-memory state
  const tickets = getTickets();
  const sessions = new Map<string, string>(); // cookie -> username

  // Helper to get layout version from query
  function getLayoutVersion(req: express.Request): "v1" | "v2" {
    return req.query.layout === "v2" ? "v2" : "v1";
  }

  function getQs(req: express.Request): string {
    return getLayoutVersion(req) === "v2" ? "?layout=v2" : "";
  }

  // Simple session via query param (no real cookies needed for testing)
  function getUser(_req: express.Request): string | null {
    return sessions.get("default") || null;
  }

  function requireAuth(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): void {
    const user = getUser(req);
    if (!user) {
      res.redirect(`/login${getQs(req)}`);
      return;
    }
    next();
  }

  // ----- Routes -----

  // Login page
  app.get("/login", (req, res) => {
    const version = getLayoutVersion(req);
    const layout = getLayout(version);
    res.send(renderLogin(layout, undefined, version));
  });

  app.get("/", (req, res) => {
    res.redirect(`/login${getQs(req)}`);
  });

  // Login POST
  app.post("/login", (req, res) => {
    const { username, password } = req.body;
    const qs = getQs(req);
    const layout = getLayout(getLayoutVersion(req));

    const user = USERS.find(
      (u) => u.username === username && u.password === password
    );
    if (!user) {
      res.send(renderLogin(layout, "Invalid credentials", getLayoutVersion(req)));
      return;
    }

    // Store session
    sessions.set("default", user.name);
    res.redirect(`/dashboard${qs}`);
  });

  // Dashboard
  app.get("/dashboard", requireAuth, (req, res) => {
    const layout = getLayout(getLayoutVersion(req));
    const user = getUser(req)!;
    res.send(renderDashboard(layout, tickets, user));
  });

  // Search
  app.get("/search", requireAuth, (req, res) => {
    const layout = getLayout(getLayoutVersion(req));
    const user = getUser(req)!;
    const q = (req.query.q as string) || undefined;

    let results: Ticket[] | undefined;
    if (q) {
      const query = q.toLowerCase();
      results = tickets.filter(
        (t) =>
          t.id.toLowerCase().includes(query) ||
          t.title.toLowerCase().includes(query) ||
          t.description.toLowerCase().includes(query)
      );
    }

    res.send(renderSearch(layout, user, q, results));
  });

  // Ticket detail
  app.get("/ticket/:id", requireAuth, (req, res) => {
    const layout = getLayout(getLayoutVersion(req));
    const user = getUser(req)!;
    const ticket = tickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    const message = (req.query.msg as string) || undefined;
    res.send(renderTicketDetail(layout, ticket, user, message));
  });

  // Add comment
  app.post("/ticket/:id/comment", requireAuth, (req, res) => {
    const qs = getQs(req);
    const ticket = tickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    const user = getUser(req)!;
    const comment = req.body.comment;
    if (comment) {
      ticket.comments.push({
        author: user,
        text: comment,
        date: new Date().toISOString().slice(0, 10),
      });
    }
    res.redirect(
      `/ticket/${ticket.id}${qs}${qs ? "&" : "?"}msg=Comment+added`
    );
  });

  // Resolve ticket
  app.post("/ticket/:id/resolve", requireAuth, (req, res) => {
    const qs = getQs(req);
    const ticket = tickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    ticket.status = "resolved";
    res.redirect(
      `/ticket/${ticket.id}${qs}${qs ? "&" : "?"}msg=Ticket+resolved`
    );
  });

  // Assign ticket
  app.post("/ticket/:id/assign", requireAuth, (req, res) => {
    const qs = getQs(req);
    const ticket = tickets.find((t) => t.id === req.params.id);
    if (!ticket) {
      res.status(404).send("Ticket not found");
      return;
    }
    const assignee = req.body.assignee;
    if (assignee) {
      ticket.assignee = assignee;
    }
    res.redirect(
      `/ticket/${ticket.id}${qs}${qs ? "&" : "?"}msg=Assignment+updated`
    );
  });

  // Error simulation endpoint
  app.get("/error", (_req, res) => {
    res.status(500).send(`<!DOCTYPE html>
<html><head><title>500 Internal Server Error</title></head>
<body style="text-align:center;padding:60px;">
  <h1 style="font-size:48px;color:#e74c3c;">500</h1>
  <p role="alert" class="error">Internal Server Error - Something went wrong</p>
</body></html>`);
  });

  return {
    start: () =>
      new Promise((resolve) => {
        const server = app.listen(port || 0, () => {
          const addr = server.address();
          const actualPort =
            typeof addr === "object" && addr ? addr.port : port || 3000;
          resolve({
            port: actualPort,
            stop: () =>
              new Promise<void>((res) => {
                server.close(() => res());
              }),
          });
        });
      }),
  };
}

// Allow running directly
if (process.argv[1]?.includes("server")) {
  const port = parseInt(process.argv[2] || "3456", 10);
  createTicketApp(port)
    .start()
    .then(({ port: p }) => {
      console.log(`TicketApp running on http://localhost:${p}`);
      console.log(`  v1: http://localhost:${p}/login`);
      console.log(`  v2: http://localhost:${p}/login?layout=v2`);
    });
}
