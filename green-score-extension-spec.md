# Green Score Extension — Design Spec

## Problem Statement

Every AI token has an environmental cost. This GHCP extension monitors token usage
during a Copilot CLI session and produces a "green score" at session end, along with
CO₂ equivalence estimates and actionable recommendations to reduce token consumption.

## Approach

**Event-Driven Tracker** using the Copilot CLI Extension SDK. The extension passively
listens to session events to track all token flow, then produces a report at shutdown.

## Tech Stack

- **Runtime:** Node.js (ES modules, `.mjs`)
- **SDK:** `@github/copilot-sdk/extension` (auto-resolved, no install needed)
- **Dependencies:** None (zero external deps)
- **Token data source:** `session.shutdown` event provides exact per-model token metrics
  (inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens) — no heuristics needed
- **Scope:** User-level extension (applies to all repos)

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    extension.mjs                          │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ TokenTracker │  │ GreenScorer  │  │ Recommender     │ │
│  │              │  │              │  │                 │ │
│  │ • prompts[]  │  │ • thresholds │  │ • analyzePrompts│ │
│  │ • responses[]│  │ • score()    │  │ • suggestions() │ │
│  │ • toolCalls[]│  │ • co2()      │  │ • improvScore() │ │
│  └─────────────┘  └──────────────┘  └─────────────────┘ │
│                                                           │
│  Hooks:                Events:                            │
│  • onUserPromptSubmitted   • assistant.message             │
│  • onSessionEnd            • session.shutdown              │
│                            • tool.execution_complete       │
└──────────────────────────────────────────────────────────┘
```

## Data Flow

1. **Capture phase** (during session):
   - `onUserPromptSubmitted` → record each user prompt text + timestamp
   - `assistant.message` event → record assistant response length
   - `tool.execution_complete` event → record tool call count and result sizes

2. **Score phase** (`session.shutdown` event):
   - Extract exact token metrics from `event.data.modelMetrics`
   - Compute green score using linear thresholds
   - Compute CO₂ equivalence
   - Analyze prompt history for optimization opportunities
   - Generate improvement recommendations + potential improved score
   - Display report via `session.log()`

## Component Details

### 1. TokenTracker

Stores session activity in memory:

```
prompts: Array<{ text: string, timestamp: number, charCount: number }>
assistantMessages: Array<{ charCount: number, timestamp: number }>
toolCalls: Array<{ name: string, resultSize: number }>
```

### 2. GreenScorer

**Weighted cost model** — not all tokens are equal:

```
effectiveCost = Σ per model:
  (inputTokens * 1.0 + outputTokens * 1.0
   + cacheWriteTokens * 0.5 + cacheReadTokens * 0.1)
  * model.requests.cost  (cost multiplier from SDK)
```

Scoring table (based on effectiveCost):

| Effective Cost  | Score | Rating       |
|-----------------|-------|--------------|
| < 10,000        | 90+   | 🌿 Excellent |
| 10,000–50,000   | 70–89 | 🌱 Good      |
| 50,000–150,000  | 40–69 | 🍂 Moderate  |
| 150,000–500,000 | 10–39 | 🔥 High      |
| > 500,000       | 0–9   | 🏭 Very High |

Score formula: `max(0, 100 - (effectiveCost / 5000))`

### CO₂ Equivalence

**Rough heuristic** (labeled as estimate, not precise):
- ~0.3g CO₂ per 1,000 effective tokens (average across inference providers)
- Disclaimer: "Actual emissions vary by model, provider, and region"
- Comparisons: phone charge cycles, LED bulb minutes, meters driven

### 3. Recommender

Analyzes the captured prompt history and identifies:

1. **Verbose prompts** — prompts over 500 chars (after stripping code blocks/logs)
   that could be more concise
2. **Repeated patterns** — similar prompts detected via simple fingerprinting
   (normalized lowercase words) that could be combined
3. **Missing context files** — prompts that describe code inline instead of using
   `@file` attachments
4. **Iterative refinement chains** — sequences of short follow-up corrections
   (detected by turn order + short length) that could be one clear prompt

Each recommendation includes:
- The original prompt (truncated to 80 chars, no sensitive data)
- The issue identified
- A suggested improvement
- Estimated token savings

**Privacy:** All prompt data is in-memory only, never persisted to disk.
Prompts are truncated in the report output.

The "improved green score" is computed by subtracting estimated saveable tokens.

## Report Format (Terminal)

```
╔══════════════════════════════════════════════════════╗
║           🌍 GREEN SCORE REPORT                      ║
╠══════════════════════════════════════════════════════╣
║                                                      ║
║  Session Score:  72/100  🌱 Good                     ║
║                                                      ║
║  Token Usage:                                        ║
║    Input tokens:    12,450                            ║
║    Output tokens:    8,230                            ║
║    Cache read:       3,100                            ║
║    Total:           23,780                            ║
║                                                      ║
║  🌿 CO₂ Estimate:  ~7.1g                             ║
║     ≈ charging a phone for 4 minutes                 ║
║                                                      ║
║  📋 Recommendations:                                 ║
║  1. Prompt #3 was 820 chars — could be 60% shorter   ║
║     "Explain in detail how the function..."           ║
║     → Try: "What does fn X do?"                      ║
║  2. Prompts #5 and #7 were similar — combine them    ║
║                                                      ║
║  Potential improved score: 81/100 (+9 points)        ║
╚══════════════════════════════════════════════════════╝
```

## File Structure

```
~/.copilot/extensions/green-score/
  extension.mjs          ← Single file, all logic
```

## Lifecycle & Race Handling

- Both `session.shutdown` event and `onSessionEnd` hook may fire
- A shared `reportFlushed` boolean guard ensures the report is emitted exactly once
- `flushReport()` is idempotent — safe to call from both paths
- `session.shutdown` is preferred (has full metrics); `onSessionEnd` is partial fallback
  using character-based estimation from in-memory data
- All handlers wrapped in try/catch to never crash the extension

## Privacy

- All prompt/response data stored in memory only, never written to disk
- Prompts truncated to 80 chars in report output
- No secrets/paths/code content included in recommendations
- Extension is user-scoped but stateless across sessions

## Error Handling

- If `session.shutdown` doesn't fire (crash), `onSessionEnd` hook serves as fallback
  with partial data from in-memory tracking
- Missing token data gracefully falls back to character-based estimation

## Testing Strategy

- Manual testing via running the extension in GHCP CLI
- Verify extension loads: `/env` command should list it
- Verify report appears on session exit
- Test with short and long sessions to validate scoring thresholds
