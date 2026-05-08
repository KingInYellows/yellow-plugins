# Multi-LLM Ensemble Code Review: Four-CLI Deep Dive (Subscription-Auth Edition)

**Date:** 2026-05-08
**Architecture:** Claude Code orchestrator + in-process Claude reviewer subagent + 3 subprocess CLI reviewers (Codex, Gemini, OpenCode)
**Auth model:** Subscription auth across all four lineages (Claude Pro/Max, ChatGPT Plus/Pro, Gemini Advanced/AI Studio, OpenCode → non-Big-3 subscription provider)
**Sources:** Ceramic search (10 result sets), Claude Code CHANGELOG v2.1.92, Codex CLI CHANGELOG rust-v0.93.x, OpenCode CHANGELOG Feb 2026, prior research doc (yellow-council-multi-agent-code-review-p.md, 2026-05-08), academic papers (Zheng 2023, Du 2023/ICML 2024, Shinn NeurIPS 2023, Wang 2024, Wynn 2025, MetaGPT, AgentAuditor)

---

## Executive Summary

1. **Subscription auth changes the ensemble economics fundamentally.** Per-token cost comparisons (the centerpiece of every prior multi-LLM review study) are irrelevant when each reviewer runs against a fixed-price subscription. The new optimization target is **rate-limit headroom per window** (Claude 5h/weekly resets, ChatGPT message caps, Gemini Advanced ~1,500 msg/day, OpenCode provider-dependent). Quota exhaustion mid-review is a real production failure mode that does not exist in the pay-per-token world.

2. **The four-CLI architecture is asymmetric, and that's correct.** Claude Code is both the orchestrator and one of the four reviewer slots — invoked in-process via the `Task` tool with a `claude-reviewer` agent definition. The other three (Codex, Gemini, OpenCode) are subprocess CLI invocations. This asymmetry is the right design: the in-process Claude reviewer reuses the orchestrator's auth/session at zero overhead; the three subprocess CLIs give true OS-level isolation, independent auth state, and lineage separation. The synthesizer remains in-process Claude.

3. **Lineage diversity is now achievable across four families.** With OpenCode wired to a non-Anthropic/OpenAI/Google provider (DeepSeek, xAI Grok, or similar), yellow-council can deliver four genuinely orthogonal lineages: Anthropic / OpenAI / Google / Other. CLI choice alone still does not guarantee diversity (any of the four CLIs can wrap any model), but the recommended slot assignment locks one model family per slot.

4. **Self-enhancement bias is now the #1 quality risk.** Claude is both reviewer slot 1 AND the synthesizer. Zheng 2023 showed Claude-v1 has 23.8% swap-consistency on identical findings with order swap — combined with self-enhancement bias (~10-15% above-chance lineage favoritism), the synthesizer will systematically upweight the Claude reviewer's findings without active mitigation. Two-pass order-swap + double-blind lineage labels are mandatory, not optional.

5. **Round caps are unchanged.** Du et al. ICML 2024 / Shinn Reflexion NeurIPS 2023: 3 reviewers × 2 rounds is optimal; round 3 is within noise; round 2 without a verify-first gate is harmful in expectation. yellow-council's V1 single-shot architecture is correct as a default; V2's `--round 2` must include the gate.

6. **OpenCode session lifecycle is still a production concern.** The 318 GB disk-leak root cause (snapshot system) is not confirmed fixed in the Feb 2026 changelog. yellow-council V1 already does explicit `opencode session delete <id>` cleanup — keep that. Subscription auth does not change this risk; the disk leak is local SQLite, not provider-side.

---

## Dimension 1: Architecture Shape (Asymmetric Four-CLI)

### Why asymmetric, not symmetric

A symmetric design would invoke all four CLIs as subprocesses (`claude -p`, `codex exec`, `gemini -p`, `opencode run`). This is what V1 implicitly assumes for the three external reviewers. Adding a *fourth* `claude -p` subprocess for the Claude reviewer would:

- Spawn a separate Claude conversation independent of the orchestrator (good: independence)
- Consume a second slot of the user's Claude subscription quota for every review (bad: ~2x quota usage)
- Add ~2 seconds of CLI startup latency vs. zero for in-process Task spawn (bad: latency)
- Require auth-state separation between orchestrator and reviewer Claude sessions (bad: complexity)

The asymmetric shape — in-process Task subagent for Claude, subprocess CLIs for the other three — is strictly better when the orchestrator is already running inside Claude Code, which is the user's deployment.

### Architecture diagram

```
                    User invokes /council <mode>
                              │
                              ▼
                  ┌───────────────────────┐
                  │  Claude Code (this)   │   ← orchestrator
                  │   /council command    │
                  └───────────┬───────────┘
                              │ Task tool fan-out (parallel)
          ┌───────┬───────────┼───────────┬───────┐
          ▼       ▼           ▼           ▼       │
       ┌──────┐┌──────────┐┌─────────┐┌──────────┐│
       │claude││codex     ││gemini   ││opencode  ││
       │revwr ││reviewer  ││reviewer ││reviewer  ││
       │(in-  ││(spawns   ││(spawns  ││(spawns   ││
       │ proc)││ codex CLI││ gemini  ││ opencode ││
       │      ││ subproc) ││ CLI)    ││ CLI)     ││
       └──┬───┘└────┬─────┘└────┬────┘└─────┬────┘│
          │        │           │           │     │
          ▼        ▼           ▼           ▼     │
         Claude   ChatGPT    Gemini      DeepSeek│
         (Sonnet/ (GPT-5/   (3.x Pro)   /Grok    │
          Opus)    o4)                  /etc.    │
                                                 │
       4 verdicts + findings ◄───────────────────┘
                              │
                              ▼
                  ┌───────────────────────┐
                  │  Synthesizer (in-proc)│
                  │  Claude (orchestrator)│
                  │  + 2-pass order-swap  │
                  │  + double-blind labels│
                  └───────────┬───────────┘
                              ▼
                docs/council/<date>-<mode>-<slug>.md
```

### Lineage map

| Slot | Spawn shape | CLI / agent | Default model | Lineage |
|---|---|---|---|---|
| Reviewer 1 | In-process `Task` | `claude-reviewer` agent | claude-sonnet-4-6 (or opus-4-6) | Anthropic |
| Reviewer 2 | Subprocess `codex exec` | `codex-reviewer` (yellow-codex) | gpt-5.3-codex | OpenAI |
| Reviewer 3 | Subprocess `gemini -p` | `gemini-reviewer` | gemini-2.5-pro (or 3.x) | Google |
| Reviewer 4 | Subprocess `opencode run` | `opencode-reviewer` | DeepSeek V3.2 / xAI Grok 4 / etc. | Non-Big-3 |
| Synthesizer | In-process (orchestrator) | Claude Code itself | claude-opus-4-6 (with double-blind labels) | Anthropic |

---

## Dimension 2: Per-CLI Invocation Contracts (Subscription Auth)

### Claude Code (in-process reviewer slot)

**Spawn shape:** Task tool, agent definition `yellow-council:review:claude-reviewer`

**Why in-process:** the orchestrator is already running inside Claude Code with the user's subscription auth attached. A subprocess `claude -p` would either reuse the same auth (no isolation gain) or require a separate login (auth-state complexity). Task-spawned subagents run with their own conversation context (fresh prompt, no orchestrator history) but share the parent Claude session — which is the right tradeoff: independent reasoning, single quota debit, zero subprocess latency.

**Auth:** Inherited from orchestrator's Claude Code session (`~/.claude.json` OAuth or API key). No separate auth required.

**Quota debit:** Every reviewer turn counts against the orchestrator's Claude subscription window (5h limit for Pro, weekly for Max). Two consecutive `/council` invocations within 5h could exhaust Pro quota.

**Isolation:** Separate conversation context (the subagent doesn't see orchestrator history), but same auth/billing/rate-limit bucket.

**Output contract:** Same structured `verdict=` / `confidence=` / `summary=` / `findings_block_*` format the existing reviewers use. Match the existing protocol exactly so synthesis logic is reused.

**Caching:** Anthropic prompt caching at `cache_control` ≥1,024 tokens. Even on subscription, caching reduces TTFT — claim the cache by sending the core-pack as a stable prefix.

**Output stability:** High — Task-spawned agents have a stable contract (return value is the agent's final message). No CLI version-drift risk.

---

### Codex CLI (subprocess reviewer slot)

**Version (May 2026):** rust-v0.93.x (openai/codex). Default model: `gpt-5.3-codex` (272K context).

**Subscription auth:** ChatGPT Plus/Pro account login via `codex login` → routes through ChatGPT subscription quota instead of API billing. As of recent Codex CLI, this is the supported path for paid users who don't want to set up API keys.

**Headless invocation (yellow-council uses):**
```bash
codex exec --json \
  --approval-policy never \
  --sandbox-mode read-only \
  --model gpt-5.3-codex \
  "<pack>"
```

**Quota debit:** Each `codex exec` turn counts against ChatGPT subscription message cap. ChatGPT Plus message limits are tier-dependent and capped per 3-hour rolling window. Codex CLI sessions count separately from chatgpt.com web usage but share the same monthly cap on most tiers.

**Isolation:** Full subprocess isolation. Separate auth state (`~/.codex/auth.json`), separate session log (`--log-db`), Seatbelt/Landlock OS-level sandbox.

**Output stability:** Medium. Rust rewrite is stable but JSON output schema is not formally versioned. Pin to a specific Rust release tag.

**Quota-exhaustion failure mode:** When ChatGPT subscription cap is hit, Codex CLI returns a structured error. yellow-council must distinguish this from network 429 — the recovery path is "wait until window resets," not "retry with backoff."

---

### Gemini CLI (subprocess reviewer slot)

**Version (May 2026):** Active OSS [stale: Dec 2025 confirmed; May 2026 exact version unverified]. Default model: `gemini-2.5-pro` (or 3.x Pro when generally available).

**Subscription auth:** Google OAuth login (free tier: 60 req/min, 1,000 req/day). Gemini Advanced subscription gives higher caps. Vertex AI is the enterprise path. yellow-council assumes the user has either free-tier OAuth or Gemini Advanced.

**Headless invocation (yellow-council uses):**
```bash
gemini -p "<pack>" --approval-mode plan --skip-trust -o text
```

**Quota debit:** Counts against Gemini Advanced subscription daily message cap (~1,500 msg/day on the consumer plan; higher on AI Pro/Ultra). Free tier is 60 RPM / 1,000 RPD hard caps.

**Known issue (yellow-council CLAUDE.md confirms):** First non-interactive use in WSL2 may hang indefinitely. Workaround: run `gemini -p "test"` interactively once per session. The 600s timeout will catch a wedged invocation.

**Isolation:** Subprocess-level. Separate auth state (`~/.gemini/`). No native OS sandbox (relies on the `--approval-mode plan` plus `--skip-trust` to keep behavior read-only).

**Output stability:** Lower than Claude Code or Codex CLI. Pin to a specific git tag or npm version.

**Quota-exhaustion failure mode:** Free tier returns HTTP 429 when caps hit; Gemini Advanced returns a subscription-specific error. Recovery: wait for daily reset (24h windows).

---

### OpenCode (subprocess reviewer slot — wired to non-Big-3 lineage)

**Version (May 2026):** sst/opencode, active development.

**Subscription auth — recommended provider mapping:** OpenCode's value in this architecture is provider-agnosticism. To make the 4th lineage genuinely orthogonal to Anthropic/OpenAI/Google, route OpenCode to one of:

| Provider | Subscription path | Lineage |
|---|---|---|
| DeepSeek | DeepSeek API subscription (cheaper than per-token) | Chinese, distinct training corpus |
| xAI Grok | xAI subscription via grok.com | Independent training, different RLHF |
| Mistral | Mistral subscription | European, distinct alignment |
| GitLab AI Gateway | Enterprise GitLab subscription | Wraps multiple providers |
| Local model via Ollama | $0 if user has local GPU | True air-gapped lineage |

The "fourth lineage" choice is a deployment-time configuration. yellow-council should accept it as `COUNCIL_OPENCODE_PROVIDER` env var (default: whatever the user has wired in OpenCode's own config).

**Headless invocation (yellow-council currently uses):**
```bash
opencode run --format json --variant high "<pack>"
opencode session delete "<id>"   # cleanup
```

**Quota debit:** Provider-dependent. With DeepSeek/Mistral subscriptions, quotas are typically rate-limited (RPM) rather than hard daily caps. With local Ollama, no quota at all.

**Session lifecycle (still critical):** 318 GB disk-leak root cause not confirmed fixed in Feb 2026 changelog. yellow-council V1's explicit `opencode session delete` cleanup is the right pattern — keep it.

**Output stability:** Medium. Feb 2026 changelog added Claude Agent SDK structured outputs support, which yellow-council can leverage if/when integrating the OpenCode SDK.

---

## Dimension 3: Four-CLI Comparison Matrix (Subscription-Auth Framing)

| Dimension | Claude Code (in-proc) | Codex CLI | Gemini CLI | OpenCode |
|---|---|---|---|---|
| **Spawn shape** | Task subagent (in-process) | `codex exec --json` subprocess | `gemini -p ... -o text` subprocess | `opencode run --format json` subprocess |
| **Auth model** | Inherited from orchestrator | `codex login` (ChatGPT account) | Google OAuth | Provider-specific |
| **Quota window** | Shared with orchestrator (5h Pro / weekly Max) | ChatGPT 3h rolling + monthly | Gemini Advanced daily | Provider-dependent |
| **Quota-exhaust signal** | Same as orchestrator (rare in practice) | Structured error from `codex exec` | HTTP 429 or subscription error | Provider-specific |
| **Subprocess startup** | 0s (in-process) | ~2s | ~1.5s | ~3s |
| **OS-level sandbox** | None (Task tool surface) | Seatbelt (macOS) / Landlock (Linux) | None | None |
| **MCP support** | Native | Live (Feb 2026) | Native | Supported |
| **Session state** | Orchestrator's Claude session | SQLite log DB | `~/.gemini/` | SQLite + snapshots ⚠️ |
| **Cleanup required** | No | No | No | YES (`session delete`) |
| **Disk leak risk** | None | Low | Low | HIGH (318 GB documented) |
| **Output schema stability** | High (Task tool contract) | Medium (Rust v0.93+ stable) | Lower (early-stage CLI) | Medium (SDK structured outputs new Feb 2026) |
| **Default model** | claude-sonnet-4-6 | gpt-5.3-codex | gemini-2.5-pro | (deployment-configured) |
| **Default lineage** | Anthropic | OpenAI | Google | Non-Big-3 (recommended) |
| **Best for** | Orchestrator-aligned reasoning, fast iteration | Sandboxed read-only reviews, deep analysis | Long-context reviews (200K+), multimodal | Provider rotation, lineage extension |

---

## Dimension 4: Lineage Diversity (Now Achievable, Requires Configuration)

### The argument (unchanged from prior doc)

Du et al. ICML 2024 showed that multi-agent debate with diverse model families catches a strictly larger class of defects than homogeneous pools (correlated hallucinations cancel across families). MetaGPT X shuffled-majority voting: 46.67% SWE-Bench Lite. AgentAuditor +5%. Wynn 2025: beyond round 2, social conformity dominates — minority models abandon correct positions under majority pressure.

### What changes for the four-CLI subscription-auth architecture

**Diversity is now operationally trivial to achieve and equally trivial to lose.** Each CLI has a default model that matches its native lineage (Claude Code → Anthropic, Codex CLI → OpenAI, Gemini CLI → Google, OpenCode → user-configured). If the user accepts defaults *and* configures OpenCode to a non-Big-3 provider, four-lineage diversity is automatic.

**Failure modes to enforce against:**
- User configures all four CLIs to point at GPT-5 (e.g., for benchmarking) → diversity collapses to 1
- User configures OpenCode to Anthropic Bedrock → 3 of 4 reviewers are Anthropic
- User configures Codex CLI's `oss_provider` to point at the same local model as OpenCode → duplicate

**Recommended enforcement in yellow-council V2:** add a startup assertion that emits a warning if two reviewer slots resolve to the same model family. Detection is best-effort (each CLI exposes model info differently), but a check is better than silent diversity collapse.

### Why CLI choice doesn't matter for lineage (revisited)

The prior doc argued that CLI choice doesn't guarantee diversity because all four CLIs can wrap any model. This is still true. But under the asymmetric architecture where Claude Code is in-process and the others are subprocess, the CLI choice does encode a *deployment hint* about which lineage is expected — Claude Code's default is Anthropic and the user is unlikely to repoint it. Defaults matter when the user follows them.

---

## Dimension 5: Subscription Auth — Quota Headroom and Failure Modes

This dimension replaces the prior doc's "CLI-vs-API decision matrix." Direct API is off the table for this user; the relevant analysis is per-CLI quota headroom.

### Per-CLI quota model (May 2026)

| CLI | Quota unit | Window | Typical cap (consumer) | Cap (premium) |
|---|---|---|---|---|
| Claude Code | Messages | 5-hour rolling (Pro) / Weekly (Max) | Pro: ~45 messages / 5h | Max 5x: ~225 / 5h; Max 20x: ~900 / 5h |
| Codex CLI | ChatGPT messages | 3-hour rolling | Plus: tier-dependent; Pro: higher | Pro/Team: significantly higher |
| Gemini CLI | API requests | Daily | Free OAuth: 60 RPM, 1,000 RPD | Gemini Advanced: ~1,500 msg/day; Pro/Ultra higher |
| OpenCode | Provider-dependent | Provider-dependent | DeepSeek API: typically RPM-limited; Ollama: none | Provider-specific |

[unverified: exact subscription caps fluctuate; verify against current provider docs at deployment time]

### Quota-exhaustion failure model

A `/council review` invocation costs roughly:
- 1 Claude message (in-process reviewer) + 1 Claude message (synthesis) = 2 Claude debit per review
- 1 ChatGPT message (Codex reviewer)
- 1 Gemini message (Gemini reviewer)
- 1 provider message (OpenCode reviewer)

For a Claude Pro user (45 msg / 5h), running `/council` costs 2 messages — the user can run ~22 reviews per 5-hour window before exhausting Claude quota. Adding multiple turns (e.g., V2 round-2) doubles this cost.

**Critical implication:** quota exhaustion under subscription auth fails *fast* (single review hits cap → cap stays hit until window resets). This is materially different from API rate limits, which are recoverable with backoff.

### Quota tracking (recommendation)

V2 should track per-reviewer quota headroom in `~/.config/yellow-council/quota.json`:

```json
{
  "claude": { "used": 12, "cap": 45, "window_start": "2026-05-08T14:00:00Z", "window_hours": 5 },
  "codex": { "used": 8, "cap": 80, "window_start": "2026-05-08T15:30:00Z", "window_hours": 3 },
  "gemini": { "used": 230, "cap": 1500, "window_start": "2026-05-08T00:00:00Z", "window_hours": 24 },
  "opencode": { "used": "n/a", "provider": "deepseek-v3.2" }
}
```

Pre-flight check: if any reviewer's headroom is `< 2 * messages_per_review`, warn the user and offer `/council` skip-this-reviewer mode.

[unverified: programmatic quota query is not available for most subscription tiers; tracking is heuristic — increment on each invocation, reset on window expiry, and recalibrate when a reviewer returns a quota-exhausted error]

### Recovery from quota exhaustion mid-review

| Failure | Detection | Recovery |
|---|---|---|
| Claude quota exhausted (in-process reviewer or synthesizer) | Anthropic API error + structured response from Task | Mark reviewer/synthesizer as UNAVAILABLE; surface in headline; do NOT retry until window reset |
| ChatGPT quota exhausted (Codex) | `codex exec` returns subscription error | Mark Codex UNAVAILABLE; council continues with remaining 3 reviewers |
| Gemini quota exhausted | HTTP 429 or subscription error in `gemini -p` output | Mark Gemini UNAVAILABLE; council continues |
| OpenCode provider quota | Provider-specific error in `opencode run` output | Mark OpenCode UNAVAILABLE; council continues |

The graceful-degradation pattern (council runs with N-of-4 reviewers when one fails) is already in V1 — this is just a new failure category to feed into the same handler.

---

## Dimension 6: Consensus Aggregation (Unchanged Core)

The literature is stable and the prior doc's recommendations carry forward unchanged:

- **Lineage-weighted majority-of-quorum** as baseline (equal weights at start, update with historical TP rates per category)
- **No unconstrained debate** (Du et al. ICML 2024 — social conformity past round 2)
- **Verify-first gate** on round-2 trigger (Shinn Reflexion NeurIPS 2023 — EIR drops to ~0%)
- **Pairwise judge with order-swap** for minority high-severity findings (Zheng 2023 — GPT-4 swap-consistent only 65% of cases)

### Diminishing returns (Shinn Reflexion, NeurIPS 2023)

| Round | Accuracy Gain |
|---|---|
| Round 1 | +6.00 pp |
| Round 2 | +1.66 pp (only with verify-first gate) |
| Round 3 | +1.03 pp (within noise) |

**For yellow-council:** V1's single-shot architecture is the correct default. V2's `--round 2` flag must include the gate. Round 3 should not be implemented.

### Self-enhancement bias under the asymmetric architecture

This is the new top-of-list quality risk: **Claude is both Reviewer 1 and the synthesizer.** Without mitigation, the synthesizer favors Claude-reviewer findings 10-15% above chance (Zheng 2023, "Judging LLM-as-a-Judge"). Combined with the 23.8% positional swap-consistency for Claude, the synthesis output is essentially Claude voting for Claude with some noise.

**Required mitigations (V2 mandatory before any quality claim):**
1. **Two-pass order-swap.** Synthesize findings A→B then B→A, average. Flag >15% variance as "low-confidence synthesis."
2. **Double-blind lineage labels.** Strip CLI/model identity before synthesis. Present to synthesizer as "Reviewer 1/2/3/4." Restore identity in final output for attribution.
3. **Length-controlled scoring.** Normalize finding score by length to prevent verbosity bias inflation.

---

## Dimension 7: Quote and Evidence Verification (Unchanged)

**Tier 1 — Structural exact match (~0% FP, ~30% FN):** `git show <commit>:<file>` verbatim line match.

**Tier 2 — Fuzzy alignment (~2% FP, ~12% FN):** `diff-match-patch` (Google, MIT): Myers' diff + Bitap, ≥85% threshold.

**Tier 3 — AST match (~0.5% FP, ~20% FN):** `ast-grep` pattern-based structural matching. Semgrep Pro upgrade: 48% → 72% TP on WebGoat via cross-file analysis.

**Discard policy:** Any finding failing all three tiers is discarded or downgraded to "unverified suggestion." Never surface at the same confidence level as verified findings.

For yellow-council V2, the verification cascade should run inside the synthesis step, before the "Agreement" section is constructed. Findings cited by 2+ reviewers but failing all tiers should be moved to a separate "Unverified Claims" section, not "Agreement."

---

## Dimension 8: Prompt Caching (Latency Lever, Cost-Neutral Under Subscription)

Under subscription auth, caching does not save money — it saves time. Cache hits reduce TTFT (time to first token) by ~80-90%, which matters for council UX (4 reviewers in parallel still wait on the slowest).

| Provider | Mechanism | Threshold | TTFT improvement |
|---|---|---|---|
| Anthropic (Claude reviewer + synthesizer) | Explicit `cache_control: {type: "ephemeral"}` on stable prefix | ≥1,024 tokens | Up to 90% TTFT reduction |
| OpenAI (Codex CLI) | Auto prefix caching | ≥1,024 tokens | Up to 80% reduction |
| Google (Gemini CLI) | Implicit infrastructure caching | ≥200K tokens (3.x) | Up to 90% reduction at threshold |
| OpenCode | Pass-through (depends on routed provider) | Provider-dependent | Provider-dependent |

**Core-pack strategy:** Send a stable prefix (`## Repo Conventions` + truncated CLAUDE.md + style guide) to all four reviewers as the leading bytes of the pack. Subsequent `/council` invocations within the cache TTL get warm-cache reads.

**Speculative pre-warming:** Pre-submit the core-pack to each provider immediately after `git fetch`/argument parsing, before diff extraction completes. Measured 90.7% TTFT reduction (20.87s → 1.94s) in prior research.

**Cache invalidation under subscription auth:** Subscription quota debits still happen on cache hits (the request is still counted against the message cap), but the *latency* benefit is preserved. Cache misses don't cost extra under subscription auth.

---

## Dimension 9: Failure Modes and Runbook (Subscription-Auth Edition)

| Failure Mode | Detection | Claude (in-proc) | Codex CLI | Gemini CLI | OpenCode |
|---|---|---|---|---|---|
| Subscription quota exhausted | Provider-specific error | Mark UNAVAILABLE; do NOT retry | Mark UNAVAILABLE | Mark UNAVAILABLE | Mark UNAVAILABLE |
| Network 5xx / timeout | HTTP status / timer | Retry once via Task; fall through | Retry once; downgrade model | Retry once; fall back to Flash | Retry once; create new session |
| Per-minute rate limit (free Gemini) | HTTP 429 | N/A | N/A | Backoff + retry once; cap 5 retries | N/A |
| Auth token expired | Auth error | Re-login required (orchestrator) | `codex login` again | `gemini login` again | Provider-specific |
| CLI binary missing | `command -v` fail | N/A | Mark UNAVAILABLE | Mark UNAVAILABLE | Mark UNAVAILABLE |
| Session corruption (OpenCode) | 404 / garbled JSON | N/A | N/A | N/A | `DELETE /session/:id` → new session |
| Prompt injection in diff | Content matches instruction patterns | Fencing in system prompt | Sandbox limits write damage | Fencing required | Fencing required |
| Output schema drift | JSON parse failure | N/A (Task contract stable) | Pin Rust release tag | Pin git tag | Pin npm version |
| Disk leak (OpenCode) | `du -sh ~/.local/share/opencode/` | N/A | N/A | N/A | DELETE sessions; monitor SQLite size |
| WSL2 first-invocation hang (Gemini) | Timeout with no output | N/A | N/A | Run `gemini -p "test"` interactively first | N/A |
| OpenCode SQLite migration | First `opencode run` after upgrade takes 2-5 min | N/A | N/A | N/A | Run interactively once after upgrade |

### New runbook entry: subscription quota exhausted mid-review

1. Detect: provider returns subscription-specific error
2. Log: `[council] <reviewer> quota exhausted — window resets at <ETA>`
3. Mark: `verdict=UNAVAILABLE`, `confidence=N/A`, `summary=<reviewer> subscription quota exhausted; council ran with N-of-4 reviewers`
4. Surface in synthesis Headline: `Council ran with N of 4 reviewers (<reviewer> quota exhausted, resets <ETA>)`
5. Do NOT retry — quota-exhausted errors require window reset, not backoff

### Auth state recovery

Each CLI maintains separate auth state. When auth fails:

| CLI | Auth state location | Recovery command |
|---|---|---|
| Claude Code | `~/.claude.json` (orchestrator) | User runs `/login` in Claude Code |
| Codex CLI | `~/.codex/auth.json` | User runs `codex login` |
| Gemini CLI | `~/.gemini/` | User runs `gemini login` (or `gcloud auth`) |
| OpenCode | Provider-specific | Provider-specific |

yellow-council should never attempt auth recovery — surface a clear "auth expired, run X" message and exit gracefully. Auth flows are interactive; council is not.

---

## Dimension 10: Synthesizer Bias (Critical Under Asymmetric Architecture)

Reproduced from prior doc with the asymmetric-architecture caveat:

| Bias Type | Measured Magnitude | Source | Mitigation |
|---|---|---|---|
| Positional (Claude-v1) | 23.8% swap-consistency | Zheng 2023 | Two-pass order-swap |
| Verbosity/Length | +22.9 pp win rate | Wang 2024 | Length-controlled scoring |
| Self-enhancement | ~10-15% above chance favoring own lineage | Multiple | Double-blind lineage labels |
| Authority bias | Citing prestigious sources inflates perceived quality | Zheng 2023 | Strip authority claims from input |

**Why this is the #1 risk under the asymmetric architecture:** the synthesizer is Claude (orchestrator), and one of the reviewers is also Claude (in-process subagent). Self-enhancement bias compounds with positional bias. Without active mitigation, the synthesis is effectively Claude voting for itself.

**Required for V2 (mandatory):**
1. Strip "Reviewer 1" / "Reviewer 2" / "Reviewer 3" / "Reviewer 4" labels in synthesis prompt — never reveal which reviewer is Claude
2. Run synthesis twice with reviewer order swapped, average scores
3. Restore lineage labels only for the final report attribution

---

## Concrete Recommendations

### Quick Wins (≤1 day, low risk, high signal)

**QW-1: Add `claude-reviewer` agent (in-process Task subagent).** New agent definition matching gemini-reviewer/opencode-reviewer shape. Returns structured `verdict=` / `confidence=` / `summary=` / `findings_block_*`. Uses Claude's prompt directly (no subprocess). 4-CLI architecture activated. Estimated: 4 hours.

**QW-2: Wire OpenCode to a non-Big-3 provider.** Document `COUNCIL_OPENCODE_PROVIDER` env var; default to `deepseek-v3.2` or user's configured OpenCode provider. Update CLAUDE.md "Lineage Map" section. Estimated: 1 hour.

**QW-3: Add subscription quota tracking.** `~/.config/yellow-council/quota.json` with per-reviewer used/cap/window. Pre-flight warning when headroom <2x review cost. Heuristic increment + reset on window expiry; recalibrate on quota-exhausted errors. Estimated: 4 hours.

**QW-4: Add quota-exhausted failure handler.** New `verdict=QUOTA_EXHAUSTED` (or extend existing UNAVAILABLE handler). Surface ETA in headline. No retry. Estimated: 2 hours.

**QW-5: Wrap pack in explicit prompt-injection fencing.** Already done in V1 — verify it covers all 4 reviewers including the new claude-reviewer. Estimated: 30 min audit.

**QW-6: Lineage diversity startup assertion.** Warn if two reviewer slots resolve to the same model family (best-effort detection). Estimated: 1 hour.

### V2 Roadmap (2-5 days, medium risk)

**V2-1: Two-pass order-swap synthesizer.** Run synthesis on findings A→B then B→A, average scores. Flag >15% variance as "low-confidence synthesis." Mandatory before quality claims. Estimated: 4 hours.

**V2-2: Double-blind lineage labels in synthesis.** Strip "Claude" / "Codex" / "Gemini" / "OpenCode" labels before synthesis prompt. Present as "Reviewer 1/2/3/4." Restore identity in final report attribution. Estimated: 3 hours.

**V2-3: Tiered evidence verification cascade (Tier 1→2→3).** Exact match → diff-match-patch fuzzy (≥85%) → ast-grep AST match. Move unverified findings to "Unverified Claims" section in synthesis. Highest-leverage quality improvement. Estimated: 3 days.

**V2-4: Verify-first gate on `--round 2` (when round 2 is added).** Block round-2 trigger unless ≥1 finding passes Tier-1/2 verification AND is severity P1/P0. EIR drops to ~0%. Estimated: 4 hours after V2-3 lands.

**V2-5: Round-aware context trimming (when round 2 is added).** Round-2 prompt: only unresolved verified findings + their diff hunks. Strip round-1 transcript, style findings, unverified suggestions. Reduces round-2 quota cost ~60%. Estimated: 1 day.

**V2-6: Speculative cache pre-warming.** Pre-submit core-pack to each provider immediately after argument parsing, before diff extraction. ~80-90% TTFT reduction on warm cache. Per-provider implementation (Anthropic explicit, OpenAI auto, Gemini implicit). Estimated: 2 days.

**V2-7: Length-controlled finding scoring.** Normalize synthesis score by finding length to prevent verbosity bias inflation. Spearman ρ improves 0.94 → 0.98. Estimated: 4 hours.

### Speculative / V3 (>5 days, novel direction)

**V3-1: Bradley-Terry arena for reviewer calibration.** Pairwise comparison history across reviews. Calibrated reviewer weights per finding category (security/correctness/style/performance). Requires ~500 reviews to reach stable estimates.

**V3-2: AgentAuditor localized-branch verification.** Verify each reasoning step in reviewer chain-of-thought, not just the final finding. +5% accuracy over majority voting. Requires structured reasoning traces.

**V3-3: GitHub PR webhook pre-warming.** Start warming core-pack on `pull_request.opened` event. 90.7% TTFT reduction.

**V3-4: Persistent fleet via tmux sessions.** Reusable subprocess sessions across `/council` invocations to amortize CLI startup cost. Requires session lifecycle management per CLI.

**V3-5: OpenCode provider rotation.** Dynamically assign 4th lineage to highest-performing model per finding category (security → DeepSeek; correctness → Grok; style → Mistral). Builds on OpenCode's provider-agnostic routing.

---

## Areas of Concern

### P1 — Self-enhancement bias in Claude→Claude synthesis path

The asymmetric architecture has Claude reviewing AND Claude synthesizing. Without V2-1 (order-swap) and V2-2 (double-blind labels), the synthesizer systematically upweights the Claude-reviewer's findings. This is the #1 quality risk in the new architecture and supersedes the prior doc's positional-bias-only framing.

### P1 — Subscription quota exhaustion is a fast-fail mode

Unlike API rate limits (recoverable with backoff), subscription quota exhaustion fails until the next window opens. A user on Claude Pro running 25 `/council` invocations in a single afternoon will hit the cap and lose access for hours. QW-3 (quota tracking) and QW-4 (quota-exhausted handler) are required to prevent silent failure.

### P1 — OpenCode session lifecycle (unchanged from prior doc)

318 GB disk-leak root cause not confirmed fixed in Feb 2026 changelog. yellow-council V1's explicit `opencode session delete` cleanup is the right pattern — keep it. Subscription auth doesn't affect this risk.

### P2 — Claude reviewer ≠ orchestrator independence

In-process Task subagents have separate conversation context but shared auth/quota with the orchestrator. The "independence" claim is conversational, not auth-level. If quota exhaustion affects the orchestrator (Anthropic-side throttling), the reviewer is also affected. Document this as a known coupling.

### P2 — Lineage diversity requires active enforcement

All four CLIs can wrap any model. Without QW-6 (lineage assertion), the user can accidentally collapse 4 lineages to 2 (e.g., by configuring OpenCode to Anthropic Bedrock). Make the assertion a startup warning, not a hard error — the user might be intentionally homogeneous for benchmarking.

### P2 — Gemini CLI WSL2 first-invocation hang

Documented in plugin CLAUDE.md. The 600s timeout catches it but produces an UNAVAILABLE verdict. Document the workaround prominently in the README.

### P3 — Output schema drift across CLIs

Pin all three subprocess CLI versions in the plugin's CLAUDE.md. A background `npm update` of OpenCode or Gemini CLI can silently break the JSON parser. Codex CLI's Rust release tag is the most stable; Gemini CLI is the highest drift risk.

---

## Open Questions

1. **What is each CLI's exact subscription quota signal?** Codex CLI's "ChatGPT subscription quota exhausted" error format is not documented. Gemini's subscription error vs. free-tier 429 distinction is not confirmed. OpenCode's per-provider error normalization is provider-dependent. Each needs empirical confirmation by triggering exhaustion in a test environment.

2. **Should the OpenCode 4th lineage be configurable per-invocation or deployment-time?** Per-invocation gives flexibility (`/council review --opencode-provider grok`); deployment-time keeps the lineage map stable across runs.

3. **Should the synthesizer be the orchestrator or a separate Task subagent?** Current V1 has the orchestrator synthesize inline. Pulling synthesis into a separate `synthesis-reviewer` Task subagent gives a cleaner double-blind boundary and an audit log of the synthesizer's reasoning, at the cost of ~1 extra Claude message per review.

4. **Is the in-process Claude reviewer's lineage truly "Anthropic" or "the same Claude session as orchestrator"?** Task-spawned subagents share auth and rate-limit bucket with the parent, but the conversation context is fresh. For diversity purposes, this is "same lineage as orchestrator" but "different conversation." Document the distinction.

5. **What's the right default OpenCode provider?** DeepSeek V3.2 is cheap and high-capability. Grok 4 is independent training. Mistral Large is European/different alignment. Pick one as the documented default; allow override.

6. **Should V2 add `--round 2` before V2-3 (verification cascade)?** Without verification, round 2 is harmful in expectation (Reflexion). Sequence: V2-3 → V2-4 → round-2 feature.

7. **How does yellow-council handle a user who has only some subscription tiers?** A Claude Pro user without ChatGPT Plus would have 3-of-4 reviewers permanently. Should we detect and warn at install time?

---

## Sources

- Claude Code CHANGELOG v2.1.92 (Apr 4, 2026) — https://code.claude.com/docs/en/changelog — headless flags, MCP updates, subagent improvements
- Claude Code CLI definitive reference — https://blakecrosley.com/guides/claude-code — configuration hierarchy, flags, permissions
- Claude Code best practices (Feb 2026) — https://notes.muthu.co/2026/02/claude-code-cli-best-practices-checklist/ — `-p`, `--output-format json`, `--dangerously-skip-permissions` confirmed
- Codex CLI reference — https://blakecrosley.com/guides/codex — `config.toml` full reference, sandbox modes, approval policies, model selection
- Codex CLI changelog rust-v0.93.x (Feb 2026) — https://www.gradually.ai/en/changelogs/codex-cli/ — MCP smart approvals, SQLite log DB, ChatGPT login subscription auth path
- Codex CLI GitHub Actions integration — https://inventivehq.com/knowledge-base/openai/how-to-use-codex-for-code-review — `codex exec --json`, CI patterns, `/review` command
- Gemini CLI documentation — https://geminicli.com/docs/ — headless mode, MCP, sandboxing, extensions
- Gemini CLI 2025 guide — https://a2aprotocol.ai/insights/2025-gemini-cli-tips-tricks — MCP server registration, `~/.gemini/settings.json`, context management
- OpenCode changelog (Feb 2026) — https://www.gradually.ai/en/changelogs/opencode/ — session fixes, MCP listTools parallel, Claude Agent SDK structured outputs, provider support
- yellow-council V1 plugin — `plugins/yellow-council/CLAUDE.md` — current architecture, known limitations, V2 trajectory
- Du et al. ICML 2024 — "Improving Factuality and Reasoning in LMs through Multiagent Debate" — 3-agent × 2-round optimum, social conformity failure
- Shinn et al. NeurIPS 2023 — "Reflexion: Language Agents with Verbal Reinforcement Learning" — verify-first gate, EIR ~0%, 91% HumanEval
- Zheng et al. 2023 — arXiv:2306.05685 — positional bias (GPT-4 65%, Claude-v1 23.8% swap-consistency), verbosity bias, self-enhancement
- Wang et al. 2024 — Length-Controlled win rates, +22.9 pp verbosity bias, Spearman 0.94→0.98
- MetaGPT X / shuffled majority voting — 46.67% SWE-Bench Lite; AgentAuditor +5%
- Wynn et al. 2025 — social conformity failure in heterogeneous pools beyond round 2
- SRLabs 2025 — verification bottleneck as #1 operational failure mode in AI code review
- Semgrep 2025 — 48% → 72% TP rate with cross-file analysis on WebGoat (Community → Pro)
- Google diff-match-patch (MIT) — Myers' diff + Bitap algorithm
- ast-grep documentation — AST pattern matching, false positive characteristics
- GodModeSkill (99xAgency) — https://github.com/99xAgency/GodModeSkill — [unverified: May 2026 maintenance status]
- OpenCode session lifecycle — 318 GB disk leak, SQLite 1.99 GB bloat — documented production failure (prior research, 2026-05-08; root cause fix unconfirmed in Feb 2026 changelog)
