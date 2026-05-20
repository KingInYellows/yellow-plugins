---
'yellow-core': minor
---

feat(yellow-core): Stop + SessionStart hooks for background compounding

Adds the hook infrastructure for an always-on background compounding
pipeline (plans/background-compounding-triggers.md, stack item #1).

**New files:**

- `lib/compound-staging.sh` — sourceable helper library:
  - `cs_derive_project_slug` / `cs_staging_dir_for_slug` — per-project
    staging directory under `~/.claude/projects/<slug>/compound-staging/`
  - `cs_atomic_jsonl_write` — sibling-tmp + rename atomicity
    (`_lc_atomic_write` pattern, yellow-research precedent)
  - `cs_redact_secrets` — self-contained subset of yellow-ci/lib/redact.sh
    covering password=, token=, api_key=, Bearer, basic-auth URLs, GitHub
    + Docker + npm + JWT tokens, PEM blocks
  - `cs_read_drain_budget` / `cs_update_drain_budget` /
    `cs_drain_budget_warn` — 5h rolling-window observability counter (no
    hard ceiling under subscription auth)
  - `cs_detect_auth_route` — ANTHROPIC_API_KEY → "api" else "subscription"
- `hooks/scripts/stop.sh` — Stop hook (5s timeout, returns
  `{"continue": true}` in < 500ms). Disowns a capture subshell that tails
  the transcript, redacts secrets, and writes a JSONL entry to
  `compound-staging/pending/<session_id>.jsonl`. Guards: recursion guard
  via `COMPOUND_DRAIN_IN_PROGRESS=1`, `stop_hook_active` re-entrancy guard.
- `hooks/scripts/_stop-capture-subshell.sh` — runs disowned after the
  Stop hook parent exits. tail -100 + redact + sha256 + atomic JSONL write.
- `hooks/scripts/session-start.sh` — SessionStart hook (3s timeout) with
  reaper (orphan tmp >1h, stale `.drain-lock` >30min, PII TTL pending >7d,
  crashed processing/ >1h requeued) and drain dispatcher. Thresholds:
  count >= 5 OR oldest pending > 48h. Acquires `.drain-lock` via atomic
  mkdir, spawns disowned `claude -p` subshell with
  `COMPOUND_DRAIN_IN_PROGRESS=1` env var inherited.

**Wired in plugin.json:** inline `hooks` block registering Stop (timeout 5)
and SessionStart (timeout 3). No `async: true` — disowned-subshell pattern
is the non-blocking mechanism (D4 in the plan).

**Test coverage (44 new bats, all 83 in yellow-core suite green):**

- `tests/compound-staging.bats` (24 tests) — lib helpers: slug derivation,
  atomic write, redaction patterns, 5h budget rollover, auth-route detection,
  idempotent source guard
- `tests/compound-stop-hook.bats` (8 tests) — recursion guard,
  stop_hook_active guard, capture happy path, secret redaction
  (password + Bearer), content_hash dedup field, <500ms parent latency,
  capture-subshell standalone with missing transcript
- `tests/compound-session-start-hook.bats` (12 tests) — recursion guard,
  first-run fast-exit, threshold gates (count=5, count=4, age>48h),
  drain-lock honored + stale-lock reaped, PII TTL reap, crashed-processing
  requeue, orphan tmp reap, JSON output contract

**Stack context:** stack item #1 of 3
(agent/feat/compound-staging-hooks). Item #2 adds the staging-reviewer +
staging-scorer + staging-promoter agents the drain dispatches; item #3
adds the `/compound:review-staged` manual override, MEMORY.md partition,
RULE 14 lint, and docs.

**Behavior on install:** without item #2, the SessionStart drain dispatcher
checks for the staging-reviewer agent before spawning `claude -p` and
short-circuits when it is absent. No drain session is started; no cost is
incurred. Pending entries accumulate in `compound-staging/pending/` and are
reaped under the 7-day PII TTL. The pipeline is operationally inert until
item #2 lands — this is the intentional shape of an additive stack.
