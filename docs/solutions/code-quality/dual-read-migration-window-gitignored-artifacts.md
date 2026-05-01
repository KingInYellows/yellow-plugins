---
title: "Dual-Read Migration Windows for Gitignored Artifacts Are YAGNI"
date: "2026-05-01"
category: code-quality
track: knowledge
problem: "Dual-read v1/v2 transition code for gitignored artifact dirs is dead-on-arrival: no old artifact can persist across a re-run"
tags:
  - schema-migration
  - yagni
  - gitignore
  - plugin-authoring
  - yellow-debt
  - dead-code
  - migration-windows
components:
  - plugins/yellow-debt/agents/synthesis/audit-synthesizer.md
  - plugins/yellow-debt/.debt/.gitignore
---

# Dual-Read Migration Windows for Gitignored Artifacts Are YAGNI

Discovered during multi-agent review of PR #316
(`feat(yellow-debt): scanner output schema v2.0 with confidence-rubric
calibration`). The synthesizer's Step 1 added a dual-read path to support
both v1.0 and v2.0 scanner outputs during a "transition window" — but the
artifact directory is gitignored and all scanners were migrated to v2.0 in
the same PR, making the v1.0 path dead-on-arrival. (A user who ran the v1.0
scanner locally before upgrading could have stale on-disk artifacts, but
because the directory is gitignored those files require manual placement —
they are never shared or restored by git, so the dual-read path would serve
only that narrow manual-intervention case.)

## Context

The yellow-debt plugin stores scanner outputs in `.debt/scanner-output/`,
which is listed in `plugins/yellow-debt/.debt/.gitignore`. The v2.0 schema
PR also migrated all 5 bundled scanners to emit v2.0. The dual-read
transition code included:

- A version-sniffing branch in Step 1 (`_schema_version` field detection)
- A `_migrated_from: v1.0` stamp written to migrated outputs
- A `+0.05` confidence bump rule for migrated v1.0 findings
- A closure criterion: "until all scanners on `main` emit v2.0 and no
  `.debt/scanner-output/*.json` files older than 30 days remain in active
  project trees"

The closure criterion is non-falsifiable from inside the plugin — it cannot
enumerate "active project trees." So the dual-read code has no removal
trigger.

## Guidance

### Decision Rule Before Writing Dual-Read Migration Code

Before adding v1/v2 dual-read logic, answer three questions:

| Question | Answer for this case | Verdict |
|---|---|---|
| Is the artifact directory gitignored? | Yes (`.debt/.gitignore`) | → |
| Does any scanner still emit the old version? | No (all 5 migrated in same PR) | → |
| Can a user have stale on-disk artifacts? | Only via manual placement | → SKIP dual-read |

If all three conditions hold (gitignored + all producers migrated + stale
path requires manual intervention), the dual-read code is dead-on-arrival.
**Skip it entirely.** Document the breaking change in the changeset and let
users re-run scanners.

### YAGNI Red Flags in Dual-Read Closure Criteria

A closure criterion is a red flag if it cannot be verified from inside the
plugin:

**Red flag — non-falsifiable:**

```text
"until no .debt/scanner-output/*.json files older than 30 days remain
in active project trees"
```

The plugin cannot enumerate "active project trees." This criterion is
permanently open.

**Acceptable — binary check:**

```text
"until all rows in .debt/scanner-output/*.json have schema_version: 2"
```

Verifiable via a simple glob + jq check inside the plugin on each run.

Even a binary check is unnecessary when the artifact is gitignored. Binary
closure criteria are appropriate for non-gitignored artifacts (committed
config files, database rows, on-disk caches that persist across deployments).

### What to Do Instead

When all producers are migrated and the artifact is gitignored:

1. Remove the dual-read branch entirely.
2. Emit a clear error if a v1.0 artifact is encountered, rather than
   silently migrating it:

   ```text
   ERROR: Found v1.0 scanner output at .debt/scanner-output/foo.json.
   This schema is no longer supported. Re-run the scanner to generate
   a v2.0 output.
   ```

3. Document the breaking schema change in the changeset:

   ```markdown
   BREAKING CHANGE: Scanner output schema v1.0 is no longer supported.
   Re-run all scanners after upgrading to regenerate outputs.
   ```


## Why This Matters

Dual-read migration windows add real cost: prose complexity in the agent
step, new test surface (`_migrated_from` stamp, `+0.05` bump rule), and an
open-ended "TODO: remove this" comment that accumulates across PRs. For
gitignored artifacts this cost has zero runtime benefit — the transition
window is trivially already closed on the day the PR lands, because no v1.0
artifact can survive a re-run.

The "defense-in-depth" framing for dual-read on gitignored artifacts
misidentifies the risk. Defense in depth is appropriate when a threat exists
(e.g., a user might have a committed v1.0 file that deserves smooth
migration). It is not appropriate when the threat cannot materialize in the
supported workflow.

## When Dual-Read IS Justified

Write dual-read transition code when:

- The artifact is **not** gitignored (committed config files, database rows,
  workspace-local state that persists across plugin versions).
- At least one producer in the wild still emits the old schema version.
- The closure criterion is a **binary, in-process check** (e.g., "all
  `.debt/config.yaml` files have `schema: 2` field").
- The migration window is bounded by a concrete date or event, not by an
  external condition the plugin cannot observe.

## Examples

**Dead-on-arrival (this case):** `.debt/scanner-output/` is gitignored,
all 5 scanners migrated in same PR → skip dual-read, emit error on v1.0 input.

**Justified dual-read:** A committed `plugins/<name>/.debt/config.yaml` is
being renamed from `enabled:` to `active:`. Users have checked this file
into their repos. The transition reads both fields, preferring `active:`,
until all configs have been migrated (detectable by checking for `enabled:`
presence on each run).

---

## Related Documentation

- `docs/solutions/code-quality/multi-doc-schema-rename-drift.md` — How to avoid documentation drift
  during the same schema rename
- `docs/solutions/build-errors/plugin-json-changelog-key-schema-drift-remote-validator.md` —
  Schema drift in CI/manifest context
