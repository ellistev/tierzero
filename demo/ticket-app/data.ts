/**
 * Test ticket data for the demo ticket app.
 */

export interface Ticket {
  id: string;
  title: string;
  status: "open" | "in_progress" | "resolved" | "closed";
  priority: "critical" | "high" | "medium" | "low";
  assignee: string;
  description: string;
  comments: Array<{ author: string; text: string; date: string }>;
  createdAt: string;
}

export const USERS = [
  { username: "admin", password: "admin123", name: "Admin User" },
  { username: "john", password: "john123", name: "John Smith" },
  { username: "jane", password: "jane123", name: "Jane Doe" },
];

export const ASSIGNEES = ["Unassigned", "John Smith", "Jane Doe", "Bob Wilson", "Alice Chen"];

export function getTickets(): Ticket[] {
  return [
    {
      id: "TKT-001",
      title: "Login page shows blank screen on Firefox",
      status: "open",
      priority: "high",
      assignee: "Unassigned",
      description: "Users on Firefox 120+ see a blank white screen when trying to log in.",
      comments: [],
      createdAt: "2026-03-10",
    },
    {
      id: "TKT-002",
      title: "Dashboard loading time exceeds 10s",
      status: "in_progress",
      priority: "critical",
      assignee: "Jane Doe",
      description: "The main dashboard takes over 10 seconds to load for users with 100+ tickets.",
      comments: [{ author: "Jane Doe", text: "Investigating database query performance.", date: "2026-03-12" }],
      createdAt: "2026-03-09",
    },
    {
      id: "TKT-003",
      title: "Email notifications not sending",
      status: "open",
      priority: "high",
      assignee: "Unassigned",
      description: "Email notifications for ticket updates have stopped sending since the last deployment.",
      comments: [],
      createdAt: "2026-03-11",
    },
    {
      id: "TKT-004",
      title: "Update user profile page styling",
      status: "open",
      priority: "low",
      assignee: "Bob Wilson",
      description: "The user profile page needs updated CSS to match the new brand guidelines.",
      comments: [],
      createdAt: "2026-03-08",
    },
    {
      id: "TKT-005",
      title: "API rate limiting not working",
      status: "in_progress",
      priority: "critical",
      assignee: "Alice Chen",
      description: "Rate limiting on the public API endpoints is not enforcing the configured limits.",
      comments: [{ author: "Alice Chen", text: "Found the middleware configuration issue.", date: "2026-03-13" }],
      createdAt: "2026-03-07",
    },
    {
      id: "TKT-006",
      title: "Search results pagination broken",
      status: "open",
      priority: "medium",
      assignee: "Unassigned",
      description: "Clicking 'Next' on search results always shows the first page.",
      comments: [],
      createdAt: "2026-03-10",
    },
    {
      id: "TKT-007",
      title: "Memory leak in background worker",
      status: "open",
      priority: "critical",
      assignee: "Unassigned",
      description: "The background job worker process grows to 2GB+ memory after 24 hours of operation.",
      comments: [],
      createdAt: "2026-03-12",
    },
    {
      id: "TKT-008",
      title: "Add dark mode support",
      status: "open",
      priority: "low",
      assignee: "Bob Wilson",
      description: "Users have requested dark mode support for the web application.",
      comments: [],
      createdAt: "2026-03-06",
    },
    {
      id: "TKT-009",
      title: "SSL certificate expiring soon",
      status: "open",
      priority: "high",
      assignee: "John Smith",
      description: "The production SSL certificate expires in 7 days and needs to be renewed.",
      comments: [{ author: "John Smith", text: "Renewal request submitted to IT.", date: "2026-03-14" }],
      createdAt: "2026-03-13",
    },
    {
      id: "TKT-010",
      title: "Database backup job failing",
      status: "in_progress",
      priority: "high",
      assignee: "Jane Doe",
      description: "The nightly database backup job has been failing for the past 3 days.",
      comments: [{ author: "Jane Doe", text: "Disk space issue identified on backup server.", date: "2026-03-14" }],
      createdAt: "2026-03-11",
    },
  ];
}
