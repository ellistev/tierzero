# CLAUDE.md

## Code Navigation
- Prefer LSP over grep/glob for code navigation (go-to-definition, find references, type checking)
- LSP gives exact results in ~50ms vs grep's fuzzy multi-file guessing

## Context Hub (chub) - Up-to-date API Docs
When working with external libraries, use `chub` to get current API documentation instead of relying on training data:

```bash
# Search for relevant docs
chub search "playwright"

# Get specific docs (outputs LLM-optimized markdown)
chub get playwright/playwright
chub get langchain/core
chub get langgraph/package
chub get openai/chat

# Key docs for this project:
# - playwright/playwright    (browser automation)
# - langchain/core           (LLM framework)
# - langgraph/package        (agent state graphs)
# - openai/chat              (OpenAI chat completions)
# - chromadb/package         (vector store)
```

Always `chub get <id>` before writing code that uses an unfamiliar API. The docs are community-maintained and more current than training data.

If a doc is wrong or missing something, leave feedback: `chub feedback <id> down "missing X method"`

## Project Stack
- **Runtime:** Node 18+ / TypeScript strict
- **Agent:** LangGraph StateGraph
- **LLM:** OpenAI (GPT-4o/mini) via LangChain
- **Vector store:** ChromaDB
- **Browser:** Playwright + Chrome CDP
- **Test runner:** Node built-in (`import { describe, it } from 'node:test'`)
- **No new dependencies** without explicit approval
