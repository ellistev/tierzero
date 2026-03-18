import type {
  Ticket,
  TicketComment,
  TicketAttachment,
  TicketStatus,
  TicketPriority,
  TicketType,
  TicketUser,
  UpdateTicketFields,
} from "./types";
import type {
  TicketConnector,
  ListTicketsOptions,
  ListTicketsResult,
  AddCommentOptions,
  HealthCheckResult,
} from "./connector";

export interface ServiceNowConfig {
  /** e.g. https://myinstance.service-now.com */
  instanceUrl: string;
  username: string;
  password: string;
  /** Table to query. Defaults to "incident". */
  table?: string;
}

// --- Raw ServiceNow shapes (sysparm_display_value=all) ---

type SNRef = { value: string; display_value: string };
type SNVal = { value: string; display_value: string };

interface SNIncident {
  sys_id: SNVal;
  number: SNVal;
  short_description: SNVal;
  description: SNVal;
  state: SNVal;
  priority: SNVal;
  caller_id: SNRef;
  assigned_to: SNRef;
  assignment_group: SNRef;
  sys_created_on: SNVal;
  sys_updated_on: SNVal;
  resolved_at: SNVal;
  due_date: SNVal;
  sys_class_name: SNVal;
  [key: string]: unknown;
}

interface SNJournalEntry {
  sys_id: string;
  element: string; // "comments" (public) | "work_notes" (internal)
  value: string;
  sys_created_by: string;
  sys_created_on: string;
}

interface SNAttachment {
  sys_id: string;
  file_name: string;
  download_link: string;
  size_bytes: string;
  content_type: string;
}

// --- Field mapping tables ---

const KNOWN_FIELDS = new Set([
  "sys_id", "number", "short_description", "description",
  "state", "priority", "caller_id", "assigned_to", "assignment_group",
  "sys_created_on", "sys_updated_on", "resolved_at", "due_date", "sys_class_name",
]);

const STATE_MAP: Record<string, TicketStatus> = {
  "1": "open",       // New
  "2": "in_progress",
  "3": "pending",    // On Hold
  "6": "resolved",
  "7": "closed",
};

// Reverse map for building sysparm_query filters
const STATUS_TO_STATE: Record<TicketStatus, string> = Object.fromEntries(
  Object.entries(STATE_MAP).map(([k, v]) => [v, k])
) as Record<TicketStatus, string>;

const PRIORITY_MAP: Record<string, TicketPriority> = {
  "1": "critical",
  "2": "high",
  "3": "medium",
  "4": "low",
  "5": "low", // Planning
};

const PRIORITY_TO_CODE: Record<TicketPriority, string> = {
  critical: "1",
  high: "2",
  medium: "3",
  low: "4",
};

const CLASS_TYPE_MAP: Record<string, TicketType> = {
  incident: "incident",
  sc_request: "request",
  sc_req_item: "request",
  problem: "problem",
  change_request: "change",
  change_task: "task",
  sc_task: "task",
};

// --- Normalisation helpers ---

function snRef(ref: SNRef | undefined): TicketUser | undefined {
  if (!ref?.value) return undefined;
  return { id: ref.value, name: ref.display_value };
}

function snDate(val: SNVal | undefined): Date | undefined {
  if (!val?.value) return undefined;
  return new Date(val.value.replace(" ", "T") + "Z");
}

function toTicket(inc: SNIncident, instanceUrl: string, table: string): Ticket {
  const sysId = inc.sys_id.value;

  const customFields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(inc)) {
    if (!KNOWN_FIELDS.has(k)) customFields[k] = v;
  }

  return {
    id: sysId,
    externalId: inc.number?.value,
    source: "servicenow",
    url: `${instanceUrl}/nav_to.do?uri=${table}.do?sys_id=${sysId}`,
    title: inc.short_description?.value ?? "",
    description: inc.description?.value ?? "",
    type: CLASS_TYPE_MAP[inc.sys_class_name?.value ?? ""] ?? "incident",
    status: STATE_MAP[inc.state?.value] ?? "open",
    priority: PRIORITY_MAP[inc.priority?.value] ?? "medium",
    reporter: snRef(inc.caller_id) ?? { id: "", name: "Unknown" },
    assignee: snRef(inc.assigned_to),
    queue: inc.assignment_group?.display_value || undefined,
    createdAt: snDate(inc.sys_created_on) ?? new Date(0),
    updatedAt: snDate(inc.sys_updated_on) ?? new Date(0),
    resolvedAt: snDate(inc.resolved_at),
    dueAt: snDate(inc.due_date),
    customFields,
  };
}

function toComment(entry: SNJournalEntry): TicketComment {
  return {
    id: entry.sys_id,
    // sys_journal_field stores username strings, not sys_ids
    author: { id: entry.sys_created_by, name: entry.sys_created_by },
    body: entry.value,
    isInternal: entry.element === "work_notes",
    createdAt: new Date(entry.sys_created_on.replace(" ", "T") + "Z"),
  };
}

function toAttachment(att: SNAttachment): TicketAttachment {
  return {
    id: att.sys_id,
    filename: att.file_name,
    url: att.download_link,
    size: parseInt(att.size_bytes, 10) || undefined,
    mimeType: att.content_type,
  };
}

// ---------------------------------------------------------------------------
// Update patch builder
// ---------------------------------------------------------------------------

/**
 * Converts generic UpdateTicketFields into a ServiceNow-native PATCH body.
 * Pure function — no network I/O, exported for unit testing via _testExports.
 */
export function buildUpdatePatch(fields: UpdateTicketFields): Record<string, string> {
  const patch: Record<string, string> = {};

  if (fields.status !== undefined) {
    const code = STATUS_TO_STATE[fields.status];
    if (!code) throw new Error(`Unmapped status: "${fields.status}"`);
    patch.state = code;
  }

  if (fields.assigneeId !== undefined) patch.assigned_to = fields.assigneeId;
  if (fields.assigneeGroupId !== undefined) patch.assignment_group = fields.assigneeGroupId;

  if (fields.priority !== undefined) {
    patch.priority = PRIORITY_TO_CODE[fields.priority];
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Test exports (internal helpers exposed for unit testing only)
// ---------------------------------------------------------------------------

/* istanbul ignore next */
export const _testExports = {
  STATE_MAP,
  STATUS_TO_STATE,
  PRIORITY_MAP,
  PRIORITY_TO_CODE,
  CLASS_TYPE_MAP,
  snRef,
  snDate,
  toComment,
  toAttachment,
  buildUpdatePatch,
};

// --- Connector implementation ---

export class ServiceNowConnector implements TicketConnector {
  readonly name = "ServiceNow";
  private readonly baseUrl: string;
  private readonly authHeader: string;
  private readonly table: string;

  constructor(private readonly config: ServiceNowConfig) {
    this.baseUrl = config.instanceUrl.replace(/\/$/, "");
    this.authHeader =
      "Basic " +
      Buffer.from(`${config.username}:${config.password}`).toString("base64");
    this.table = config.table ?? "incident";
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<{ data: T; headers: Headers }> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        Authorization: this.authHeader,
        Accept: "application/json",
        ...options.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`ServiceNow ${res.status} ${res.statusText}: ${body}`);
    }

    return { data: (await res.json()) as T, headers: res.headers };
  }

  async healthCheck(): Promise<HealthCheckResult> {
    const start = Date.now();
    try {
      await this.request<{ result: unknown[] }>("/api/now/table/sys_user?sysparm_limit=1");
      return {
        ok: true,
        connector: this.name,
        latencyMs: Date.now() - start,
        details: `Authenticated as ${this.config.username}`,
      };
    } catch (err) {
      return {
        ok: false,
        connector: this.name,
        latencyMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listTickets(options: ListTicketsOptions = {}): Promise<ListTicketsResult> {
    const page = options.page ?? 1;
    const pageSize = options.pageSize ?? 50;
    const offset = (page - 1) * pageSize;

    const queryParts: string[] = [];

    if (options.status) {
      const statuses = Array.isArray(options.status) ? options.status : [options.status];
      const codes = statuses.map((s) => STATUS_TO_STATE[s]).filter(Boolean);
      if (codes.length === 1) queryParts.push(`state=${codes[0]}`);
      else if (codes.length > 1) queryParts.push(`stateIN${codes.join(",")}`);
    }

    if (options.assigneeId) queryParts.push(`assigned_to=${options.assigneeId}`);
    if (options.projectKey) queryParts.push(`assignment_group.name=${options.projectKey}`);
    if (options.updatedSince) {
      // ServiceNow datetime format: "2024-01-01 00:00:00"
      const iso = options.updatedSince.toISOString().replace("T", " ").slice(0, 19);
      queryParts.push(`sys_updated_on>${iso}`);
    }

    const params = new URLSearchParams({
      sysparm_limit: String(pageSize),
      sysparm_offset: String(offset),
      sysparm_display_value: "all",
      sysparm_count: "true",
      ...(queryParts.length ? { sysparm_query: queryParts.join("^") } : {}),
    });

    const { data, headers } = await this.request<{ result: SNIncident[] }>(
      `/api/now/table/${this.table}?${params}`
    );

    const total = parseInt(headers.get("X-Total-Count") ?? "0", 10);
    const tickets = data.result.map((r) => toTicket(r, this.baseUrl, this.table));

    return {
      tickets,
      total,
      page,
      pageSize,
      hasMore: offset + tickets.length < total,
    };
  }

  async getTicket(id: string): Promise<Ticket> {
    const params = new URLSearchParams({ sysparm_display_value: "all" });
    const { data } = await this.request<{ result: SNIncident }>(
      `/api/now/table/${this.table}/${id}?${params}`
    );
    return toTicket(data.result, this.baseUrl, this.table);
  }

  async getComments(ticketId: string): Promise<TicketComment[]> {
    const params = new URLSearchParams({
      sysparm_query: `element_id=${ticketId}^elementINcomments,work_notes`,
      sysparm_fields: "sys_id,element,value,sys_created_by,sys_created_on",
      sysparm_order_by: "sys_created_on",
    });
    const { data } = await this.request<{ result: SNJournalEntry[] }>(
      `/api/now/table/sys_journal_field?${params}`
    );
    return data.result.map(toComment);
  }

  async addComment(
    ticketId: string,
    body: string,
    options: AddCommentOptions = {}
  ): Promise<TicketComment> {
    // Patch the incident record -- ServiceNow appends to journal automatically
    const field = options.isInternal ? "work_notes" : "comments";
    await this.request(`/api/now/table/${this.table}/${ticketId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: body }),
    });

    // Return the most recent matching journal entry we just created
    const all = await this.getComments(ticketId);
    const isInternal = options.isInternal ?? false;
    const match = [...all].reverse().find((c) => c.body === body && c.isInternal === isInternal);

    // Synthetic fallback if the journal query races before the write is visible
    return match ?? {
      id: "",
      author: { id: this.config.username, name: this.config.username },
      body,
      isInternal,
      createdAt: new Date(),
    };
  }

  async listAttachments(ticketId: string): Promise<TicketAttachment[]> {
    const params = new URLSearchParams({ sysparm_query: `table_sys_id=${ticketId}` });
    const { data } = await this.request<{ result: SNAttachment[] }>(
      `/api/now/attachment?${params}`
    );
    return data.result.map(toAttachment);
  }

  async downloadAttachment(attachmentId: string): Promise<Buffer> {
    const res = await fetch(
      `${this.baseUrl}/api/now/attachment/${attachmentId}/file`,
      { headers: { Authorization: this.authHeader } }
    );
    if (!res.ok) throw new Error(`ServiceNow attachment download ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async uploadAttachment(
    ticketId: string,
    filename: string,
    data: Buffer,
    mimeType = "application/octet-stream"
  ): Promise<TicketAttachment> {
    const params = new URLSearchParams({
      table_name: this.table,
      table_sys_id: ticketId,
      file_name: filename,
    });
    const { data: body } = await this.request<{ result: SNAttachment }>(
      `/api/now/attachment/file?${params}`,
      {
        method: "POST",
        headers: { "Content-Type": mimeType },
        body: new Uint8Array(data),
      }
    );
    return toAttachment(body.result);
  }

  async updateTicket(ticketId: string, fields: UpdateTicketFields): Promise<Ticket> {
    const patch = buildUpdatePatch(fields);
    const params = new URLSearchParams({ sysparm_display_value: "all" });
    const { data } = await this.request<{ result: SNIncident }>(
      `/api/now/table/${this.table}/${ticketId}?${params}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      }
    );
    return toTicket(data.result, this.baseUrl, this.table);
  }
}
