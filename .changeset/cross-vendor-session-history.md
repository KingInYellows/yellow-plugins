---
"yellow-core": minor
---

Add cross-vendor `session-history` skill + `session-historian` agent (W3.12)
— search prior sessions across Claude Code, Devin, and Codex with hybrid
query and secret redaction

Introduces:

- `plugins/yellow-core/skills/session-history/SKILL.md` (user-invokable as
  `/yellow-core:session-history`) — user surface, query parsing, backend
  availability detection, dispatch to `session-historian`, result table
  rendering.
- `plugins/yellow-core/agents/workflow/session-historian.md`
  (`tools: [Read, Grep, Glob, Bash, Task, ToolSearch]`) — per-backend session
  discovery + extraction, BM25/cosine/RRF fusion scoring, secret
  redaction, structured output schema with V3 Devin lineage fields.

Adapted from upstream `EveryInc/compound-engineering-plugin`
`ce-session-historian` agent at locked SHA
`e5b397c9d1883354f03e338dd00f98be3da39f9f`.

**Three backends with graceful degradation:**

| Backend     | Source                                                              | Availability check                                                            |
| ----------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Claude Code | `~/.claude/projects/<encoded-cwd>/*.jsonl`                          | Filesystem read (always, unless directory missing)                            |
| Devin       | `mcp__plugin_yellow-devin_devin__devin_session_search`              | `ToolSearch` for the MCP tool; fall back to `devin-orchestrator` if absent    |
| Codex       | `~/.codex/sessions/<YYYY/MM/DD>/<session-uuid>/`                    | Filesystem read of the directory (CLAUDE.md only documents `~/.codex/auth.json` and `~/.codex/config.toml`; sessions path lives in `plugins/yellow-codex/commands/codex/status.md` Step 3) |

Encoded CWD: `printf '%s' "$PWD" | sed 's|/|-|g'` — replaces every `/`
with `-` (the leading slash becomes a leading hyphen). For
`/home/user/projects/foo` the encoded form is
`-home-user-projects-foo`. Matches Claude Code's actual on-disk
encoding for `~/.claude/projects/<encoded-cwd>/`.

Backend unavailable: log
`[session-history] Warning: <vendor> backend unavailable, skipping` to
stderr once and continue with available backends. **Never** fail the whole
run on a single backend's missing prerequisites.

**Hybrid query algorithm (BM25 + optional cosine + recency, fused via
RRF):**

1. **BM25 component (always)** — token-frequency scoring on parsed topic
   keywords against each session's text via `grep -ci`. Sum across keywords
   normalized by `1 + log(1 + session_length_bytes)` so 1 MB sessions don't
   dominate 100 KB ones.

2. **Cosine component (optional, when ruvector is installed)** — call
   `mcp__plugin_yellow-ruvector_ruvector__hooks_recall(query, top_k=5)`
   and use the result's `score` field. Skip the entire component if
   ruvector is unavailable; do not error.

3. **Recency boost** — multiplier `1.0 - (days_old / scan_window_days)`,
   floored at 0.1. Recent sessions outrank equally-relevant older ones.

4. **Reciprocal Rank Fusion** — `RRF(d) = sum( 1 / (60 + rank(d)) )` per
   component (k=60 standard default), then `final_score = RRF * recency_boost`.
   Disparate component scales (BM25 magnitudes vs cosine 0–1) merge
   cleanly via rank rather than raw score.

**Per-message-turn chunking** preserves `{session_id, vendor, timestamp,
role, tool_calls}` metadata. Token-based chunking would fragment tool
calls and lose attribution.

**Devin V3 lineage support** (per source-plan research note on April 2026
Devin API update): captures `parent_session_id`, `child_session_ids`, and
`is_advanced` fields; returns as
`lineage: {parent, children, is_advanced}` in result records. Improves
"what did we decide about X" queries by surfacing related sub-sessions
rather than just the top-level session.

**Secret redaction (mandatory, runs in agent before any output):**

| Pattern                                                       | Replacement     |
| ------------------------------------------------------------- | --------------- |
| `AKIA[0-9A-Z]{16}`                                            | `[AWS_KEY]`     |
| `ghp_[A-Za-z0-9]{36}` / `github_pat_[A-Za-z0-9_]+`            | `[GH_TOKEN]`    |
| `sk-[A-Za-z0-9]{20,}` / `sk-ant-[A-Za-z0-9-]{20,}`            | `[API_KEY]`     |
| `eyJ[A-Za-z0-9_=-]+\.eyJ[A-Za-z0-9_=-]+\.[A-Za-z0-9_.+/=-]*` | `[JWT]`         |
| `-----BEGIN [A-Z ]+-----[\s\S]+?-----END [A-Z ]+-----`        | `[PEM_BLOCK]`   |

Redaction runs unconditionally — never skip "because the user is the only
person who will see this." Memory persists, transcripts get exported, and
once a credential leaks into a `compound` write it lives forever. Each
result row includes `secrets_redacted: <N>` when redactions occurred.

**Yellow-plugins divergence from upstream:**

- **Cursor → Devin substitution.** Upstream's `ce-session-historian`
  covered Claude Code + Codex + Cursor. Yellow-plugins replaces Cursor
  with Devin because the yellow-devin plugin already exposes a Devin MCP,
  and Devin sessions are the highest-density source of long-form
  decisions in this workflow. Cursor support can be added later if a
  use case emerges.
- **Single-agent body, no helper extraction skills.** Upstream delegates
  JSONL extraction to `ce-session-inventory` and `ce-session-extract`
  skills (~1100 lines combined). yellow-core ships a single agent that
  does inline filtering. The ~300-line agent body fits in one context,
  and the extraction commands are short enough to inline without a
  helper skill.
- **Hybrid scoring is explicit.** Upstream is keyword-only with judgment-
  based ranking. yellow-plugins specifies BM25 + optional cosine + RRF
  fusion per the source-plan research note (Cursor semantic search;
  Pinecone hybrid-search studies; ~12% retrieval accuracy recovery on
  coding transcripts).
- **Secret redaction in agent (not skill).** Putting redaction in the
  agent makes it impossible to forget — the skill only sees the agent's
  already-redacted output. Upstream documents redaction patterns in
  prose; yellow-plugins makes it a mandatory step in the methodology.

**Methodology preserved from upstream:**

- Step 1: scope + backend availability detection
- Step 2: per-backend keyword filter (`grep -c`) before deep extract
- Step 3: bounded deep-dive (top 5 per backend, top 8 across)
- Step 4: per-message-turn extraction (head:200 default, tail:50
  conditional when session terminated mid-investigation)
- Step 5: redact + score
- Step 6: honest reporting (zero results gets a one-sentence diagnostic;
  partial extraction gets `partial_extraction: true`)

**Acceptance criterion satisfied:** when invoked from a project with
Claude Code transcripts present, the skill returns timestamped per-vendor
results merged by relevance, each tagged with source vendor and
secrets-redacted. Devin and Codex backends gracefully skip when
unavailable.

Discoverable via auto-discovery from
`plugins/yellow-core/skills/session-history/SKILL.md` and
`plugins/yellow-core/agents/workflow/session-historian.md` — no
`plugin.json` registration required.

**Plan reconciliation:** flips Wave 3 items #8 (PR #310), #9 (this PR),
#10 (PR #311) to DONE in `plans/everyinc-merge-wave3.md` Stack Progress
section. Items #2, #5, #7 remain on the runway.
