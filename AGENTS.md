# TierZero — Agent Context

AI-powered IT ticket resolution. Reads tickets, searches a RAG knowledge base, resolves or escalates automatically.

## Stack

TypeScript (Node 18+, ESM), LangGraph, LangChain, OpenAI, ChromaDB. No build step — `tsx` runs source directly.

## Project layout

```
src/
  connectors/         TicketConnector interface + ServiceNow / Jira / GitLab implementations
  rag/                ChromaDB indexer and retriever
  agent/              LangGraph StateGraph + polling loop
  ingest/             Knowledge-base importers (Azure DevOps, Confluence, URL, ticket miner)
  coder/              Code implementation engine (multi-model: OpenAI, Anthropic, Google)
  cli.ts              All CLI entry points
knowledge/            Runbooks, SOPs, imported wiki/ticket articles
```

## Architecture — the agent graph

```
START → ingest → retrieve → decide → act → record → END
```

The `decide` node makes **one** structured LLM call (Zod-validated output) and produces a decision + confidence score. The `act` node executes deterministically. No iterative tool loops.

Decision types: `automate` | `draft_response` | `escalate` | `needs_info` | `implement`.

The `implement` decision triggers the code implementation engine (`src/coder/`). It reads the relevant codebase, asks a coding LLM (Claude, GPT, Gemini) to plan and produce file edits, applies them, runs tests, and creates a git branch. Requires `--codebase` and `--coding-model` CLI flags.

## TicketConnector interface

Every ticketing system implements `src/connectors/connector.ts`. Methods: `listTickets`, `getTicket`, `getComments`, `addComment`, `listAttachments`, `downloadAttachment`, `uploadAttachment`, `updateTicket`.

`TicketStatus` is a strict union: `"open" | "in_progress" | "pending" | "resolved" | "closed"`.

## Gotchas

- **ChromaDB** must be running before any `index`, `search`, `run`, or `watch` commands. Start it with `docker run -p 8000:8000 chromadb/chroma`.
- **ESM imports** — all local imports need `.js` extension even though files are `.ts`.
- **Testing** uses `node:test` + `node:assert/strict` (NOT vitest/jest). Tests live next to source. Pure helpers only — no HTTP mocks.
- **TicketStatus values** are a closed union. Connectors map to them; do not add new values.
- **LLM decision schema** is Zod — changes must be backward-compatible (add optional fields, don't remove).
- The `knowledge/` folder is write-once from the importers' perspective. Importers use SHA-256 hash to skip unchanged files.

## Commands

```bash
npm test                     # 271 unit tests
npm run typecheck            # TypeScript strict check
npm run index -- knowledge/  # Index knowledge base into ChromaDB
npm run dev -- search "query"
npm run dev -- run <ticket-id> --connector servicenow ...
npm run dev -- watch --connector servicenow ...
npm run dev -- import-wiki --source azuredevops --org ... --project ... --token ...
npm run dev -- mine-tickets --connector servicenow ...
npm run dev -- import-url https://...
```

## Adding a connector

1. Implement `TicketConnector` from `src/connectors/connector.ts`
2. Export pure helper functions via named exports for unit testing
3. Add tests in `<name>.test.ts` using `node:test`
4. Wire into `src/cli.ts` under `--connector <name>`

## Environment variables

`OPENAI_API_KEY` is always required. For the code implementation feature, also set `ANTHROPIC_API_KEY` or `GOOGLE_API_KEY` depending on which coding model you use. See `.env.example` for the full list.

---

## Agent behavior guidelines

### Before making changes

- Read the relevant source files before editing — don't assume structure from filenames alone
- Check existing tests to understand expected behavior before changing it
- Prefer targeted edits over large rewrites; smaller diffs are easier to verify and revert

### Minimal footprint

- Don't install new npm packages without a clear reason — `fetch`, `crypto`, `fs/promises`, and `path` cover most needs
- Don't create new files unless necessary — extend existing modules when the fit is natural
- Don't leave debug logs, commented-out code, or scaffolding comments in committed code

### Quality gates — run before considering any task done

```bash
npm test           # all 271+ tests must pass
npm run typecheck  # zero TypeScript errors
```

If you introduce a test failure or type error, fix it before moving on. Never leave the repo in a broken state.

### Session completion — landing the plane

Work is **not done** until it is pushed to the remote. Before ending a session:

1. Run quality gates above
2. Commit all changes with a clear message describing *why*, not just *what*
3. Push:
   ```bash
   git pull --rebase
   git push
   git status   # must show "up to date with origin"
   ```
4. If there is remaining work, leave a clear note — either a TODO comment in the relevant file or a summary message — so the next session has an unambiguous starting point
5. Do not say "ready to push" and hand back to the human — push yourself

### When to ask vs. act

- **Act without asking** on well-scoped tasks where the intent is clear and the change is reversible
- **Ask first** when the request is ambiguous, would affect the public interface of a module, or requires a choice between meaningfully different approaches
- **Never ask** about things you can look up by reading the code
