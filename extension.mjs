// Extension: green-score
// Every token of AI has a green cost. Monitors token usage and provides
// a green sustainability score with CO₂ estimates and optimization recommendations.

import { joinSession } from "@github/copilot-sdk/extension";

// ─── In-Memory Token Tracker ───────────────────────────────────────────────

const tracker = {
    prompts: [],          // { text, timestamp, charCount }
    assistantMessages: [], // { charCount, timestamp }
    toolCalls: [],        // { name, resultSize }
    sessionStartTime: Date.now(),
};

function trackPrompt(text, timestamp) {
    tracker.prompts.push({
        text,
        timestamp,
        charCount: text.length,
    });
}

function trackAssistantMessage(content) {
    tracker.assistantMessages.push({
        charCount: (content || "").length,
        timestamp: Date.now(),
    });
}

function trackToolCall(name, resultSize) {
    tracker.toolCalls.push({ name, resultSize });
}

// ─── Green Scorer ──────────────────────────────────────────────────────────

const RATINGS = [
    { max: 10000,  emoji: "🌿", label: "Excellent" },
    { max: 50000,  emoji: "🌱", label: "Good" },
    { max: 150000, emoji: "🍂", label: "Moderate" },
    { max: 500000, emoji: "🔥", label: "High" },
    { max: Infinity, emoji: "🏭", label: "Very High" },
];

function computeEffectiveCost(modelMetrics) {
    let total = 0;
    for (const [, model] of Object.entries(modelMetrics || {})) {
        const u = model.usage || {};
        const costMultiplier = model.requests?.cost || 1;
        const weighted =
            (u.inputTokens || 0) * 1.0 +
            (u.outputTokens || 0) * 1.0 +
            (u.cacheWriteTokens || 0) * 0.5 +
            (u.cacheReadTokens || 0) * 0.1;
        total += weighted * costMultiplier;
    }
    return total;
}

function computeScore(effectiveCost) {
    return Math.max(0, Math.round(100 - effectiveCost / 5000));
}

function getRating(score) {
    if (score >= 90) return RATINGS[0];
    if (score >= 70) return RATINGS[1];
    if (score >= 40) return RATINGS[2];
    if (score >= 10) return RATINGS[3];
    return RATINGS[4];
}

function estimateCO2(effectiveCost) {
    const grams = (effectiveCost / 1000) * 0.3;
    return grams;
}

function co2Comparison(grams) {
    if (grams < 1) return `≈ an LED bulb running for ${Math.max(1, Math.round(grams * 60))} seconds`;
    if (grams < 10) return `≈ charging a phone for ${Math.round(grams * 0.6)} minutes`;
    if (grams < 100) return `≈ driving a car for ${Math.round(grams * 0.04)} meters`;
    return `≈ boiling ${Math.round(grams / 100)} cups of water`;
}

// ─── Prompt Recommender ────────────────────────────────────────────────────

function stripCodeBlocks(text) {
    return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`]+`/g, "").trim();
}

function fingerprint(text) {
    return stripCodeBlocks(text).toLowerCase().split(/\s+/).sort().join(" ");
}

function truncate(text, max = 80) {
    const clean = text.replace(/\n/g, " ").trim();
    return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function generateRecommendations(prompts) {
    const recs = [];

    // 1. Verbose prompts (>500 chars after stripping code)
    prompts.forEach((p, i) => {
        const stripped = stripCodeBlocks(p.text);
        if (stripped.length > 500) {
            recs.push({
                promptIndex: i + 1,
                issue: "Verbose prompt",
                detail: `Prompt #${i + 1} was ${p.charCount} chars — try being more concise`,
                original: truncate(p.text),
                savings: Math.round(p.charCount * 0.4),
            });
        }
    });

    // 2. Repeated patterns (similar fingerprints)
    const seen = new Map();
    prompts.forEach((p, i) => {
        const fp = fingerprint(p.text);
        if (fp.length < 10) return;
        const prev = seen.get(fp);
        if (prev !== undefined) {
            recs.push({
                promptIndex: i + 1,
                issue: "Repeated prompt",
                detail: `Prompts #${prev + 1} and #${i + 1} are very similar — combine them`,
                original: truncate(p.text),
                savings: Math.round(p.charCount * 0.8),
            });
        } else {
            seen.set(fp, i);
        }
    });

    // 3. Missing file attachments (mentions file paths but no @ reference)
    prompts.forEach((p, i) => {
        const mentionsFile = /\.(js|ts|py|mjs|json|md|yaml|yml|css|html|jsx|tsx)\b/.test(p.text);
        const hasInlineCode = (p.text.match(/```/g) || []).length >= 2;
        if (mentionsFile && hasInlineCode && p.charCount > 300) {
            recs.push({
                promptIndex: i + 1,
                issue: "Inline code instead of file attachment",
                detail: `Prompt #${i + 1} pastes code inline — use @file to attach instead`,
                original: truncate(p.text),
                savings: Math.round(p.charCount * 0.6),
            });
        }
    });

    // 4. Iterative refinement chains (3+ short follow-ups in a row)
    let chainStart = -1;
    let chainLen = 0;
    prompts.forEach((p, i) => {
        if (p.charCount < 100 && i > 0) {
            if (chainLen === 0) chainStart = i;
            chainLen++;
        } else {
            if (chainLen >= 3) {
                recs.push({
                    promptIndex: chainStart + 1,
                    issue: "Refinement chain",
                    detail: `Prompts #${chainStart + 1}–#${chainStart + chainLen} are small corrections — try one clear prompt instead`,
                    original: truncate(prompts[chainStart].text),
                    savings: chainLen * 80,
                });
            }
            chainLen = 0;
        }
    });
    if (chainLen >= 3) {
        recs.push({
            promptIndex: chainStart + 1,
            issue: "Refinement chain",
            detail: `Prompts #${chainStart + 1}–#${chainStart + chainLen} are small corrections — try one clear prompt instead`,
            original: truncate(prompts[chainStart].text),
            savings: chainLen * 80,
        });
    }

    return recs;
}

// ─── Report Renderer ───────────────────────────────────────────────────────

function renderReport(metrics, effectiveCost, score, rating, co2, recs, improvedScore) {
    const lines = [];
    const w = 56;
    const hr = "═".repeat(w);
    const pad = (s) => s + " ".repeat(Math.max(0, w - s.length));

    lines.push(`╔${hr}╗`);
    lines.push(`║${pad("  🌍 GREEN SCORE REPORT")}║`);
    lines.push(`╠${hr}╣`);
    lines.push(`║${pad("")}║`);
    lines.push(`║${pad(`  Session Score:  ${score}/100  ${rating.emoji} ${rating.label}`)}║`);
    lines.push(`║${pad("")}║`);

    // Token breakdown per model
    lines.push(`║${pad("  Token Usage:")}║`);
    for (const [name, model] of Object.entries(metrics || {})) {
        const u = model.usage || {};
        const shortName = name.length > 30 ? name.slice(0, 30) + "…" : name;
        lines.push(`║${pad(`    [${shortName}]`)}║`);
        lines.push(`║${pad(`      Input:  ${(u.inputTokens || 0).toLocaleString()}  Output: ${(u.outputTokens || 0).toLocaleString()}`)}║`);
        lines.push(`║${pad(`      Cache read: ${(u.cacheReadTokens || 0).toLocaleString()}  write: ${(u.cacheWriteTokens || 0).toLocaleString()}`)}║`);
    }
    lines.push(`║${pad(`    Effective cost: ${Math.round(effectiveCost).toLocaleString()} units`)}║`);
    lines.push(`║${pad("")}║`);

    // CO₂
    lines.push(`║${pad(`  🌿 CO₂ Estimate:  ~${co2.toFixed(1)}g  (rough heuristic)`)}║`);
    lines.push(`║${pad(`     ${co2Comparison(co2)}`)}║`);
    lines.push(`║${pad("     * Actual emissions vary by model/provider/region")}║`);
    lines.push(`║${pad("")}║`);

    // Recommendations
    if (recs.length > 0) {
        lines.push(`║${pad("  📋 Recommendations:")}║`);
        recs.slice(0, 5).forEach((r, i) => {
            lines.push(`║${pad(`  ${i + 1}. ${r.detail}`)}║`);
            lines.push(`║${pad(`     "${r.original}"`)}║`);
        });
        lines.push(`║${pad("")}║`);
        lines.push(`║${pad(`  ✨ Potential improved score: ${improvedScore}/100 (+${improvedScore - score} pts)`)}║`);
    } else {
        lines.push(`║${pad("  ✨ Great job! No major optimization suggestions.")}║`);
    }

    lines.push(`║${pad("")}║`);
    lines.push(`╚${hr}╝`);
    return lines.join("\n");
}

// ─── Lifecycle & Flush ─────────────────────────────────────────────────────

let reportFlushed = false;

async function flushReport(modelMetrics) {
    if (reportFlushed) return;
    reportFlushed = true;

    try {
        let effectiveCost;
        let metrics;

        if (modelMetrics && Object.keys(modelMetrics).length > 0) {
            metrics = modelMetrics;
            effectiveCost = computeEffectiveCost(metrics);
        } else {
            // Fallback: estimate from in-memory character data
            const totalChars =
                tracker.prompts.reduce((s, p) => s + p.charCount, 0) +
                tracker.assistantMessages.reduce((s, m) => s + m.charCount, 0);
            effectiveCost = totalChars / 4; // ~4 chars per token
            metrics = {
                "estimated": {
                    usage: {
                        inputTokens: Math.round(tracker.prompts.reduce((s, p) => s + p.charCount, 0) / 4),
                        outputTokens: Math.round(tracker.assistantMessages.reduce((s, m) => s + m.charCount, 0) / 4),
                        cacheReadTokens: 0,
                        cacheWriteTokens: 0,
                    },
                    requests: { cost: 1 },
                },
            };
        }

        const score = computeScore(effectiveCost);
        const rating = getRating(score);
        const co2 = estimateCO2(effectiveCost);
        const recs = generateRecommendations(tracker.prompts);
        const totalSavings = recs.reduce((s, r) => s + r.savings, 0);
        const improvedCost = Math.max(0, effectiveCost - totalSavings);
        const improvedScore = computeScore(improvedCost);

        const report = renderReport(metrics, effectiveCost, score, rating, co2, recs, improvedScore);
        await session.log(report);
    } catch (err) {
        await session.log(`Green Score: error generating report — ${err.message}`, { level: "error" });
    }
}

// ─── Session Setup ─────────────────────────────────────────────────────────

const session = await joinSession({
    hooks: {
        onUserPromptSubmitted: async (input) => {
            try {
                trackPrompt(input.prompt || "", input.timestamp);
            } catch { /* never crash */ }
        },
        onSessionEnd: async (input) => {
            try {
                // Fallback path — no modelMetrics available here
                await flushReport(null);
            } catch { /* never crash */ }
        },
    },
    tools: [
        {
            name: "green_score_report",
            description: "Show the current green score report with token usage, CO₂ estimate, and optimization recommendations for this session so far. Call this when the user asks about their green score or environmental impact.",
            parameters: { type: "object", properties: {} },
            skipPermission: true,
            handler: async () => {
                const totalChars =
                    tracker.prompts.reduce((s, p) => s + p.charCount, 0) +
                    tracker.assistantMessages.reduce((s, m) => s + m.charCount, 0);
                const effectiveCost = totalChars / 4;
                const metrics = {
                    "estimated (mid-session)": {
                        usage: {
                            inputTokens: Math.round(tracker.prompts.reduce((s, p) => s + p.charCount, 0) / 4),
                            outputTokens: Math.round(tracker.assistantMessages.reduce((s, m) => s + m.charCount, 0) / 4),
                            cacheReadTokens: 0,
                            cacheWriteTokens: 0,
                        },
                        requests: { cost: 1 },
                    },
                };
                const score = computeScore(effectiveCost);
                const rating = getRating(score);
                const co2 = estimateCO2(effectiveCost);
                const recs = generateRecommendations(tracker.prompts);
                const totalSavings = recs.reduce((s, r) => s + r.savings, 0);
                const improvedScore = computeScore(Math.max(0, effectiveCost - totalSavings));
                return renderReport(metrics, effectiveCost, score, rating, co2, recs, improvedScore);
            },
        },
    ],
});

// ─── Event Listeners ───────────────────────────────────────────────────────

session.on("assistant.message", (event) => {
    try {
        trackAssistantMessage(event.data?.content);
    } catch { /* never crash */ }
});

session.on("tool.execution_complete", (event) => {
    try {
        const resultSize = JSON.stringify(event.data?.result || "").length;
        trackToolCall(event.data?.toolName, resultSize);
    } catch { /* never crash */ }
});

session.on("session.shutdown", async (event) => {
    try {
        await flushReport(event.data?.modelMetrics);
    } catch { /* never crash */ }
});

await session.log("🌍 Green Score extension loaded — tracking token usage");
