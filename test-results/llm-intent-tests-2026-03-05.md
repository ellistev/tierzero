# TierZero Intent Execution Layer - LLM Integration Test Results
**Date:** 2026-03-05 19:34 PST
**Commit:** b035f2d

## Architecture Built Today

### Intent Execution Layer (1,683 lines, 13 files)
- **IntentExecution Aggregate** (CQRS/ES) - 8 events, 8 commands, Adaptech pattern
- **SelectorCache Read Model** - node:sqlite, per-page per-intent cache with running avg duration
- **IntentEngine** - Fallback chain: cached -> aria -> LLM (accessibility tree) -> vision (screenshot) -> recovery -> escalate
- **Resolution strategies:** CachedStrategy, AriaStrategy, LLMStrategy, VisionStrategy
- **Recovery strategies:** DismissDialogRecovery (modal/dialog auto-dismiss), LLMRecovery (page analysis)

### Test Suite
- **Unit tests:** 37 tests (IntentExecution aggregate, SelectorCache projection, IntentEngine fallback chain)
- **Browser integration tests:** 24 tests (real Chromium, inline HTML, CQRS event verification)
- **LLM integration tests:** 18 tests (3 models x 6 scenarios via OpenRouter)
- **Total project tests:** 446 (unit + integration, excluding LLM) - all passing
- **LLM tests:** 17/18 passing (1 Gemini vision hallucination)

## LLM Test Results (OpenRouter)

### Models Tested
| Model | Pass Rate | Avg Response Time |
|-------|-----------|-------------------|
| anthropic/claude-haiku-4-5 | 6/6 (100%) | 2,236ms |
| google/gemini-2.0-flash-001 | 5/6 (83%) | 807ms |
| openai/gpt-4o-mini | 6/6 (100%) | 779ms |

### Detailed Results

#### A. Accessibility Tree Resolution
**What:** LLM reads page accessibility tree, returns CSS selector for "fill the name field"
**HTML:** Form with labeled inputs (name, email, country dropdown, submit button)

| Model | Selector Returned | Valid? | Time |
|-------|-------------------|--------|------|
| claude-haiku-4-5 | `#fullName` | YES | 804ms |
| gemini-2.0-flash | `input[name="fullName"]` | YES | 568ms |
| gpt-4o-mini | `#fullName` | YES | 631ms |

#### B. Ambiguous Element Resolution
**What:** 3 similar buttons (Submit Order, Submit Review, Submit Form). LLM must pick "Submit Review"

| Model | Selector Returned | Resolved To | Correct? | Time |
|-------|-------------------|-------------|----------|------|
| claude-haiku-4-5 | `#btn-review` | Submit Review | YES | 611ms |
| gemini-2.0-flash | `#btn-review` | Submit Review | YES | 651ms |
| gpt-4o-mini | `#btn-review` | Submit Review | YES | 639ms |

#### C. Non-Standard Element Resolution
**What:** Styled div acting as button (`<div onclick="save()">Save Changes</div>`), no aria role

| Model | Selector Returned | Resolved To | Time |
|-------|-------------------|-------------|------|
| claude-haiku-4-5 | `#save-action` | Save Changes | 629ms |
| gemini-2.0-flash | `#save-action` | Save Changes | 730ms |
| gpt-4o-mini | `#save-action` | Save Changes | 436ms |

#### D. Vision-Based Resolution
**What:** Screenshot (1280x720 PNG) sent to vision model. "Fill the search box"

| Model | Selector Returned | Valid? | Time | Notes |
|-------|-------------------|--------|------|-------|
| claude-haiku-4-5 | `input[placeholder="Search for anything..."]` | YES | 1,683ms | Correct |
| gemini-2.0-flash | `input#APjFqb` | NO | 1,101ms | **HALLUCINATED** Google.com selector from training data |
| gpt-4o-mini | `input[type="search"]` | YES | 866ms | Correct |

**Finding:** Gemini hallucinated a memorized Google search page selector instead of reading the actual screenshot. Our verification step (try the selector on the real page) correctly caught this. This proves the verification layer is essential.

#### E. Page Recovery Analysis
**What:** Page shows a login/SSO form instead of expected content. LLM diagnoses and suggests action.

| Model | Suggested Action | Detail | Time |
|-------|------------------|--------|------|
| claude-haiku-4-5 | navigate | `/dashboard` | 669ms |
| gemini-2.0-flash | wait | "Waiting for redirect after login" | 581ms |
| gpt-4o-mini | wait | "User must authenticate first" | 489ms |

All valid recovery actions. Different approaches (navigate vs wait) but all reasonable.

#### F. Full End-to-End Fallback Chain
**What:** First attempt with labeled form (aria resolves in ~21ms). Then labels removed, falls to LLM/vision.

| Model | Aria Time | LLM Fallback Time | Total | Methods Used |
|-------|-----------|-------------------|-------|--------------|
| claude-haiku-4-5 | 23ms | 8,995ms | 9,018ms | aria -> vision |
| gemini-2.0-flash | 21ms | 1,187ms | 1,208ms | aria -> vision |
| gpt-4o-mini | 21ms | 1,591ms | 1,612ms | aria -> vision |

**Finding:** Aria resolution is instant (~21ms). LLM fallback adds 1-9 seconds. The caching system means the LLM cost is only paid ONCE per new page layout - subsequent runs use cached selectors.

## Key Findings

### 1. The Fallback Chain Works
- Cached: ~0ms (read model lookup)
- Aria: ~21ms (accessibility tree search, no LLM)
- LLM (accessibility tree): ~500-800ms
- Vision (screenshot): ~900-1700ms
- 99% of runs should hit cached or aria. LLM is the safety net.

### 2. GPT-4o-mini is the Best Value
- 100% pass rate, cheapest, fastest avg response
- Good for production intent resolution

### 3. Vision Hallucination is Real
- Gemini returned a memorized Google.com selector instead of reading the screenshot
- Our selector verification step is ESSENTIAL - never trust an LLM selector without trying it
- The system handled this correctly: verification failed, moved to next strategy

### 4. Recovery Analysis Works
- All 3 models correctly identified a login page as an obstacle
- Suggested reasonable recovery actions
- Different models suggest different strategies (navigate vs wait) - both valid

### 5. CQRS/ES Provides Full Audit Trail
- Every intent attempt, resolution, fallback, recovery, and escalation is event-sourced
- SelectorCache learns from success - gets faster over time
- Full replay capability for debugging production issues

## What's NOT Tested Yet
- Real ServiceNow / DRIVE admin pages (used inline HTML)
- Selector cache persistence across process restarts
- Real modal dismissal + retry flow
- Network failure mid-LLM-call resilience
- Multiple concurrent intent executions
- Long-running page sessions with DOM mutations

## Next Steps
1. Wire IntentEngine into requote-rebind workflow (replace getByRole calls)
2. Test against real ServiceNow page - "find the correlation ID field"
3. Add API key for production LLM calls (or route through OpenRouter)
4. Record video demo of self-healing in action
5. Benchmark cached vs uncached performance over 100 runs
