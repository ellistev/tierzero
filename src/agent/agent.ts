/**
 * Agent brain: LangGraph StateGraph wiring.
 *
 * Graph:  START → ingest → retrieve → decide → act → record → END
 *
 * ingest   Load full comment thread from the ticket connector.
 * retrieve RAG search the knowledge base using ticket title + description.
 * decide   Single structured LLM call → decision + reasoning + drafted reply.
 * act      Execute the decision deterministically (no open-ended tool loop).
 * record   Post an internal audit note summarising the full run.
 */

import { ChatOpenAI } from "@langchain/openai";
import { StateGraph, Annotation, START, END } from "@langchain/langgraph";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { z } from "zod";
import { KnowledgeRetriever } from "../rag/retriever";
import type { Ticket, TicketComment } from "../connectors/types";
import type { TicketConnector } from "../connectors/connector";
import type { RetrievedChunk } from "../rag/retriever";
import type { CodebaseConfig, CodingModel, ImplementationResult } from "../coder/types";
import { Implementer, formatResultForTicket } from "../coder/implementer";

// ---------------------------------------------------------------------------
// Decision + Action types
// ---------------------------------------------------------------------------

export type AgentDecision =
  | "automate"        // agent resolves fully, no human required
  | "draft_response"  // agent knows the answer, posts it and closes (or waits for reporter confirmation)
  | "escalate"        // outside agent scope -- assign to a human team with context summary
  | "needs_info"      // reporter hasn't provided enough detail -- ask a targeted clarifying question
  | "implement";      // ticket is a bug/feature -- the agent will write code to fix/implement it

/**
 * Discriminated union of every concrete action the agent can take.
 * Typed rather than free-form string so callers can branch on `type`
 * for audit, reporting, and testing.
 */
export type AgentAction =
  | { type: "posted_comment"; commentId: string; body: string; isInternal: boolean }
  | { type: "resolved"; resolution: string }
  | { type: "escalated"; assigneeId: string; assigneeName: string; reason: string }
  | { type: "requested_info"; commentId: string; question: string }
  | { type: "implemented"; branch: string; commitHash: string; summary: string; testsPassed?: boolean }
  | { type: "no_action"; reason: string };

// ---------------------------------------------------------------------------
// Agent state
// ---------------------------------------------------------------------------

/**
 * Everything that flows through the graph. Every node receives a snapshot
 * of this and returns a Partial<AgentState> which LangGraph merges back in.
 *
 * When wiring with LangGraph:
 *   - `comments`, `knowledgeChunks`, `steps` use append reducers
 *   - all other fields use last-write-wins (default)
 *   Wrap with Annotation.Root({ ... }) at that point.
 */
export interface AgentState {
  // --- Immutable input ---
  ticket: Ticket;

  // --- Enriched by [ingest] ---
  /** Full comment thread loaded from the connector */
  comments: TicketComment[];

  // --- Populated by [retrieve] ---
  knowledgeChunks: RetrievedChunk[];
  /** Pre-formatted context block ready to inject into LLM prompts */
  knowledgeContext: string;

  // --- Set by [decide] ---
  decision: AgentDecision | null;
  /** LLM's chain-of-thought for the decision -- stored for audit and debugging */
  reasoning: string;
  /** 0-1 self-reported confidence. Below ~0.4 the agent should prefer escalation. */
  confidence: number;
  /**
   * Drafted public reply (populated when decision === "draft_response").
   * Kept separate from action so it can be reviewed before posting if needed.
   */
  draftedReply: string;
  /**
   * Short team key for escalation (e.g. "networking", "security").
   * Populated by the LLM when decision === "escalate".
   * Resolved to a connector-specific ID via AgentConfig.escalationTeams.
   */
  escalateTo: string;

  // --- Set by [act] ---
  actionTaken: AgentAction | null;
  /** Number of tool-call iterations consumed (guard against runaway loops) */
  iterationsUsed: number;

  // --- Append-only audit trail ---
  steps: AgentStep[];

  // --- Terminal ---
  done: boolean;
  error: string | null;
}

export interface AgentStep {
  node: string;
  summary: string;
  timestamp: string; // ISO-8601
}

export function initialState(ticket: Ticket): AgentState {
  return {
    ticket,
    comments: [],
    knowledgeChunks: [],
    knowledgeContext: "",
    decision: null,
    reasoning: "",
    confidence: 0,
    draftedReply: "",
    escalateTo: "",
    actionTaken: null,
    iterationsUsed: 0,
    steps: [],
    done: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// LangGraph state annotation
// ---------------------------------------------------------------------------

const AgentStateAnnotation = Annotation.Root({
  ticket:           Annotation<Ticket>(),
  comments:         Annotation<TicketComment[]>({ reducer: (c, n) => [...c, ...n], default: () => [] }),
  knowledgeChunks:  Annotation<RetrievedChunk[]>({ reducer: (c, n) => [...c, ...n], default: () => [] }),
  knowledgeContext: Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  decision:         Annotation<AgentDecision | null>({ reducer: (_, n) => n, default: () => null }),
  reasoning:        Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  confidence:       Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  draftedReply:     Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  escalateTo:       Annotation<string>({ reducer: (_, n) => n, default: () => "" }),
  actionTaken:      Annotation<AgentAction | null>({ reducer: (_, n) => n, default: () => null }),
  iterationsUsed:   Annotation<number>({ reducer: (_, n) => n, default: () => 0 }),
  steps:            Annotation<AgentStep[]>({ reducer: (c, n) => [...c, ...n], default: () => [] }),
  done:             Annotation<boolean>({ reducer: (_, n) => n, default: () => false }),
  error:            Annotation<string | null>({ reducer: (_, n) => n, default: () => null }),
});

// Structured output schema for the decide node
const decisionOutputSchema = z.object({
  decision: z.enum(["automate", "draft_response", "escalate", "needs_info", "implement"])
    .describe("How to handle this ticket"),
  reasoning: z.string()
    .describe("Step-by-step reasoning for the decision"),
  confidence: z.number().min(0).max(1)
    .describe("Confidence in the decision, 0.0-1.0"),
  draftedReply: z.string().describe(
    "Text to deliver based on the decision. " +
    "automate/draft_response: public reply to reporter. " +
    "escalate: context notes for the receiving team (posted as internal note). " +
    "needs_info: single clarifying question for the reporter."
  ),
  escalateTo: z.string().default("").describe(
    "Only when decision='escalate': short team key from the escalation matrix " +
    "(e.g. 'networking', 'security', 'infrastructure', 'database', 'desktop', 'application'). " +
    "Leave empty for other decisions."
  ),
});

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

/**
 * Typed tool contract: input schema + output shape + description.
 * The description is what the LLM reads to decide when to call the tool --
 * it should describe the WHEN, not just the WHAT.
 *
 * Implementation: each tool is a closure over AgentDeps (connector + retriever).
 * When wiring, wrap each ToolDef in a LangChain DynamicStructuredTool with a
 * matching Zod schema derived from the Input type.
 */
export interface ToolDef<Input, Output> {
  name: string;
  description: string;
  execute: (input: Input, deps: AgentDeps) => Promise<Output>;
}

export interface AgentDeps {
  connector: TicketConnector;
  retriever: KnowledgeRetriever;
}

// --- Tool input/output shapes ---

export interface SearchKnowledgeInput {
  /** Natural-language query describing the problem or procedure to look up */
  query: string;
  /**
   * Optional folder prefix to restrict search scope.
   * e.g. "runbooks/" to only search runbook documents.
   */
  folder?: string;
}
export interface SearchKnowledgeOutput {
  chunks: RetrievedChunk[];
  /** Formatted context block for direct use in a prompt */
  context: string;
  found: number;
}

export interface ReadCommentsInput {
  ticketId: string;
}
export interface ReadCommentsOutput {
  comments: TicketComment[];
  count: number;
}

export interface PostPublicCommentInput {
  ticketId: string;
  /** The message visible to the ticket reporter */
  body: string;
}
export interface PostPublicCommentOutput {
  commentId: string;
}

export interface PostInternalNoteInput {
  ticketId: string;
  /** Internal note only visible to agents/engineers, not the reporter */
  body: string;
}
export interface PostInternalNoteOutput {
  commentId: string;
}

export interface EscalateInput {
  ticketId: string;
  /** sys_id or user/team ID in the target system */
  assigneeId: string;
  /**
   * Human-readable reason for escalation.
   * This is posted as an internal note before reassignment so the
   * receiving team has immediate context.
   */
  reason: string;
}
export interface EscalateOutput {
  success: boolean;
  internalNoteId: string;
}

export interface ResolveInput {
  ticketId: string;
  /**
   * Short resolution summary posted as a public comment before closing.
   * Should reference the KB source(s) used if applicable.
   */
  resolution: string;
}
export interface ResolveOutput {
  success: boolean;
  commentId: string;
}

export interface RequestInfoInput {
  ticketId: string;
  /**
   * Specific question for the reporter.
   * Should be a single, focused question -- multiple questions in one
   * message tend to get partially answered.
   */
  question: string;
}
export interface RequestInfoOutput {
  commentId: string;
}

// --- Tool implementations (closures over AgentDeps) ---

export const TOOLS = {
  searchKnowledge: {
    name: "search_knowledge",
    description:
      "Search the knowledge base for runbooks, procedures, or documentation relevant to this ticket. " +
      "Call this first before deciding how to resolve. Use a descriptive query about the problem, " +
      "not the ticket ID. Optionally restrict to a folder (e.g. 'runbooks/') for precision.",
    execute: async (
      input: SearchKnowledgeInput,
      { retriever }: AgentDeps
    ): Promise<SearchKnowledgeOutput> => {
      const result = await retriever.search(input.query, {
        filter: input.folder ? { sourcePrefix: input.folder } : undefined,
        mmr: true, // diversify results across different source documents
      });
      const { KnowledgeRetriever } = await import("../rag/retriever");
      return {
        chunks: result.chunks,
        context: KnowledgeRetriever.formatForPrompt(result),
        found: result.totalReturned,
      };
    },
  } satisfies ToolDef<SearchKnowledgeInput, SearchKnowledgeOutput>,

  readComments: {
    name: "read_comments",
    description:
      "Fetch the full comment thread for a ticket. Call this when the ticket description alone " +
      "is insufficient -- the thread may contain troubleshooting steps already tried, " +
      "error messages, or prior agent responses.",
    execute: async (
      input: ReadCommentsInput,
      { connector }: AgentDeps
    ): Promise<ReadCommentsOutput> => {
      const comments = await connector.getComments(input.ticketId);
      return { comments, count: comments.length };
    },
  } satisfies ToolDef<ReadCommentsInput, ReadCommentsOutput>,

  postPublicComment: {
    name: "post_public_comment",
    description:
      "Post a reply visible to the ticket reporter. Use this to deliver a resolution, " +
      "a workaround, or a status update. Do NOT use for internal team notes -- use " +
      "post_internal_note for that.",
    execute: async (
      input: PostPublicCommentInput,
      { connector }: AgentDeps
    ): Promise<PostPublicCommentOutput> => {
      const comment = await connector.addComment(input.ticketId, input.body, {
        isInternal: false,
      });
      return { commentId: comment.id };
    },
  } satisfies ToolDef<PostPublicCommentInput, PostPublicCommentOutput>,

  postInternalNote: {
    name: "post_internal_note",
    description:
      "Post a note only visible to agents and engineers, not the reporter. " +
      "Use this to document reasoning, KB sources consulted, or context for a human escalation. " +
      "Always post an internal note before escalating.",
    execute: async (
      input: PostInternalNoteInput,
      { connector }: AgentDeps
    ): Promise<PostInternalNoteOutput> => {
      const comment = await connector.addComment(input.ticketId, input.body, {
        isInternal: true,
      });
      return { commentId: comment.id };
    },
  } satisfies ToolDef<PostInternalNoteInput, PostInternalNoteOutput>,

  escalate: {
    name: "escalate_ticket",
    description:
      "Reassign this ticket to a human agent or team when the issue is outside the agent's scope, " +
      "requires physical access, policy approval, or the confidence in a resolution is low. " +
      "Always post an internal note with reasoning BEFORE calling this tool.",
    execute: async (
      input: EscalateInput,
      { connector }: AgentDeps
    ): Promise<EscalateOutput> => {
      const note = await connector.addComment(input.ticketId, input.reason, { isInternal: true });
      if (input.assigneeId) {
        await connector.updateTicket(input.ticketId, { assigneeId: input.assigneeId });
      }
      return { success: true, internalNoteId: note.id };
    },
  } satisfies ToolDef<EscalateInput, EscalateOutput>,

  resolve: {
    name: "resolve_ticket",
    description:
      "Mark the ticket as resolved with a summary of what was done. " +
      "Only call this when you are confident the issue has been addressed. " +
      "Post a public comment with the resolution before calling this.",
    execute: async (
      input: ResolveInput,
      { connector }: AgentDeps
    ): Promise<ResolveOutput> => {
      const comment = await connector.addComment(input.ticketId, input.resolution, {
        isInternal: false,
      });
      await connector.updateTicket(input.ticketId, { status: "resolved" });
      return { success: true, commentId: comment.id };
    },
  } satisfies ToolDef<ResolveInput, ResolveOutput>,

  requestInfo: {
    name: "request_info",
    description:
      "Ask the reporter a single specific question when their ticket lacks enough detail to act on. " +
      "Keep it focused -- one question at a time. The ticket will be set to pending while waiting.",
    execute: async (
      input: RequestInfoInput,
      { connector }: AgentDeps
    ): Promise<RequestInfoOutput> => {
      const comment = await connector.addComment(input.ticketId, input.question, {
        isInternal: false,
      });
      await connector.updateTicket(input.ticketId, { status: "pending" });
      return { commentId: comment.id };
    },
  } satisfies ToolDef<RequestInfoInput, RequestInfoOutput>,
} as const;

export type ToolName = keyof typeof TOOLS;

// ---------------------------------------------------------------------------
// Pure helpers (exported for unit testing)
// ---------------------------------------------------------------------------

/**
 * Applies the confidence threshold: if confidence is below the minimum
 * and the decision isn't already "escalate", overrides to "escalate" and
 * appends a note to the reasoning.
 */
export function _applyConfidenceThreshold(
  decision: AgentDecision,
  confidence: number,
  reasoning: string,
  minConfidence: number
): { decision: AgentDecision; reasoning: string } {
  const overridden = confidence < minConfidence && decision !== "escalate";
  return {
    decision: overridden ? "escalate" : decision,
    reasoning: overridden
      ? `${reasoning}\n\n[Confidence ${confidence.toFixed(2)} below threshold ${minConfidence} — overriding to escalate]`
      : reasoning,
  };
}

// ---------------------------------------------------------------------------
// Agent config
// ---------------------------------------------------------------------------

export interface AgentConfig {
  deps: AgentDeps;
  /** LLM model name. Default: "gpt-4o-mini" */
  model?: string;
  openAIApiKey?: string;
  /**
   * Hard cap on act-node iterations before the agent force-escalates.
   * Prevents runaway tool-call loops. Default: 10.
   */
  maxIterations?: number;
  /**
   * Confidence threshold below which the agent escalates rather than acting.
   * LLM self-reports confidence; treat as a soft signal not a hard truth. Default: 0.4.
   */
  minConfidence?: number;
  /**
   * When true, log all planned actions but do not call the connector.
   * Useful for testing the decision logic without touching the real ticket system.
   */
  dryRun?: boolean;
  /**
   * Maps escalateTo team keys (as output by the LLM) to the connector-specific
   * ID used to reassign the ticket (sys_id for ServiceNow, accountId for Jira).
   * When a match is found, updateTicket({ assigneeId }) is called automatically.
   *
   * Example:
   *   { networking: { sysId: "abc123", name: "Network Engineering" } }
   */
  escalationTeams?: Record<string, { sysId: string; name: string }>;
  /**
   * Registered codebases the agent can implement changes in.
   * When the LLM decides "implement", the agent picks the matching
   * codebase (by project key or first available) and writes code.
   */
  codebases?: CodebaseConfig[];
  /**
   * Coding LLM used for the "implement" decision. Required if any
   * codebases are configured. Supports OpenAI, Anthropic (Claude),
   * and Google (Gemini) models.
   */
  codingModel?: CodingModel;
}

// ---------------------------------------------------------------------------
// AgentGraph
// ---------------------------------------------------------------------------

export class AgentGraph {
  private readonly cfg: Required<AgentConfig>;

  constructor(config: AgentConfig) {
    this.cfg = {
      model: "gpt-4o-mini",
      openAIApiKey: process.env.OPENAI_API_KEY ?? "",
      maxIterations: 10,
      minConfidence: 0.4,
      dryRun: false,
      escalationTeams: {},
      codebases: [],
      codingModel: undefined as unknown as CodingModel,
      ...config,
    };
  }

  private buildGraph() {
    const { deps, model, openAIApiKey, minConfidence, dryRun, escalationTeams, codebases, codingModel } = this.cfg;
    type S = typeof AgentStateAnnotation.State;
    const now = () => new Date().toISOString();

    // ── ingest ──────────────────────────────────────────────────────────────
    const ingest = async (state: S): Promise<Partial<S>> => {
      try {
        const comments = await deps.connector.getComments(state.ticket.id);
        return {
          comments,
          steps: [{ node: "ingest", summary: `Loaded ${comments.length} comment(s)`, timestamp: now() }],
        };
      } catch (err) {
        // Non-fatal -- proceed with empty thread
        return {
          steps: [{ node: "ingest", summary: `Comments unavailable: ${err}`, timestamp: now() }],
        };
      }
    };

    // ── retrieve ─────────────────────────────────────────────────────────────
    const retrieve = async (state: S): Promise<Partial<S>> => {
      try {
        const query = `${state.ticket.title} ${state.ticket.description}`.slice(0, 500);
        const result = await deps.retriever.search(query, { mmr: true, k: 5 });
        return {
          knowledgeChunks: result.chunks,
          knowledgeContext: KnowledgeRetriever.formatForPrompt(result),
          steps: [{ node: "retrieve", summary: `Found ${result.totalReturned} KB chunk(s)`, timestamp: now() }],
        };
      } catch (err) {
        // Non-fatal -- agent proceeds with empty KB context and will likely escalate
        return {
          knowledgeContext: "(Knowledge base unavailable)",
          steps: [{ node: "retrieve", summary: `KB search failed: ${err}`, timestamp: now() }],
        };
      }
    };

    // ── decide ───────────────────────────────────────────────────────────────
    const decide = async (state: S): Promise<Partial<S>> => {
      const llm = new ChatOpenAI({ model, apiKey: openAIApiKey, temperature: 0 });
      const structured = llm.withStructuredOutput(decisionOutputSchema);

      const commentBlock = state.comments.length === 0
        ? "No comments yet."
        : state.comments
            .slice(-8)
            .map(c => `[${c.isInternal ? "internal" : "public"} | ${c.author.name}]\n${c.body}`)
            .join("\n\n---\n\n");

      const hasCodebases = codebases && codebases.length > 0;
      const implementLine = hasCodebases
        ? `- "implement": This is a bug or feature request that needs code changes. A coding agent will write the fix/feature.\n`
        : "";
      const codebaseNote = hasCodebases
        ? `\nAvailable codebases for implementation: ${codebases.map(c => c.name).join(", ")}.\n` +
          `Choose "implement" when the ticket is a bug or feature that can be addressed by writing code.\n`
        : "";

      const systemPrompt =
        `You are an AI IT operations agent that triages and resolves support tickets.\n\n` +
        `Classify each ticket into exactly one decision:\n` +
        `- "automate": A clear, complete resolution exists in the knowledge base. Draft the full solution.\n` +
        `- "draft_response": Useful guidance exists but resolution is uncertain. Draft a helpful reply.\n` +
        `- "escalate": Out of scope (physical access, policy decision, or low knowledge-base confidence).\n` +
        `- "needs_info": Too vague to act on. Ask ONE specific clarifying question.\n` +
        implementLine +
        `\nKeep responses concise and actionable. Cite KB source files when used.\n` +
        `Confidence below ${minConfidence} should default to "escalate".` +
        codebaseNote;

      const userPrompt =
        `## Ticket\n` +
        `Title: ${state.ticket.title}\n` +
        `Type: ${state.ticket.type} | Priority: ${state.ticket.priority} | Status: ${state.ticket.status}\n` +
        `Reporter: ${state.ticket.reporter.name}` +
        (state.ticket.assignee ? ` | Assignee: ${state.ticket.assignee.name}` : "") + "\n\n" +
        `Description:\n${state.ticket.description}\n\n` +
        `## Comment Thread\n${commentBlock}\n\n` +
        `## Knowledge Base\n${state.knowledgeContext || "(No matching KB entries found)"}`;

      try {
        const result = await structured.invoke([
          new SystemMessage(systemPrompt),
          new HumanMessage(userPrompt),
        ]);

        const { decision, reasoning } = _applyConfidenceThreshold(
          result.decision,
          result.confidence,
          result.reasoning,
          minConfidence
        );
        const overridden = decision !== result.decision;

        return {
          decision,
          reasoning,
          confidence: result.confidence,
          draftedReply: result.draftedReply,
          escalateTo: result.escalateTo ?? "",
          steps: [{
            node: "decide",
            summary: `${decision} (confidence: ${result.confidence.toFixed(2)}${overridden ? ", threshold override" : ""}${result.escalateTo ? `, team: ${result.escalateTo}` : ""})`,
            timestamp: now(),
          }],
        };
      } catch (err) {
        return {
          decision: "escalate",
          reasoning: `LLM call failed: ${err}`,
          confidence: 0,
          draftedReply: `AI agent analysis failed (${err}). Escalating for manual review.`,
          escalateTo: "",
          steps: [{ node: "decide", summary: `LLM error → escalate`, timestamp: now() }],
        };
      }
    };

    // ── act ──────────────────────────────────────────────────────────────────
    const act = async (state: S): Promise<Partial<S>> => {
      const { ticket, decision, draftedReply, reasoning } = state;

      if (dryRun) {
        console.log(`  [dry-run] ${decision}: "${draftedReply.slice(0, 120)}"`);
        return {
          actionTaken: { type: "no_action", reason: `dry-run: would ${decision}` },
          steps: [{ node: "act", summary: `dry-run: ${decision}`, timestamp: now() }],
        };
      }

      try {
        switch (decision) {
          case "automate": {
            const { commentId } = await TOOLS.resolve.execute(
              { ticketId: ticket.id, resolution: draftedReply },
              deps
            );
            return {
              actionTaken: { type: "resolved", resolution: draftedReply },
              steps: [{ node: "act", summary: `Resolved, comment ${commentId}`, timestamp: now() }],
            };
          }

          case "draft_response": {
            const { commentId } = await TOOLS.postPublicComment.execute(
              { ticketId: ticket.id, body: draftedReply },
              deps
            );
            return {
              actionTaken: { type: "posted_comment", commentId, body: draftedReply, isInternal: false },
              steps: [{ node: "act", summary: `Posted public comment ${commentId}`, timestamp: now() }],
            };
          }

          case "escalate": {
            const teamKey = state.escalateTo ?? "";
            const team = escalationTeams[teamKey];
            const noteBody =
              `## AI Agent Escalation\n\n` +
              `**Reasoning:** ${reasoning}\n\n` +
              `**Suggested team:** ${(team?.name ?? teamKey) || "Unspecified"}\n\n` +
              `**Notes for team:** ${draftedReply}`;
            const { internalNoteId } = await TOOLS.escalate.execute(
              { ticketId: ticket.id, assigneeId: team?.sysId ?? "", reason: noteBody },
              deps
            );
            return {
              actionTaken: {
                type: "escalated",
                assigneeId: team?.sysId ?? "",
                assigneeName: team?.name ?? (teamKey || "Unassigned"),
                reason: reasoning,
              },
              steps: [{
                node: "act",
                summary: `Escalated to ${(team?.name ?? teamKey) || "unspecified"}, note ${internalNoteId}`,
                timestamp: now(),
              }],
            };
          }

          case "needs_info": {
            const { commentId } = await TOOLS.requestInfo.execute(
              { ticketId: ticket.id, question: draftedReply },
              deps
            );
            return {
              actionTaken: { type: "requested_info", commentId, question: draftedReply },
              steps: [{ node: "act", summary: `Requested info, comment ${commentId}`, timestamp: now() }],
            };
          }

          case "implement": {
            if (!codebases?.length || !codingModel) {
              return {
                actionTaken: { type: "no_action", reason: "No codebases configured for implementation" },
                steps: [{ node: "act", summary: "implement requested but no codebases configured — skipped", timestamp: now() }],
              };
            }

            // Match codebase by ticket project key, or fall back to the first one
            const codebase = codebases.find((cb) =>
              cb.projectKeys?.some((k) =>
                k.toLowerCase() === (ticket.project ?? "").toLowerCase() ||
                k.toLowerCase() === ticket.source.toLowerCase()
              )
            ) ?? codebases[0];

            const implementer = new Implementer(codebase, codingModel);
            const implResult = await implementer.implement(ticket);

            // Post the result as an internal note on the ticket
            const resultComment = formatResultForTicket(implResult, codingModel.modelName);
            await deps.connector.addComment(ticket.id, resultComment, { isInternal: true });

            if (implResult.success) {
              // Post a public comment summarizing what was done
              const publicMsg =
                `Code changes have been implemented on branch \`${implResult.branch}\`.\n\n` +
                `${implResult.summary}\n\n` +
                `${implResult.filesChanged.length} file(s) changed.` +
                (implResult.testsPassed ? " All tests passing." : "");
              await deps.connector.addComment(ticket.id, publicMsg, { isInternal: false });
              await deps.connector.updateTicket(ticket.id, { status: "in_progress" });
            }

            return {
              actionTaken: {
                type: "implemented",
                branch: implResult.branch ?? "",
                commitHash: implResult.commitHash ?? "",
                summary: implResult.summary,
                testsPassed: implResult.testsPassed,
              },
              steps: [{
                node: "act",
                summary: implResult.success
                  ? `Implemented on branch ${implResult.branch} (${implResult.commitHash}), tests: ${implResult.testsPassed ?? "not run"}`
                  : `Implementation failed: ${implResult.error ?? "unknown error"}`,
                timestamp: now(),
              }],
            };
          }

          default:
            return {
              actionTaken: { type: "no_action", reason: `Unknown decision: ${String(decision)}` },
              steps: [{ node: "act", summary: `No action: unknown decision`, timestamp: now() }],
            };
        }
      } catch (err) {
        return {
          error: `act failed: ${err}`,
          actionTaken: { type: "no_action", reason: String(err) },
          steps: [{ node: "act", summary: `Action failed: ${err}`, timestamp: now() }],
        };
      }
    };

    // ── record ───────────────────────────────────────────────────────────────
    const record = async (state: S): Promise<Partial<S>> => {
      const sources = state.knowledgeChunks
        .slice(0, 5)
        .filter(c => !isNaN(c.score))
        .map(c => `- ${c.source} (score: ${c.score.toFixed(2)})`)
        .join("\n") || "  None";

      const auditNote = [
        "## AI Agent Run",
        `Ticket: ${state.ticket.externalId ?? state.ticket.id} | Decision: **${state.decision}** | Confidence: ${state.confidence.toFixed(2)}`,
        "",
        "### Reasoning",
        state.reasoning,
        "",
        "### Knowledge Base Sources",
        sources,
        "",
        "### Step Log",
        state.steps.map((s, i) => `${i + 1}. [${s.node}] ${s.summary}`).join("\n"),
      ].join("\n");

      if (!dryRun) {
        try {
          await deps.connector.addComment(state.ticket.id, auditNote, { isInternal: true });
        } catch (err) {
          console.warn(`  [record] Audit note failed (non-fatal): ${err}`);
        }
      } else {
        console.log(`\n  [dry-run] Audit note:\n${auditNote.split("\n").map(l => "    " + l).join("\n")}`);
      }

      return {
        done: true,
        steps: [{ node: "record", summary: "Audit note posted", timestamp: now() }],
      };
    };

    // ── assemble graph ────────────────────────────────────────────────────────
    return new StateGraph(AgentStateAnnotation)
      .addNode("ingest",   ingest)
      .addNode("retrieve", retrieve)
      .addNode("decide",   decide)
      .addNode("act",      act)
      .addNode("record",   record)
      .addEdge(START,      "ingest")
      .addEdge("ingest",   "retrieve")
      .addEdge("retrieve", "decide")
      .addEdge("decide",   "act")
      .addEdge("act",      "record")
      .addEdge("record",   END)
      .compile();
  }

  /** Run the full agent pipeline for a single ticket. */
  async run(ticket: Ticket): Promise<AgentState> {
    const graph = this.buildGraph();
    const result = await graph.invoke(initialState(ticket));
    return result as AgentState;
  }
}
