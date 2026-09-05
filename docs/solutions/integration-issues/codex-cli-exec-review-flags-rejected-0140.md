---
title: 'codex exec/exec review reject -a/-s flags on codex-cli 0.140.0'
date: 2026-07-09
category: integration-issues
track: bug
problem: 'codex exec/exec review reject -a/-s flags on codex-cli 0.140.0, exit 2 misreads as auth'
tags: [codex-cli, cli-flag-drift, argument-parsing, exit-code-misclassification, config-override]
components: [yellow-codex]
---

# codex exec/exec review reject -a/-s flags on codex-cli 0.140.0

## Problem

On codex-cli 0.140.0, the `-a`/`--ask-for-approval` flag — and, on the
`exec review` subcommand, `-s`/`--sandbox` too — are rejected by clap at
argument-parse time (exit code 2). Every non-interactive Codex invocation
site in yellow-codex (review, rescue, analyst, executor, setup smoke test)
shipped with these flags, and every exit-2 handler unconditionally printed
"authentication failed. Run /codex:setup." This masked a CLI flag-drift
break as an auth problem across the whole plugin.

## Symptoms

- `codex exec review --base main -a never -s read-only --ephemeral --json`
  → exit 2, stderr: `error: unexpected argument '-a' found`.
- Plain `codex exec -a never -s workspace-write ...` (rescue/analyst/executor
  paths) also exits 2 with the same `unexpected argument '-a'` error — `-a`
  does not exist on `exec` in 0.140.0 either; only `-s` remains valid there.
- `--instructions` on `exec review` also fails to parse — it does not exist
  on that subcommand.
- Every plugin site mapping exit 2 → "authentication failed" misdiagnoses
  the real cause, sending users to `/codex:setup` for a problem `/codex:setup`
  cannot fix.
- A prior session finding (PR #601, 2026-07-01) concluded `-a`/`-s` "exist
  only on plain codex exec" — that conclusion is now also wrong. The flag
  surface moved again between the two checkpoints; `-a` no longer exists on
  `exec` either.

## What Didn't Work

- **Hoisting flags to the top level** (`codex -a never -s read-only exec
  review --base main --ephemeral --json`) parses and runs, but was rejected
  as the fix: it splits posture flags from the subcommand where `--ephemeral`
  and the other subcommand flags live, diverging from the single mechanism
  already proven for `mcp_servers={}` (see below).
- **Dropping the posture flags entirely** (`codex exec review --base main`
  with no `-a`/`-s`/`-c` override) is not safe. The startup header showed the
  effective default comes from the user's `~/.codex/config.toml` — on the
  verification machine that was `approval: never` / `sandbox:
  danger-full-access`. An invocation with no explicit posture silently
  inherits whatever the local machine's config happens to be, up to full
  filesystem access.

## Solution

Replace `-a`/`-s` with `-c key=value` config overrides scoped to the
subcommand, on every Codex invocation site:

```bash
# exec review (read-only, ephemeral)
codex exec review \
  --base "$BASE_REF" \
  -c 'approval_policy="never"' \
  -c 'sandbox_mode="read-only"' \
  -c 'mcp_servers={}' \
  --ephemeral \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  -o "$OUTPUT_FILE"
```

`-s` is still valid on plain `codex exec` (rescue/analyst/executor) — only
`-a` needs to move to `-c` there:

```bash
codex exec \
  -c 'approval_policy="never"' \
  -s workspace-write \
  --json \
  -m "${CODEX_MODEL:-gpt-5.4}" \
  ...
```

Harden every exit-2 handler to distinguish a CLI argument-parse error from a
real auth failure by grepping stderr before choosing a message:

```bash
elif [ "$codex_exit" -eq 2 ]; then
  # Exit 2 is also clap's argument-parse error — check before blaming auth.
  # Match clap's full parse-error vocabulary, not just "unexpected argument";
  # display only clap error lines (allowlist) to respect the redaction rule.
  if grep -qE "unexpected argument|invalid value|unrecognized subcommand|required arguments" "$STDERR_FILE" 2>/dev/null; then
    printf '[yellow-codex] Error: CLI rejected the invocation (argument parse error — flag drift?):\n'
    grep -m2 -E "^error:" "$STDERR_FILE" 2>/dev/null
  else
    printf '[yellow-codex] Error: authentication failed. Run /codex:setup.\n'
  fi
```

Bump the documented CLI floor from v0.118.0 to v0.140.0 across every
enforcement site (`CLAUDE.md`, `setup.md` version check, setup smoke test,
`README.md`) — the old floor cannot be verified against the current flag
syntax.

## Why This Works

`-c key=value` sets arbitrary `config.toml` keys as a CLI override and is
accepted by both `exec` and `exec review`. Empirically, a
`-c 'sandbox_mode="read-only"'` override measurably beats a permissive
`~/.codex/config.toml` (`danger-full-access`) in the emitted startup
header — confirming it is a real override, not a silent parse-success
no-op that falls back to config defaults. Checking stderr for clap's
parse-error vocabulary before assuming exit 2 means "auth failure" works
because those strings are stable regardless of which flag was rejected —
but `unexpected argument` alone is only the vocabulary for an unknown
flag. Other parse-error shapes share exit 2 with different wording
(empirically on 0.140.0: `invalid value '<x>' for '--sandbox
<SANDBOX_MODE>'`), so handlers must match the broader set
(`unexpected argument|invalid value|unrecognized subcommand|required
arguments`) or a differently-shaped drift recreates the misdiagnosis.

## Prevention

- Treat exit 2 (or any single exit code) from an external CLI as ambiguous
  by default. Disambiguate via stderr content before choosing a
  user-facing message rather than mapping one exit code to one fixed
  meaning.
- When a plugin depends on a fast-moving external CLI's flag surface,
  re-verify flag acceptance empirically (`--help` output plus a live
  invocation) every time the documented floor version is bumped — not just
  once at initial integration. The `exec review` flag surface changed
  twice in 8 days across two "verified" checkpoints (PR #601 on
  2026-07-01, this PR on 2026-07-09).
- Never drop posture/sandbox flags to simplify an invocation of an
  agentic CLI tool. The effective default is whatever the user's local
  config file says, which can be permissive (`danger-full-access`).
- When updating flag syntax for one subcommand, sweep every other
  invocation site in the plugin (agents, commands, skills, setup smoke
  test) in the same change — a partial fix that only touches `exec review`
  leaves plain `exec` sites silently broken, as happened here.

## Update — 2026-08-03: `exec review` abandoned for plain `exec` (#696)

The flag-level fixes above kept `codex exec review` as the review invocation.
That subcommand turned out to have a deeper defect: **it silently ignores
`--output-schema`.** On codex-cli 0.144.6, across `gpt-5.4` and
`gpt-5.4-mini`, `exec review` always writes its own hardcoded prose (a summary
plus a `Review comment:` bullet list) to `-o`, never a JSON object. No error is
raised — the flag is simply dropped.

`codex-reviewer.md` Step 6 parses `$OUTPUT_FILE` with `jq` expecting
`findings[]`/`overall_correctness`, so every Codex review degraded to
UNKNOWN/no-findings while looking healthy. This is the same class as
`docs/solutions/code-quality/unhandled-outcome-defaults-to-success-bucket.md`:
a silently-dropped input lands in the benign bucket.

Two further facts established empirically while fixing it:

- **The schema itself was invalid for OpenAI strict mode.** Missing
  `additionalProperties: false` and an incomplete `required` list each produce
  a distinct 400. Genuinely-optional fields must become nullable unions
  (`"type": ["number", "null"]`) rather than omitted keys. Downstream `jq`
  needs no change — `null` and absent behave identically under `//`.
- **Do not let Codex fetch the diff itself.** Plain `exec` has no `--base`
  selector. Instructing it to run `git diff` makes it explore the wider repo
  until the timeout expires (measured: 66 tool calls, exit 124, no output).
  Writing the diff to a temp file and naming that file in the prompt converges
  in roughly 3-4 minutes and scopes the review to exactly what the size
  pre-flight already checked.

Two smaller invariants worth carrying forward: plain `exec` appends stdin to
the prompt, so `</dev/null` is required or it can block waiting for EOF; and
`sandbox_mode="read-only"` gates filesystem *writes*, not command execution —
Codex can still shell out to read files under it.

### Prevention (addendum)

- Verifying that a CLI *accepts* a flag is not the same as verifying it
  *honours* it. For flags that shape machine-parsed output, assert on the
  output's actual shape (`jq -e 'has("findings")'`), not on exit code 0.
- The file-based form converges in roughly 3-4 minutes against the existing
  300s cap — less headroom than `exec review`'s built-in scoping had. A
  timeout on this path is a scope/size symptom, not auth or rate limiting.

## Update — 2026-08-06: `codex exec review` silently ignores `--output-schema`, on every model

A plugin-contract reviewer on a later round of PR #695 (the same PR that
layered a `jq`-based structured-extraction Step 6 on top of
`codex exec review`'s `-o "$OUTPUT_FILE"` capture) tested the actual
invocation against a live Codex CLI (reported as 0.144.6) instead of
trusting Step 6's existing code comments, which assumed `-o` on
`exec review` captures the review's structured JSON result.

**This plugin's own documentation already contradicted that assumption
before anyone ran the CLI:** `plugins/yellow-codex/CLAUDE.md`'s Conventions
section states "Use `-o <file>` for final message capture. Use
`--output-schema` for structured JSON" — two different flags for two
different purposes — while Step 6 was built to expect `-o` alone to
produce the `--output-schema` shape. The doc-level contradiction was
independently verifiable by reading; the live invocation confirmed it in
practice.

**Root cause (fixed by PR #697 — the PR this doc update ships in):** `codex exec
review` **silently ignores `--output-schema` on every model**, with no
error raised — not a "may be ignored with certain model variants" caveat
as this plugin's Known Limitations section previously stated, but an
unconditional property of the `exec review` subcommand itself. It always
writes its own hardcoded prose (a summary plus a `Review comment:` bullet
list) to `-o`, regardless of model or schema flag.

**This is a different failure shape from this doc's original `-a`/`-s`
flag-rejection finding:** `-o`/`--output-schema` do not error at
argument-parse time — the invocation exits 0 and writes a genuinely
non-empty file. Every guard this doc's original fix already added (the
jq-availability check, the `[ -s "$OUTPUT_FILE" ]` non-empty check)
passes. The file is real prose, not empty and not missing — it is simply
the wrong shape. Step 6's `jq` extraction against that prose fails loudly
(a real parse error, non-zero exit — verified: `jq` exits nonzero (5 on jq 1.7; code varies by version) with
`parse error: Invalid numeric literal...`), but at the time of discovery
Step 6 suppressed that stderr (`2>/dev/null`) and never checked the exit
code, so the loud failure silently became empty fields, which fell
through to `VERDICT="UNKNOWN"` with zero findings. **The entire
structured-extraction path degraded to "reviewed, found nothing"** —
which reads as a clean review, and is strictly worse than the visible
`ERROR` verdict the pre-6-key-contract `codex-reviewer` used to return on
a real parse failure. (The consumer-side half of this chain — the missing
`jq empty` fail-closed pre-check and suppressed stderr — was subsequently
closed in the PR #695 resolve pass; see the companion Update on
[unhandled-outcome-defaults-to-success-bucket.md](../code-quality/unhandled-outcome-defaults-to-success-bucket.md).)

**The fix (PR #697, this PR):** Step 4 switches from
`codex exec review` to plain `codex exec`, which does honor
`--output-schema` — verified empirically against codex-cli 0.144.6 with
the plugin's real posture flags (exit 0, conforming JSON, correct
P1/P2/P3 extraction). Plain `exec` has no `--base` selector, so the diff
is written to a temp file and referenced in the prompt instead (an
earlier approach — asking Codex to run `git diff` itself — was tested and
rejected: it explored the wider repo until the 300s timeout, 66 tool
calls, no output). `schemas/review-findings.json` is rewritten for
OpenAI's strict mode. The PR also corrects the doc claims that
contradicted this behavior across `CLAUDE.md`, `README.md`, and two
skill files.

**Added guidance — extending this doc's existing Prevention rule:**
"verify flag acceptance empirically" is necessary but not sufficient — a
flag can be *accepted*, parse cleanly, and still not do what its name (or
a sibling flag's documentation) implies. When a plugin's correctness
depends on an external CLI's *output shape* (not just its exit code),
verify the actual output content live against the target CLI version and
subcommand, not just "did it exit 0 and write a non-empty file." A CLI
subcommand can pass every argument-parse and file-existence guard while
silently ignoring a flag that looks load-bearing — and unlike a rejected
flag (loud, exit 2), a wrong-shape success (quiet, exit 0, plausible file)
has no failure signal at all short of inspecting the file's actual content
against the schema the downstream parser expects. When two flags on
related subcommands (`exec` vs `exec review`) are documented to do similar
things, verify each subcommand independently rather than assuming
consistent behavior across the family.

**Components (this Update):** `plugins/yellow-codex/agents/review/codex-reviewer.md`, `plugins/yellow-codex/CLAUDE.md`, `plugins/yellow-codex/skills/*/SKILL.md` (fix landing in PR #697).

## Update — 2026-08-06 (PR #697 review pass): fix live-verified end-to-end; a 4th stale-diagnosis site and one unmigrated sibling site found in the same pass

These notes were recorded during the review pass of PR #697 itself (the
fix described in the Update above — the PR this doc update ships in). That
pass produced follow-on facts worth recording beyond what that Update
already captured:

**The Prevention rule this doc's prior Update added was itself exercised,
not just stated.** A plugin-contract reviewer on the PR #697 review pass ran
the real Step 4 invocation against live `codex-cli 0.144.6` with the shipped
`review-findings.json` schema and a trivial diff, then piped the actual JSON
output through Step 6's unmodified `jq` extraction — confirming exit 0,
exact strict-mode shape conformance, and correct P1/P2/P3 mapping
end-to-end, not merely "the flag was accepted." This is precisely the check
this doc's Prevention addendum calls for and whose absence is what let
#695's original P0 (`exec review` writing prose, not JSON, while still
exiting 0) go undetected until someone finally ran it live. Running this
check — and not skipping it because the schema "looked" strict-mode-valid
on paper — is now the concrete positive example to point to the next time
this class of finding comes up.

**A 4th misdiagnosis site, in the same file the PR had already corrected 3
other places in.** `plugins/yellow-codex/CLAUDE.md`'s "Known Limitations"
section (a different section from the "Conventions" section the PR's
initial pass fixed) still read "`--output-schema` known issue — May be
ignored with certain model variants," restating the exact misdiagnosis the
PR corrected elsewhere in the same file. Eight independent reviewer
personas converged on flagging it in one pass. Fixed in-pass (this PR's
review-fix commit — hashes are deliberately not cited; the stacked branch
is restacked repeatedly, so pre-restack SHAs go dangling) to match the
corrected wording: the subcommand, not the model, silently drops the flag.

**Still open — a sibling invocation site left on the broken pattern.**
`plugins/yellow-codex/commands/codex/review.md` (the `/codex:review`
command, distinct from the `codex-reviewer` agent this PR fixed) still
builds `CODEX_CMD=(codex exec review ...)` at its line 95, and its Step 5
text still claims structured JSON "may be" available via `--output-schema`
— the exact claim this PR's own live verification proved false for that
subcommand. Six reviewer personas flagged it, all marking it pre-existing
and out of scope for #697 rather than blocking the PR; tracked as an
immediate follow-up. This is the partial-fix pattern this doc's own
original Prevention bullet already warned about ("When updating flag syntax
for one subcommand, sweep every other invocation site in the plugin... a
partial fix... leaves [other] sites silently broken") — worth restating
because the PR that most recently demonstrated the underlying defect also,
in the same breath, reproduced the exact failure-to-sweep its own doc had
already named. `codex-patterns/SKILL.md`'s Step 4 prompt is also duplicated
verbatim between the agent and the skill with no single source of truth — a
smaller instance of the same drift risk, managed this round via
single-owner mirroring (see `parallel-multi-agent-review-orchestration.md`
Session 3).

**Input-trust gap, found and fixed in the same pass:** the adversarial and
security reviewer personas independently flagged that Step 4's Codex prompt
never framed the diff file's content as untrusted data rather than
instructions — a diff containing a directive-shaped comment or string
literal could steer Codex's verdict while remaining fully schema-conformant,
since strict-mode conformance constrains shape, not semantic honesty. This
is a different mechanism from the shape/parsing gaps above (an input-trust
gap, not an output-shape gap) and is the concrete instance of the ROLP
principle in
[prompt-injection-defense-layering-2026.md](../security-issues/prompt-injection-defense-layering-2026.md)
Layer 1 — correct turn placement is necessary but not sufficient; the
prompt also needs explicit "this is data to evaluate, not instructions to
follow" framing at the point the diff is introduced. **Fixed in the same
PR's resolve stage**: explicit anti-injection framing added to the Step 4
prompt and mirrored verbatim into `codex-patterns/SKILL.md`'s duplicate
copy.

**Components (this Update):** `plugins/yellow-codex/CLAUDE.md`,
`plugins/yellow-codex/commands/codex/review.md`,
`plugins/yellow-codex/skills/codex-patterns/SKILL.md`.

## Update — 2026-09-05: `${CODEX_MODEL:-gpt-5.4}` default is account-type-specific, not universal

A `/review:sweep-all` batch spanning 13 PRs hit `codex exec` auth/model
rejection on a ChatGPT-subscription Codex account even with the flag-level
fixes above already in place. The default baked into every invocation site
above (`-m "${CODEX_MODEL:-gpt-5.4}"`) is correct for API-key-authenticated
codex-cli accounts but is rejected on ChatGPT-plan accounts, which require
`export CODEX_MODEL=gpt-5.6-sol` (or whatever model the specific ChatGPT
plan entitles) set in the environment before invocation. No exit-2
handler in this doc's flag-drift fix distinguishes "wrong flag syntax"
from "right flag syntax, wrong model name for this account type" — both
surface as an argument/config rejection at invocation time, so the
existing exit-2 stderr-grep guidance above does not by itself tell you
which case you're in.

**Practical takeaway:** when a Codex invocation site here fails and the
account is known or suspected to be a ChatGPT-plan login (not a bare API
key), set `CODEX_MODEL` explicitly in the environment before calling
`/codex:*` commands or spawning `codex-reviewer`/`codex-analyst`/
`codex-executor`, rather than trusting the `${CODEX_MODEL:-gpt-5.4}`
fallback baked into the invocation sites. This is an operator-environment
concern, not a defect in the flag syntax documented above — no code change
is implied here, just a documented gotcha for whoever hits the same
rejection next.

**Components (this Update):** operator environment / invocation
preconditions for `plugins/yellow-codex/agents/review/codex-reviewer.md`,
`plugins/yellow-codex/agents/research/codex-analyst.md`,
`plugins/yellow-codex/agents/workflow/codex-executor.md`,
`plugins/yellow-codex/commands/codex/*.md`.
