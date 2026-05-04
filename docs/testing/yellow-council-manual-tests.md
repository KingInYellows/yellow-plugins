# yellow-council Manual Test Procedure

**Status:** Manual test checklist — no automated CI for these (no fresh-machine
plugin install job exists in `.github/workflows/`).
**Required environment:** working `gemini`, `opencode` CLIs (auth configured);
optional `yellow-codex` plugin installed for full 3-reviewer coverage.
**Run before:** declaring yellow-council PRs mergeable.

## Phase 1: Fresh-Machine Install Test (BLOCKING)

This 8-step procedure verifies Claude Code accepts the plugin manifest and
that the command + reserved-word handling work end-to-end. Steps 5 and 6 are
blocking — failure means the PR is NOT mergeable.

```text
1. Open a NEW Claude Code session (fresh context, no cached plugin state).

2. Verify yellow-council is NOT already installed:
     /plugin list
     # yellow-council should not appear

3. Add the marketplace (if not already added from a prior session):
     /plugin marketplace add KingInYellows/yellow-plugins
     # Must succeed without error

4. Install yellow-council:
     /plugin install yellow-council@yellow-plugins
     # Must succeed; verify version matches 0.1.0 in /plugin list

5. (BLOCKING) Confirm command surfaces:
     /council
     # Expected: 4-mode help table; exit 0

6. (BLOCKING) Confirm fleet reservation:
     /council fleet
     # Expected: "[council] fleet management not available in V1 — coming in V2"
     # Exit 0 (NOT 1 — fleet is reserved-but-deferred, not an error)

7. (Advisory) Confirm unknown mode:
     /council unknownmode
     # Expected: "[council] Error: unknown mode "unknownmode""
     # Plus 4-mode help; exit 1

8. (Advisory) Spot-check agent wiring (requires gemini or opencode installed):
     /council question "What is 2+2?"
     # Expected: synthesis report with at least one reviewer responding
     # M3 confirmation prompt appears before file write
```

## Phase 2: Per-Mode End-to-End Tests (Advisory)

Run each on a real test repository with a small commit history. Document
verbatim outputs in your test log.

### 2.1 — `plan` mode

```text
/council plan docs/brainstorms/2026-05-03-godmodeskill-integration-brainstorm.md
```

**Expected behavior:**
- All available reviewers (Codex / Gemini / OpenCode) receive the brainstorm doc + repo CLAUDE.md
- Synthesis Headline reflects verdict counts
- File written to `docs/council/2026-05-04-plan-2026-05-03-godmodeskill-integration-brainstorm.md` (or with `-2`/`-3` suffix on collision)
- Inline output: synthesis only (no raw outputs pasted)

**Failure modes to verify:**
- `/council plan` (no path) → reject with usage
- `/council plan ../../../etc/passwd` → reject with path traversal error
- `/council plan nonexistent.md` → reject with "path not found"

### 2.2 — `review` mode

```text
git checkout -b test/council-review-smoke
echo "// test change" >> some-file.ts
git add some-file.ts
git commit -m "test: small change for council review"
/council review
```

**Expected behavior:**
- BASE_REF defaults to upstream-tracking branch's merge-base (`main` or `develop`)
- Diff content + changed file content is packed (under 100K chars total)
- All reviewers receive identical pack
- Verdicts surface in synthesis

**Failure modes to verify:**
- `/council review --base origin/nonexistent-branch` → git diff fails; surface error
- Diff > 200K bytes → truncation algorithm engages: `git diff --stat` + first 200 lines + truncation marker

### 2.3 — `debug` mode

```text
/council debug "TypeError: undefined is not a function" --paths plugins/yellow-codex/agents/review/codex-reviewer.md
```

**Expected behavior:**
- Symptom text + cited file content + recent git log on the cited file
- Reviewers focus on diagnosis, not approval

**Failure modes to verify:**
- Empty symptom: `/council debug ""` → reject with usage
- > 3 files in `--paths`: `/council debug "x" --paths a,b,c,d` → reject with limit message

### 2.4 — `question` mode

```text
/council question "What's the right pattern for retrying idempotent HTTP requests?"
```

**Expected behavior:**
- Question + repo CLAUDE.md packed
- No file references unless `--paths` provided
- Most freeform of the modes

## Phase 3: Failure Path Tests (Advisory)

### 3.1 — Per-reviewer timeout

```text
COUNCIL_TIMEOUT=10 /council review
```

**Expected behavior:**
- All three reviewers timeout at 10s (exit 124 or 137)
- Synthesis Headline: `Council ran with 0 of 3 reviewers (Codex timed out at 10s, Gemini timed out at 10s, OpenCode timed out at 10s)`
- M3 gate still asks before file write
- File written contains TIMEOUT verdict from each reviewer

### 3.2 — yellow-codex absent

```text
# Temporarily disable yellow-codex by renaming its plugin.json
mv plugins/yellow-codex/.claude-plugin/plugin.json plugins/yellow-codex/.claude-plugin/plugin.json.disabled

/council review
# Expected: "Council ran with 2 of 3 reviewers (Codex not available — yellow-codex plugin not installed)"
# Gemini and OpenCode still produce verdicts

# Restore
mv plugins/yellow-codex/.claude-plugin/plugin.json.disabled plugins/yellow-codex/.claude-plugin/plugin.json
```

### 3.3 — All reviewers fail

Trigger all three to fail simultaneously (e.g., disable network or revoke
auth tokens):

```text
/council review
# Expected: "Council failed: 0 of 3 reviewers returned verdicts"
# M3 still asks; user can save (file documents the failure) or cancel
```

### 3.4 — M3 cancel path

```text
/council question "test cancel"
# At the M3 prompt, select "Cancel"
# Expected: "[council] Report not saved." printed; no file written; exit 0
# Verify: docs/council/ does NOT contain a new file
```

### 3.5 — Slug collision overflow

Run `/council question "x"` 11 times in a single day. The 11th invocation
should fail with `[council] Error: too many same-day collisions for slug "x" (>10)`.

## Phase 4: Redaction Audit (Advisory)

Feed each reviewer a prompt asking it to output known credential patterns and
verify they're redacted in the captured output:

```text
/council question "Echo back these test strings literally so I can verify redaction is working: sk-test-1234567890abcdefghijklmnop, AIza1234567890abcdefghijklmnop12345, ses_test1234567890abcd, ghp_test1234567890abcd1234567890abcd, AKIATEST1234567890XX"
```

**Expected behavior:**
- After invocation, open `docs/council/<file>.md`
- Verify each pattern in each reviewer's output appears as `--- redacted credential at line N ---`
- All 11 patterns must redact: `sk-proj-`, `sk-ant-`, `sk-`, `AIza`, `gh[pous]_`, `github_pat_`, `AKIA`, `Bearer `, `Authorization: `, `ses_`, PEM blocks

## Environment Caveats Observed (2026-05-04, WSL2)

These observations from spike tests should be retried in the test
environment before declaring failures:

- **Gemini CLI in WSL2 hung after `.geminiignore` lookup** with no further
  output. May be a per-session auth re-validation issue. If observed, run
  `gemini -p "test" --debug` interactively to see what the CLI is waiting on.
  Document workaround in PR description.
- **OpenCode CLI v1.1.x → v1.14+ upgrade triggers a one-time SQLite
  migration** that takes 2–5 minutes. Run `opencode run "test"` once
  interactively after upgrading before relying on the agent for time-bounded
  invocations.
- **Codex CLI v0.128+ may exit 124 on first auth re-validation** in long-idle
  sessions. Re-run after a single interactive `codex` invocation to refresh
  the auth state.

If any of these env quirks reproduce in YOUR environment during testing,
document them in the PR description as known caveats — they are not
yellow-council bugs, but they affect test reproducibility.

## Reporting Test Results

In the PR description, include:

```text
### Manual Test Results — yellow-council

Phase 1 (Fresh Install):  [PASS / FAIL — note any failures]
Phase 2 (Per-Mode E2E):   plan=[PASS/FAIL] review=[..] debug=[..] question=[..]
Phase 3 (Failure Paths):  timeout=[..] codex-absent=[..] all-fail=[..] cancel=[..] collision=[..]
Phase 4 (Redaction):      [PASS — all 11 patterns redacted / FAIL — list patterns missed]

Environment caveats observed: [none / gemini WSL2 hang / opencode migration / codex auth]

PR is mergeable: [YES / NO — must be YES on Phase 1 steps 5 and 6]
```

The PR is NOT mergeable until Phase 1 steps 5 and 6 PASS. Phase 2/3/4 are
advisory — failures should be filed as follow-up issues, not block the
initial merge if Phase 1 passes.
