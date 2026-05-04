# 🌍 Green Score — GitHub Copilot CLI Extension

Every AI token has an environmental cost. **Green Score** monitors token usage during your Copilot CLI sessions and provides a sustainability score with CO₂ estimates and actionable recommendations to reduce token consumption.

## Features

- **Real-time token tracking** — passively monitors all token flow during a session
- **Green score (0–100)** — weighted scoring based on effective token cost
- **CO₂ estimation** — rough heuristic with relatable comparisons (phone charging, LED bulbs, etc.)
- **Smart recommendations** — identifies verbose prompts, repeated patterns, inline code that could use `@file`, and refinement chains
- **Privacy-first** — all data stays in memory, never persisted to disk

## Score Ratings

| Score | Rating | Emoji |
|-------|--------|-------|
| 90+   | Excellent | 🌿 |
| 70–89 | Good | 🌱 |
| 40–69 | Moderate | 🍂 |
| 10–39 | High | 🔥 |
| 0–9   | Very High | 🏭 |

## Installation

1. Clone this repository into your Copilot CLI extensions directory:

   ```bash
   git clone https://github.com/<your-username>/green-score ~/.copilot/extensions/green-score
   ```

2. Install dependencies:

   ```bash
   cd ~/.copilot/extensions/green-score
   npm install
   ```

3. The extension loads automatically on your next Copilot CLI session.

## Usage

The extension works passively in the background. At session end, it displays a detailed report:

```
╔════════════════════════════════════════════════════════╗
║  🌍 GREEN SCORE REPORT                                ║
╠════════════════════════════════════════════════════════╣
║                                                        ║
║  Session Score:  72/100  🌱 Good                       ║
║                                                        ║
║  Token Usage:                                          ║
║    [claude-sonnet-4]                                   ║
║      Input:  12,450  Output: 8,230                     ║
║      Cache read: 3,100  write: 0                       ║
║    Effective cost: 23,780 units                         ║
║                                                        ║
║  🌿 CO₂ Estimate:  ~7.1g  (rough heuristic)           ║
║     ≈ charging a phone for 4 minutes                   ║
║                                                        ║
║  📋 Recommendations:                                   ║
║  1. Prompt #3 was 820 chars — try being more concise   ║
║  2. Prompts #5 and #7 are very similar — combine them  ║
║                                                        ║
║  ✨ Potential improved score: 81/100 (+9 pts)          ║
╚════════════════════════════════════════════════════════╝
```

You can also request a mid-session report by asking Copilot about your "green score" or "environmental impact" — this triggers the `green_score_report` tool.

## How It Works

### Token Tracking

The extension hooks into Copilot CLI session events:
- `onUserPromptSubmitted` — captures each user prompt
- `assistant.message` — records assistant response lengths
- `tool.execution_complete` — tracks tool call result sizes
- `session.shutdown` — receives exact per-model token metrics and triggers the report

### Scoring Model

Effective cost is computed with weighted tokens:

```
effectiveCost = Σ per model:
  (inputTokens × 1.0 + outputTokens × 1.0
   + cacheWriteTokens × 0.5 + cacheReadTokens × 0.1)
  × model cost multiplier
```

Score: `max(0, 100 - effectiveCost / 5000)`

### CO₂ Estimation

Uses a rough heuristic of ~0.3g CO₂ per 1,000 effective tokens. This is an approximation — actual emissions vary by model, provider, and region.

### Recommendations Engine

Analyzes prompt history to identify:
1. **Verbose prompts** — over 500 chars that could be more concise
2. **Repeated patterns** — similar prompts that could be combined
3. **Missing file attachments** — inline code that should use `@file`
4. **Refinement chains** — sequences of small corrections that could be one clear prompt

## Tech Stack

- **Runtime:** Node.js (ES modules)
- **SDK:** `@github/copilot-sdk/extension`
- **External dependencies:** None

## Privacy

- All prompt/response data is stored in memory only
- Nothing is written to disk or sent to external services
- Prompts are truncated to 80 characters in report output
- The extension is stateless across sessions

## License

ISC
