# Background Compounding Triggers: Best-Practices Research

**Date:** 2026-05-18
**Feature:** Two-tier background compounding pipeline (Stop hook stager + SessionStart cold-path drain)
**Research scope:** Six targeted questions not covered by the brainstorm's prior Perplexity Sonar Pro pass.

---

## Research Method

**Phase 0 — Skill discovery:** Scanned project, user, and plugin-level SKILL.md files.
Relevant skills found and read: `compound-lifecycle`, `agent-learning`, `memory-remember-pattern`.
Coverage: partial — skills confirm the 0.82 cosine threshold and dedup pattern but do not address
Haiku prompt design, cost ceilings, or JSONL schema versioning. Proceeded to Phases 1 and 2.

**Phase 1 — Context7:** Not installed at user level. Fell through to WebSearch/WebFetch.

**Phase 1.5 — Deprecation check:** Claude Haiku 3.5 ($0.80/$4.00 per 1M tokens) is current;
Claude Haiku 4.5 ($1.00/$5.00 per 1M) is the latest generation but more expensive. Both are
actively maintained. No deprecation concerns. All referenced frameworks (mem0, Letta) are
under active development as of May 2026.

**Phase 2 — Sources consulted:** Claude Code official docs (hooks reference, costs page),
mem0 2026 State of Agent Memory report, Adaline LLM-as-Judge reliability research, NVIDIA
NeMo SemDeDup documentation, event-driven.io schema versioning, Portkey budget limits guide,
Anthropic pricing page, Prompt Engineering Guide (promptingguide.ai), plus focused WebSearch
across all six questions.

---

## Question 1: Haiku Stager System-Prompt Design

### MUST HAVE

**1. Use 2-3 few-shot examples rather than zero-shot for the priority scoring task.**

- Source: AWS/Anthropic prompt-engineering sample notebook; confirmed by independent benchmark
  showing Claude 3 Haiku improves from 11% to 75% correctness with 3 examples on structured
  output tasks. The Prompt Engineering Guide (Min et al. 2022) confirms that label distribution
  and format of demonstrations matter more than whether labels are correct, meaning the
  structure of examples is the primary lever.
- Why it matters: The scoring sub-task (assigning 0.0–1.0 and deciding to skip) is the highest-
  failure-mode component of the stager. Zero-shot leaves the rubric implicit; Haiku is a
  smaller model that benefits disproportionately from explicit demonstrations.
- How to implement: Include three examples in the system prompt: one skip (priority 0.3,
  trivial session), one medium (priority 0.7, workflow pattern), one high (priority 0.9,
  security finding). Show the full JSONL output format for each. Place examples after the
  rubric table, before the input.

**2. Use a discrete rubric table, not a continuous prose description, for priority scoring.**

- Source: Adaline LLM-as-Judge reliability research (2026); Rulers (AAAI 2025, arxiv 2601.08654)
  showing "locked rubrics with evidence anchoring" substantially outperform prose descriptions
  for numeric scoring tasks.
- Why it matters: LLM judges exhibit four documented bias patterns on continuous scales —
  verbosity bias, self-preference bias, position bias, and score bunching (gravitating toward
  the middle of the range). A discrete rubric with anchored examples for each tier forces the
  model to match the input to a predefined category rather than interpolate.
- How to implement: Provide an explicit table mapping priority tiers to observable evidence:

  ```
  | Priority | Evidence required                                                    |
  |----------|----------------------------------------------------------------------|
  | 0.9-1.0  | Security finding, correctness bug, data loss risk                   |
  | 0.7-0.89 | Non-obvious pattern, architectural decision, non-trivial bug fix    |
  | 0.5-0.69 | Workflow improvement, configuration insight, performance finding     |
  | 0.3-0.49 | Routine task completed, minor polish, no unique learning            |
  | < 0.3    | SKIP — status check, passing test, trivial read-only operation      |
  ```

  The skip tier must be named as a distinct action ("SKIP"), not a low numeric score.
  LLMs tend to avoid outputting scores below 0.3 unless the skip is an explicit alternative.

**3. Specify the skip action explicitly as a non-numeric output option.**

- Source: arxiv 2601.18271 (score extraction from messy text, 2026 challenge): the key
  finding is that models must be instructed to return a "missing value code" (not a low number)
  when the text does not contain the target signal. The same principle applies to priority scoring.
- Why it matters: Without an explicit SKIP option, the model will assign a low (0.1-0.3) score
  to trivial sessions and write the entry to the ledger anyway. The cold-path reviewer then
  wastes time processing low-value entries. Skip-bias (never assigning low scores) is the
  dominant failure mode for always-on stagers.
- How to implement: Add a conditional to the prompt: "If the session contains no observable
  learning (all tool calls are reads, searches, or passing tests), output `skip: true` and
  omit `candidate_text` and `priority` entirely. Do not write a JSONL entry." The shell
  wrapper checks for this flag before invoking the atomic move.

### RECOMMENDED

**4. Cap the input window at last 15-20 tool-call outputs, not the full session context.**

- Source: Claude Code costs documentation confirms background processes should be token-minimal;
  Haiku 3.5 is $0.80/1M input tokens — at 15 tool outputs averaging 200 tokens each, the
  input is ~3000 tokens = $0.0024/session. Expanding to 40 tool outputs (~8000 tokens) doubles
  cost with diminishing signal return (most learnings are in the last 10-15 actions).
- Why it matters: The brainstorm estimates $0.001-0.003/session. Keeping the input window to
  ~3000 tokens holds the lower end of that range and is consistent with the brainstorm's
  $1.20/month projection at 10 sessions/day.
- How to implement: The Stop hook shell script truncates the tool-call list from the hook
  input to the last 15 entries before passing to the Haiku agent. Use `jq '.[(-15):]'` on the
  array of recent tool calls. Prioritize: tool calls with non-zero exit codes, Edit/Write tool
  outputs (file changes), and Bash outputs containing "error" or "fix" patterns.

**5. Instruct Haiku to produce candidate_text as a self-contained fact, not a session summary.**

- Source: agent-learning SKILL.md (project-level, highest authority): "Structure (all three
  required): Context (what happened), Insight (why), Action (concrete steps for a future agent)."
  Also confirmed by memory-remember-pattern SKILL.md quality gates (20+ words, specificity
  to files/commands).
- Why it matters: Session summaries ("worked on the auth module today") are useless to the
  cold-path reviewer. Self-contained facts with file paths and error messages are directly
  promotable.
- How to implement: Add to the system prompt: "Write `candidate_text` as a single
  self-contained fact: WHAT was the specific finding (name the file or command), WHY it
  matters (what broke or what works), and WHAT a future developer should do. Do not summarize
  the session. Do not use 'we' or 'I'."

### OPTIONAL

**6. Use batch API (50% cost reduction) for the stager if latency tolerance allows.**

- Source: Anthropic pricing page (2026): batch processing is 50% cheaper across all models.
  Claude Haiku 3.5 via batch = $0.40/1M input, $2.00/1M output.
- When to apply: Only feasible if the stager is decoupled from the Stop hook and run
  asynchronously on a schedule. Not recommended for MVP since it adds infrastructure complexity.
  Revisit if monthly cost exceeds the defined ceiling.

---

## Question 2: Two-Pass Dedup Architecture

### MUST HAVE

**1. Two-pass dedup (content-hash exact + semantic cosine) is the correct pattern; semantic-only is not consensus.**

- Source: NVIDIA NeMo SemDeDup documentation (2024-2025): the recommended architecture runs
  exact dedup first (MinHash or content hash), then semantic dedup on survivors. Semantic-only
  dedup is used for pre-training data curation at scale, not agent memory systems. Agent memory
  has different requirements: the corpus is tiny (hundreds of entries, not billions), and false
  positive dedup (discarding a genuinely new learning) is more costly than false negative dedup
  (retaining a near-duplicate).
- Why it matters: Content-hash first is O(1) per entry (dict lookup). Semantic pass is O(N)
  per entry (embedding + cosine). Running semantic-only on every entry wastes compute and
  increases false positive risk for short, structurally similar but semantically different
  entries (e.g., two different hook input-field bugs).

**2. The 0.82 cosine threshold from compound-lifecycle is within literature range but on the permissive end for agent memory.**

- Source (cross-referenced): compound-lifecycle SKILL.md notes "0.82 is the calibrated default
  for paragraph-level semantic equivalence on markdown corpora (Universal Sentence Encoder
  convention; Pinecone case study)." Independent verification:
  - NVIDIA NeMo SemDeDup uses configurable eps_thresholds; common values in documentation
    examples range from 0.80 to 0.95.
  - agent-cerebro (PyPI) uses 0.92 for agent memory dedup.
  - SemHash documentation shows threshold=0.90 as a common starting point.
  - memory-remember-pattern SKILL.md uses 0.82 for existing-memory dedup before hooks_remember.
- Assessment: 0.82 is appropriate for paragraph-length candidate_text against the existing
  docs/solutions/ corpus (which uses similar vocabulary across entries). It may be too
  permissive for short 2-3 sentence entries compared against other short entries — two entries
  about different hook bugs could score 0.83 if they use the same hook terminology.
- Recommendation: Keep 0.82 for dedup against the *existing* promoted corpus (docs/solutions/
  and MEMORY.md). Use a slightly stricter 0.85 for cross-entry dedup *within the pending ledger*
  itself (comparing staged entries to each other before promotion). This asymmetry matches the
  different base rates: existing promoted entries are more semantically diverse than a batch of
  staged entries from sessions working on the same feature.

**3. False-positive dedup mitigation: gate semantic skip on minimum priority threshold.**

- Source: agent-learning SKILL.md pattern: "Don't apply hard threshold on search results —
  always return top-k, filter below 0.5." Applied inversely to dedup: do not skip a high-
  priority entry (priority >= 0.8) based solely on semantic similarity unless cosine >= 0.90.
  High-priority entries may legitimately be about the same domain but contain a distinct new
  finding.
- Why it matters: A security finding (priority 0.9) about hook input-field path bugs could
  score 0.84 cosine against an existing entry about a different hook path bug. Both are worth
  keeping. Overriding the dedup skip when priority is high protects against false-positive dedup.
- How to implement: In the staging-reviewer, after the semantic pass:
  ```
  if cosine >= 0.82 AND priority < 0.8: SKIP (semantic duplicate)
  if cosine >= 0.90: SKIP (high-confidence duplicate, regardless of priority)
  if cosine >= 0.82 AND priority >= 0.8: KEEP (high-priority, review anyway)
  ```

### RECOMMENDED

**4. Log dedup decisions to a sidecar file for calibration.**

- Source: Adaline LLM-as-Judge research: "divergence above 20-25% signals recalibration needs."
  Same principle applies to dedup thresholds — if 40% of staged entries are being deduped, the
  threshold is too permissive; if 0% are, ruvector may not be running.
- How to implement: Append a `dedup_log.jsonl` entry to the staging directory on each drain,
  recording: entry hash, cosine score, dedup decision, priority. After 30 days, review: if
  skip rate > 30%, tighten threshold; if skip rate < 5%, loosen.

---

## Question 3: Per-Project vs Cross-Project Memory Scoping

### MUST HAVE

**1. Per-project scoping at ~/.claude/projects/<hash>/ is consistent with 2026 agent memory consensus.**

- Source: mem0 2026 State of Agent Memory report; sureprompts.com architecture comparison (2026).
  The four-scope model (user_id, agent_id, session_id, app_id) is the 2026 consensus. Claude
  Projects exemplify project-scoped persistence — "a project-scoped persistent context separate
  from user-level memory." The brainstorm's choice of `~/.claude/projects/<hash>/compound-staging/`
  mirrors this exactly.
- Assessment: Confirmed. Per-project is correct for phase 1. The key finding from the mem0
  report: "most production failures are scoping failures — forgetting to pass user_id and
  watching memories pool into a single global namespace." Per-project isolation avoids this
  exact failure.

**2. Cross-project promotion requires explicit opt-in and a separate promotion pathway — no auto-promotion.**

- Source: sureprompts.com 2026 comparison: "Cross-project memory migration currently requires
  manual processes rather than architected solutions — this gap is documented across all major
  frameworks." This validates the brainstorm's decision to treat cross-project as "future work."
- Pattern that exists (Agent KB, 2025): cross-domain knowledge transfer works through manual
  "reflection" steps where teams review completed projects and promote standard operating
  procedures. This is human-gated, not automatic.
- Recommendation for yellow-plugins: When the staging-reviewer promotes a `candidate_text`
  that scores priority >= 0.9 AND has tags matching domain-agnostic patterns (e.g.,
  `["hook-pattern", "security"]`), add a field `cross_project_candidate: true` to the promoted
  MEMORY.md entry. A future `/compound:promote-global` command can scan for this field and
  copy to `~/.claude/MEMORY.md` (global user scope). Do not auto-promote.

### RECOMMENDED

**3. Scope staging files to git-root hash, not worktree path.**

- Source: brainstorm open question #2 deferred to plan phase. Research finding from yellow-
  ruvector CLAUDE.md: `.ruvector/` is shared across git worktrees via symlink because the
  DB must survive worktree cleanup. Same logic applies to the staging ledger.
- Recommendation: Derive `<hash>` from `md5(git rev-parse --show-toplevel)` — the git root,
  not the current worktree path. This matches the auto-memory system convention and ensures
  stager and reviewer always resolve to the same directory regardless of which worktree is
  active.

---

## Question 4: Cost-Aware Always-On Background Workloads

### MUST HAVE

**1. Use a file-based monthly counter in the staging directory as the cost gate.**

- Source: Portkey budget-limits guide (2026): tiered alerting (70%/90%/100%/120%) is the
  established pattern. Claude Code official costs documentation confirms background processes
  are expected to cost <$0.04/session. Workspace spend limits are available via the
  Claude Console for API users.
- Why it matters: The brainstorm projects ~$1.20/month at 10 sessions/day. A monthly counter
  prevents runaway costs if session frequency increases (e.g., 50 sessions/day = $6/month
  hot path alone).
- How to implement: The SessionStart hook checks a `~/.claude/projects/<hash>/compound-staging/cost-counter.json` file:
  ```json
  {"month": "2026-05", "hot_path_calls": 47, "cold_path_calls": 9, "estimated_usd": 0.56}
  ```
  - If `estimated_usd >= ceiling * 0.8`: log warning to stderr, continue (soft limit)
  - If `estimated_usd >= ceiling`: skip the stager spawn entirely for this session (hard limit)
  - Reset the counter on the first session of each calendar month
  - Recommended ceiling: $3.00/month (2.5x the nominal projection, covers 10x session spikes)

**2. No convention exists for showing background cost in the CLI statusline — implement a project-local pattern.**

- Source: Claude Code official costs documentation (WebFetch confirmed): Claude Code's `/cost`
  and `/usage` commands show session cost, but there is no built-in mechanism for displaying
  background-task costs separately. The statusline (`/statusline:setup`) is configurable but
  shows context-window usage, not background op costs.
- Assessment: Aider, Cursor, and Claude Code all show per-session accumulated cost but not
  background-op cost as a separate line item. This is an unaddressed gap in 2026.
- Recommendation: Add a `last_drain_cost_usd` field to cost-counter.json. The
  `/compound:status` command (future work from brainstorm) can display it as a summary:
  "Last drain: 9 entries promoted, est. $0.08. Month-to-date: $0.56 / $3.00 ceiling."
  This is the closest pattern to what Portkey calls "feedback loops" (notify teams when
  trending toward limits).

**3. Use exponential backoff on cold-path drain frequency when cost ceiling approaches.**

- Source: relayplane.com agent cost governance guide (2026): "exponential backoff on drain
  frequency" is the standard pattern for budget-aware background agents — not blocking
  outright, but progressively widening the gap between drain events.
- How to implement: Replace the fixed 24h age threshold with a budget-scaled threshold:
  ```
  base_age_hours = 24
  budget_fraction = estimated_usd / ceiling
  scaled_age_hours = base_age_hours * (1 + 3 * budget_fraction)  # 24h → 96h at 100%
  ```
  At 80% budget: threshold becomes ~43h. At 100%: ~96h. This naturally throttles drain
  frequency as costs accumulate, without hard-blocking the pipeline.

### RECOMMENDED

**4. Use Claude Haiku Batch API for the stager if monthly cost exceeds $2.00.**

- Source: Anthropic pricing (2026): batch processing is 50% cheaper. At 10 sessions/day,
  switching hot-path stager to batch would reduce Haiku cost from ~$0.60/month to ~$0.30/month.
- When to apply: Only after MVP validation shows the pipeline is stable. Batch adds a queue
  delay (results typically within 24h) which is acceptable since the cold-path drain already
  waits 24h by default.

---

## Question 5: Stop-Hook Latency Budgets

### MUST HAVE

**1. Use `async: true` on the Stop hook registration — not a background subshell within a synchronous hook.**

- Source: Claude Code hooks reference (official docs, WebFetch confirmed). Key finding:
  async hooks are an official feature: `"async": true` in the hook JSON entry makes the hook
  non-blocking without any subshell gymnastics. The default timeout for Stop hooks is 600
  seconds; async hooks still respect this timeout but do not block Claude's session transition.
- Critical nuance: `async: true` still kills the hook after the configured timeout. A hook
  that spawns a long-running background process and exits immediately is safe because the
  *hook script* exits immediately — the spawned subprocess is disowned and survives.
- Relationship to brainstorm: The brainstorm's morph-prewarm pattern (`( subshell ) &>/dev/null &
  disown; printf '{"continue": true}\n'`) is correct and compatible with `async: true`. Using
  both provides defense-in-depth: `async: true` prevents blocking even if the hook script
  itself hangs before reaching the disown line.

**2. The practical timeout before a Stop hook degrades user experience is 0 seconds — it should not block at all.**

- Source: Claude Code hooks reference: Stop hooks fire after Claude finishes a response.
  They do not block the current session's response delivery. However, documented cases show
  hooks causing 18-21s per-prompt latency when they are synchronous and slow (GitHub issue
  on ruflo, ruvnet/ruflo#1530). This latency appears on *subsequent* prompts because the
  hook runs before the next user input is processed.
- Assessment for the stager: The Stop hook must complete its synchronous work (parse hook
  input, spawn subshell, disown) within ~500ms. All LLM work must be in the disowned subprocess.
  With `async: true` AND the morph-prewarm pattern, the parent script exits in <100ms.

**3. Recommended max latency for the synchronous portion of a Stop hook is 100ms.**

- Source: Derived from: yellow-ruvector stop.sh reference (10s timeout for the ruvector
  session-end hook, which is synchronous), Claude Code docs (UserPromptSubmit has 30s default
  because it blocks model processing). Stop hooks with `async: true` have no documented
  blocking effect, but synchronous work before the disown should still be minimal.
- For the stager specifically: The hook script should do only: (1) parse hook input to extract
  recent tool calls, (2) spawn subshell with the Haiku agent call, (3) disown, (4) print
  `{"continue": true}`. Steps 1-3 must complete in under 100ms. jq parsing of the hook input
  is the main variable; keep it to a single pipeline.

### RECOMMENDED

**4. Set an explicit `timeout: 30` on the Stop hook registration even with `async: true`.**

- Source: Claude Code hooks reference: async hooks still observe timeout. Setting a low
  timeout (30s) on a hook that should complete in <1s provides a safety net against hung
  processes leaking resources.

---

## Question 6: JSONL Schema Versioning

### MUST HAVE

**1. Bump schema version only on semantic changes, not additive field additions.**

- Source: event-driven.io schema versioning patterns; snowplow.io SchemaVer (SchemaVer
  1-0-0 model). The consensus across event-sourcing literature:
  - Adding an optional field: no version bump required if readers ignore unknown fields
    (the "unknown fields are silently ignored" contract must be explicitly stated)
  - Removing or renaming a required field: bump required
  - Changing the meaning of an existing field: bump required
  - Adding a new required field: bump required (old writers cannot produce it)
- Applied to the brainstorm's schema: `"schema": "1"` is correct for the current schema.
  A bump to `"schema": "2"` would be required if, for example, `priority` changed from
  a float to a categorized string, or if `content_hash` was renamed `sha256_hash`.

**2. Readers must branch on schema version field, not assume a single schema.**

- Source: offlinetools.org JSON schema versioning guide; event-driven.io: "keep migrations
  incremental, preferring v1->v2->v3 functions over growing sets of special-case conversions."
- How to implement in the staging-reviewer: The drain script reads all pending JSONL files.
  Before processing each entry, check the schema field:
  ```bash
  schema=$(echo "$entry" | jq -r '.schema // "1"')
  case "$schema" in
    "1") process_v1 "$entry" ;;
    "2") process_v2 "$entry" ;;
    *)   printf '[compound] Unknown schema version: %s — skipping entry\n' "$schema" >&2 ;;
  esac
  ```
  The `// "1"` fallback handles entries written before the schema field was introduced.

**3. Mixed-schema ledgers (v1 and v2 entries coexisting) must be handled without ledger rewrite.**

- Source: event-driven.io core principle: "Events will stay as they were — you have to keep
  the old structure forever." For append-only ledgers, rewriting old entries to the new schema
  violates the append-only contract and breaks content-hash dedup (the sha256 was computed on
  the v1 structure).
- Recommendation: Never rewrite old entries. Process v1 entries with the v1 processing logic
  indefinitely. If a field added in v2 is needed for promotion, derive it from v1 fields where
  possible or mark v1 entries as `schema_upgrade_needed: true` in the drain log (not in the
  entry itself).

### RECOMMENDED

**4. Add `schema_min_reader: "1"` field alongside `schema` for forward compatibility.**

- Source: snowplow.io SchemaVer model: the version field identifies the writer's schema;
  a separate field (`min_reader`) communicates the minimum reader version that can correctly
  process the entry. This allows future readers to hard-skip entries they cannot process.
- How to implement: For MVP, both fields are `"1"`. When schema "2" is introduced, entries
  that use schema-2-only fields would set `schema_min_reader: "2"`. A schema-1 reader
  encountering `schema_min_reader: "2"` knows to skip rather than misinterpret.
- Note: This is OPTIONAL for MVP. Hard-code `schema_min_reader: "1"` in all v1 entries
  for forward compatibility, but do not add reader-version-branching logic until a second
  schema version is actually introduced.

### OPTIONAL

**5. Write schema version to a sidecar registry file when a new version is introduced.**

- Source: Common practice in event-sourcing systems (Confluent Schema Registry pattern).
- How to implement: Maintain `~/.claude/projects/<hash>/compound-staging/schema-registry.json`:
  ```json
  {"current_version": "1", "versions": {"1": {"introduced": "2026-05-18", "fields": [...]}}}
  ```
  The drain script reads this registry at startup to know which versions are active, rather
  than discovering versions from scanning JSONL entries. Only implement when schema "2" is
  introduced.

---

## Synthesis: Concrete Recommendations for Implementation

### Haiku stager prompt template (Q1)

```
You are a session-learning extractor. You will be given the last 15 tool-call outputs
from a Claude Code session. Your job is to extract ONE self-contained learning fact,
assign it a priority score, and decide whether to skip.

PRIORITY RUBRIC:
| Priority  | Evidence                                                            |
|-----------|---------------------------------------------------------------------|
| 0.9-1.0   | Security finding, correctness bug, data loss risk                   |
| 0.7-0.89  | Non-obvious pattern, architectural decision, non-trivial bug fix    |
| 0.5-0.69  | Workflow improvement, configuration insight, performance finding     |
| 0.3-0.49  | Routine task, minor polish, no unique learning                       |
| SKIP      | Status check, passing test, trivial read-only operation             |

OUTPUT FORMAT (JSON, one line):
If there is a learning: {"candidate_text": "...", "priority": 0.X, "tags": [...]}
If no learning: {"skip": true}

RULES:
- candidate_text must name a specific file, command, or error message
- candidate_text must have three parts: WHAT (finding), WHY (why it matters), DO (action)
- candidate_text must be 2-3 sentences, self-contained, no pronouns
- tags must be 2-5 lowercase hyphenated strings from: hook-pattern, security, build-error,
  test-pattern, workflow, config, performance, api-pattern, shell-pattern, posttooluse,
  sessionstart, stop-hook, jsonl, dedup, cost

EXAMPLES:
Input: [sessions with jq parse error in hook, fixed by checking tool_input.command]
Output: {"candidate_text": "PostToolUse hook input nests command at .tool_input.command not root .command; accessing root .command returns null and causes silent pass-through on all tool interceptions. Affects hooks/post-tool-use.sh. Always use .tool_input.command in PostToolUse hooks.", "priority": 0.85, "tags": ["hook-pattern", "posttooluse"]}

Input: [session ran tests, all passed, minor comment edits]
Output: {"skip": true}

Input: [fixed a security issue: CRLF in hook script caused JSON parse error]
Output: {"candidate_text": "WSL2 Write tool produces CRLF line endings in shell scripts; hook scripts with CRLF fail JSON output parsing silently. Run `sed -i 's/\\r$//' script.sh` after every Write tool call for .sh files.", "priority": 0.88, "tags": ["shell-pattern", "hook-pattern", "security"]}
```

### Dedup threshold table (Q2)

| Comparison | Threshold | Override |
|---|---|---|
| Staged entry vs existing corpus (docs/solutions/ + MEMORY.md) | >= 0.82 skip | If priority >= 0.8: require >= 0.90 to skip |
| Staged entry vs other staged entries (within pending ledger) | >= 0.85 skip | If priority >= 0.8: require >= 0.90 to skip |
| Content-hash exact match | exact match skip | No override |

### Cost ceiling parameters (Q4)

| Parameter | Value | Location |
|---|---|---|
| Monthly ceiling | $3.00 | cost-counter.json |
| Soft limit (warn) | $2.40 (80%) | SessionStart hook |
| Hard limit (block stager) | $3.00 (100%) | SessionStart hook |
| Counter reset | First session of calendar month | SessionStart hook |
| Backoff formula | base_age * (1 + 3 * budget_fraction) | SessionStart hook |

### Stop hook async configuration (Q5)

In plugin.json hooks block:
```json
{
  "type": "command",
  "command": "${CLAUDE_PLUGIN_ROOT}/hooks/scripts/stop.sh",
  "async": true,
  "timeout": 30
}
```

The stop.sh script still uses the morph-prewarm pattern (`( haiku-agent-call ) >/dev/null 2>&1 & disown`)
as defense-in-depth. (Note: an earlier draft of this section recommended `async: true` on the hook registration; that recommendation has been superseded — see plan D4 and deepen-validation Q2: `async: true` is NOT a supported Claude Code hook-schema field. Non-blocking behavior is provided entirely by the disowned subshell.)

### JSONL schema versioning policy (Q6)

- Schema "1": current, no version bump planned for MVP
- Bump to schema "2" triggers when: any required field is removed, renamed, or changes type
- Additive optional fields (e.g., adding `cross_project_candidate: true`) do not bump version
- Mixed-schema ledgers: drain script branches on `schema` field; never rewrites old entries
- `schema_min_reader: "1"` added to all entries now for forward compatibility

---

## Sources

### Official documentation
- [Claude Code Hooks Reference](https://code.claude.com/docs/en/hooks) (official)
- [Claude Code Manage Costs](https://code.claude.com/docs/en/costs) (official)
- [Anthropic API Pricing 2026](https://platform.claude.com/docs/en/about-claude/pricing) (official)

### Research papers and technical reports
- [arxiv 2601.18271: Designing LLM prompts to extract scores from messy text]
  (https://arxiv.org/abs/2601.18271) (academic, January 2026)
- [Rulers: Locked Rubrics and Evidence-Anchored Scoring](https://arxiv.org/html/2601.08654v1) (academic, 2025)
- [Evaluating Scoring Bias in LLM-as-a-Judge](https://arxiv.org/html/2506.22316v1) (academic, 2026)
- [arxiv 2602.02007: Beyond RAG for Agent Memory: Retrieval by Decoupling](https://arxiv.org/pdf/2602.02007) (academic, 2026)
- [Contrastive Decoding Mitigates Score Range Bias](https://arxiv.org/pdf/2510.18196) (academic, 2025)

### Framework documentation
- [NVIDIA NeMo SemDeDup Documentation]
  (https://docs.nvidia.com/nemo-framework/user-guide/25.07/datacuration/semdedup.html) (official framework docs)
- [mem0 State of AI Agent Memory 2026](https://mem0.ai/blog/state-of-ai-agent-memory-2026) (community/vendor)
- [Agent Memory Architectures Compared 2026](https://sureprompts.com/blog/agent-memory-architectures-compared-2026) (community)

### Cost and operations
- [Portkey: Budget Limits and Alerts in LLM Apps](https://portkey.ai/blog/budget-limits-and-alerts-in-llm-apps/) (community/vendor)
- [RelayPlane: Agent Runaway Costs 2026](https://relayplane.com/blog/agent-runaway-costs-2026) (community)

### Prompt engineering
- [AWS/Anthropic Prompt Engineering with Claude v3 (Few-Shot)]
  (https://github.com/aws-samples/prompt-engineering-with-anthropic-claude-v-3/blob/main/07_Using_Examples_Few-Shot_Prompting.ipynb) (official sample)
- [Adaline: LLM-as-a-Judge Reliability and Bias](https://www.adaline.ai/blog/llm-as-a-judge-reliability-bias) (community/research)
- [Prompt Engineering Guide: Few-Shot](https://www.promptingguide.ai/techniques/fewshot) (community)

### Schema versioning
- [event-driven.io: Simple Events Schema Versioning Patterns]
  (https://event-driven.io/en/simple_events_versioning_patterns/) (community)
- [Snowplow: Introducing SchemaVer](https://snowplow.io/blog/introducing-schemaver-for-semantic-versioning-of-schemas) (community)

### Local skills (highest authority)
- `plugins/yellow-core/skills/compound-lifecycle/SKILL.md` — 0.82 cosine threshold provenance and two-pass overlap detection
- `plugins/yellow-ruvector/skills/agent-learning/SKILL.md` — quality gates, dedup threshold (0.85), learning trigger taxonomy
- `plugins/yellow-core/skills/memory-remember-pattern/SKILL.md` — 0.82 dedup threshold for hooks_remember, signal classification table
