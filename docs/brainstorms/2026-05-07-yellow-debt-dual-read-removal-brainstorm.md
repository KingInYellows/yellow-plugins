---
title: "Should yellow-debt remove the v1.0 dual-read code path?"
date: "2026-05-07"
topic: yellow-debt dual-read removal
plan-ref: plans/complete/pr-316-yellow-debt-residual-review-cleanup.md Phase 4
---

# Brainstorm: Should yellow-debt Remove the v1.0 Dual-Read Code Path?

## What We're Building

A design decision about whether to remove the v1.0 schema compatibility path
from `audit-synthesizer.md` (Step 1 dual-read branch + `_migrated_from` stamp)
and `debt-conventions/SKILL.md` (Schema Migration table), now that all five
bundled scanners emit v2.0 and `.debt/scanner-output/` is gitignored.

The code in question:

- **audit-synthesizer.md Step 1** (~14 lines): version-sniffing branch,
  field-mapping logic, multi-file fan-out, `_migrated_from: "1.0"` stamp,
  `stats.migrated_from_v1` counter
- **audit-synthesizer.md Step 4 rule 4**: `+0.05` confidence bump triggered by
  `_migrated_from: "1.0"` OR `failure_scenario == null`
- **SKILL.md "Schema Migration (v1.0 → v2.0)"** section: field-mapping table,
  transition-window closure criteria

The three plan outcomes: **(a) remove now**, **(b) keep with TODO**, **(c) keep
permanently**.

---

## Key Questions Explored

### 1. Is the gitignore claim load-bearing?

The YAGNI brief rests on the assertion that no v1.0 artifact can survive a
re-run because the directory is gitignored. This claim needs stress-testing.

**Paths that could produce v1.0 artifacts post-upgrade:**

| Path | Realistic? |
|---|---|
| User ran v1.0 scanner before upgrading plugin, directory still has stale files | Yes — a git-pull of plugin files does not re-run the scanner |
| User copies `.debt/scanner-output/` between machines manually | Rare but plausible (e.g., CI artifact export) |
| User accidentally un-gitignores the directory and commits files | Low — requires two deliberate steps |
| CI exports scanner output as a build artifact and imports it in a later step | Possible for repos with multi-stage pipelines |
| User checks in an artifact via `git add -f` | Requires explicit force-add; low |

The gitignore claim is partially load-bearing but not airtight. The gitignore
prevents *passive* accumulation of stale v1.0 files, but it does not prevent
*active* placement. The question is whether the failure mode — silent migration
vs hard error — changes the answer.

**Silent migration (current behavior):** A user with a stale v1.0 artifact gets
a normalized result with a warning logged to stderr. The synthesizer continues.
This is a graceful degradation.

**Hard error (post-removal behavior):** A user with a stale v1.0 artifact gets
an unambiguous message: "Re-run the scanner." This is a slightly worse UX for
the rare case, but it is unambiguous about the cause and immediately actionable.
It also prevents the synthesizer from silently producing results that mix
migrated and native v2.0 quality (migrated records have `failure_scenario: null`
by construction, reducing audit richness with no visible signal to the user).

Verdict: The gitignore claim is strong enough to shift the burden of proof to
the defense-in-depth side. The failure mode after removal is a hard error with
a clear message, which is acceptable.

---

### 2. What happens on a v1.0 input after removal?

The solutions doc prescribes emitting a clear error. The synthesizer's Step 1
currently has a clean version-sniff branch, so the removal path is well-defined:

**Current structure (simplified):**

```
if schema_version == "2.0":
    pass through
elif schema_version == "1.0" or missing:
    apply migration
    stamp _migrated_from
    update stats.migrated_from_v1
```

**Post-removal structure:**

```
if schema_version == "2.0":
    pass through
else:
    log warning: "Found v1.0 (or unversioned) scanner output at <file>.
    This schema is no longer supported. Re-run the scanner."
    skip file
```

The skip-file behavior (already present for malformed files in the current
Step 1 tail: "Skip malformed files entirely — log error, continue") means the
error path is not novel. The synthesizer already has a clean "skip with log"
pattern for files it cannot process. A v1.0 hard error is structurally
identical to the malformed-file path.

**UX for the re-upgrade scenario:** A user who upgrades the plugin, then runs
`/debt:audit` before re-running scanners, sees errors in the synthesis step
pointing to specific files. They re-run `/debt:audit` (which triggers scanners
first, regenerating outputs) and the errors disappear. This is a one-extra-run
UX cost, which is acceptable given the rarity.

**Edge case: user who runs synthesizer-only** (if such a command exists). The
audit command always runs scanners before synthesis, so this edge case does not
apply in normal workflows.

Verdict: The error path after removal is clean, well-precedented in the existing
code, and immediately actionable by the user.

---

### 3. Coupling of `_migrated_from` to the `+0.05` bump

This is the sharpest technical question. Step 4 rule 4 reads:

> If the finding is stamped `_migrated_from: "1.0"` OR has
> `failure_scenario == null`, add `+0.05` to the category threshold.

There are **two independent triggers** combined in a single rule:

- Trigger A: `_migrated_from: "1.0"` — keyed to v1.0 migration. Expires when
  dual-read is removed.
- Trigger B: `failure_scenario == null` — keyed to v2.0 records that legitimately
  omit the field. The Step 4 prose explicitly states: "the bump for v2.0 `null`
  scenarios remains as a permanent calibration mechanism."

If dual-read is removed, Trigger A can never fire (no v1.0 records reach Step 4
— they are rejected at Step 1). Trigger B continues to work independently.

**The PR1 round-1 fix already decoupled these.** The original implementation
used only `_migrated_from: "1.0"` as the trigger; the round-1 fix widened it to
the OR condition precisely to ensure that v2.0 `null`-failure-scenario records
also get the bump. This means removing Trigger A does not regress v2.0
calibration — Trigger B covers all remaining v2.0 records that need the bump.

**Post-removal Step 4 rule 4:**

> If the finding has `failure_scenario == null`, add `+0.05` to the category
> threshold for this finding only.

This is strictly simpler and equally correct for the v2.0-only world.

Verdict: Removing `_migrated_from` trigger does not regress calibration.
Trigger B is self-sufficient. The decoupling is already done.

---

### 4. Sunk-cost assessment

The dual-read code is written, tested, and shipped. The temptation is to keep it
because "we already paid for it." But the ongoing cost is not zero:

- Every future author editing Step 1 must understand the migration branch even
  though it never fires in the supported workflow.
- Every review of `audit-synthesizer.md` must verify the dual-read branch is
  still consistent with the downstream steps that read the normalized shape.
- SKILL.md's Schema Migration table must stay synchronized with Step 1's
  field-mapping logic — this was the source of the P2/P3 findings in PR #316's
  multi-agent review.
- The `stats.migrated_from_v1` counter will always be 0 in any real audit,
  creating dead telemetry in the report.

The sunk cost is the initial implementation effort. The ongoing cost is
maintenance surface on three files that must agree. This is a net-negative
balance going forward.

---

### 5. Cross-doc decay risk

The SKILL.md Schema Migration section is the sharpest ongoing risk. It contains
a detailed field-mapping table plus the transition-window closure criterion
("until all scanners on `main` emit v2.0 and no `.debt/scanner-output/*.json`
files older than 30 days remain in active project trees"). This criterion is
non-falsifiable from inside the plugin, as noted in the solutions doc.

If the dual-read code is kept, this criterion becomes permanently open — there
is no in-process way to know when "active project trees" have cleared their
stale files. The SKILL.md will either be updated to remove the criterion
(inconsistency with the code's actual behavior) or left as-is (misleading
documentation). Either outcome is worse than removal.

The three-file sync requirement (audit-synthesizer.md Step 1 + Step 4 +
SKILL.md table) is exactly the kind of multi-point coupling that produces
documentation drift. PR #316's review surfaced multiple P2/P3 findings from
exactly this pattern.

---

### 6. Version bump if removed

**The on-disk contract question:** Removing v1.0 support is a breaking change
to the schema contract. But the question is: what contract?

- `.debt/scanner-output/` is gitignored — not a committed artifact. Users do
  not version-control it or rely on it persisting across plugin upgrades.
- The breaking change affects only users who (a) have stale v1.0 artifacts in
  the directory, AND (b) run synthesis without re-running scanners first.
- The audit command (`/debt:audit`) always runs scanners before synthesis, so
  path (b) is not the primary user flow.

**Is a major bump warranted?** The `docs/CLAUDE.md` bump guide says:
"major — breaking change or removal of a command." This is not a command
removal. The conventional interpretation of "breaking" for a plugin is "a user
flow that worked before now fails." The relevant flow — running `/debt:audit`
after upgrading — would not fail because the audit command re-runs scanners.
The only failure is the manual-synthesis-without-scanner-rerun path, which
is not a documented workflow.

Verdict: A `patch` changeset is defensible (internal implementation change,
no public command API change). A `minor` is conservative and safe. A `major`
is over-signaling for a gitignored artifact change. The plan already notes
"patch" as the type.

---

## Approaches Considered

### Approach A: Remove now (Option a)

Remove the v1.0 dual-read branch from Step 1, replace with a hard error (skip
with clear message). Remove the `_migrated_from` trigger from Step 4 rule 4
(keep the `failure_scenario == null` trigger unchanged). Remove SKILL.md Schema
Migration section. Remove `_migrated_from` documentation added in Phase 2.

**Pros:**
- Eliminates ~14 lines of dead code from audit-synthesizer.md
- Removes the non-falsifiable closure criterion from SKILL.md
- Eliminates `stats.migrated_from_v1` dead telemetry counter
- Reduces Step 4 rule 4 to a single-trigger rule (simpler, less ambiguous)
- Prevents future documentation drift between three files that must agree
- The error path (hard error + skip) is already present for malformed files —
  not a new code pattern

**Cons:**
- Users with stale v1.0 artifacts get a hard error instead of a graceful
  migration (though the error is immediately actionable)
- Requires a changeset entry (minor work)
- If a scanner emitting v1.0 is discovered in the wild (e.g., a fork or third-
  party scanner), users get no graceful path

**Best when:** The gitignored-artifact reality holds and the team is willing to
treat "re-run the scanner" as acceptable UX for the rare stale-artifact case.

---

### Approach B: Keep with explicit TODO (Option b)

No code changes. Add (or confirm the existing) TODO comment in Step 1 with a
falsifiable removal trigger:

```
# TODO: Remove this branch when stats.migrated_from_v1 has been 0 across
# 5 consecutive audit runs in this project. At that point, replace with
# a hard error (see dual-read-migration-window-gitignored-artifacts.md).
```

Open a tracker issue so the TODO has an owner and does not rot silently.

**Pros:**
- Zero code change risk
- Preserves graceful migration for the rare stale-artifact case
- The TODO trigger is per-project-falsifiable (counter check)

**Cons:**
- The SKILL.md closure criterion remains non-falsifiable as written — would
  need to be updated to match the per-project trigger above
- Adds ongoing sync surface between three files
- `stats.migrated_from_v1` counter produces dead telemetry in all real audits
- The TODO will likely never be acted on (no one will check the counter after
  5 audit runs)
- The tracker issue adds overhead without changing the code

**Best when:** The team is uncertain whether third-party v1.0 scanners exist
in the wild and wants an escape hatch.

---

### Approach C: Keep permanently (Option c)

Reframe the Schema Migration section in SKILL.md as a "Permanent v1.0
Compatibility Path." Remove the closure-criterion language. Accept the dual-
read code as a permanent feature.

**Pros:**
- Maximum compatibility for any v1.0 artifact that might appear
- No code change required

**Cons:**
- The defense-in-depth framing requires that v1.0 artifacts be a real threat
  in a supported workflow. They are not — the gitignored directory and
  all-scanners-migrated condition make this threat hypothetical.
- Permanently accepts three-file sync maintenance cost
- Permanently accepts dead `stats.migrated_from_v1` telemetry
- Reframing as "permanent" goes against the explicit intent of the original
  PR author (who wrote a closure criterion, signaling intent to remove)

**Best when:** Third-party scanners that emit v1.0 are a known, common use
case. This is not established for yellow-debt.

---

## Why This Approach (Recommendation)

**Recommendation: Approach A — remove now.**

The defense-in-depth argument for keeping the dual-read code requires a threat
model where v1.0 artifacts appear in a supported workflow. Constructing that
argument charitably:

> Users may have run the v1.0 scanner before upgrading. The synthesizer could
> encounter stale files. A hard error is a worse experience than a graceful
> migration. The code is already written and tested. Defense in depth is cheap
> when the code exists.

This argument has three weaknesses:

1. **"Already written" is a sunk cost, not a reason to keep.** The ongoing cost
   is prose maintenance on three files, dead telemetry in every audit report,
   and a non-falsifiable closure criterion that permanently bloats SKILL.md.

2. **The threat does not materialize in the primary workflow.** `/debt:audit`
   runs scanners before synthesis. A user who upgrades and runs `/debt:audit`
   immediately gets fresh v2.0 artifacts. Only a user who runs synthesis in
   isolation against a stale directory encounters the error — and that user
   gets a clear, actionable message.

3. **The `+0.05` bump decoupling is already done.** The one genuine technical
   dependency — Step 4 rule 4's `_migrated_from` trigger — has already been
   made independent of the `failure_scenario == null` trigger by the PR1
   round-1 fix. Removing the v1.0 trigger does not regress v2.0 calibration.

The YAGNI brief correctly identifies the gitignore + all-producers-migrated
condition as making the transition window trivially closed on the day of the PR.
The defense-in-depth argument does not produce a scenario where the dual-read
code prevents a user from losing work or getting incorrect results — it produces
a scenario where one rare flow gives a hard error instead of a silent migration.
That is not the class of threat that justifies permanent maintenance cost.

---

## Open Questions

1. **Third-party scanners:** Are there known third-party or forked scanners that
   emit v1.0? If yes, Approach A produces immediate hard errors for those users
   with no migration path. This should be confirmed before removal.

2. **CI artifact export pattern:** Do any known users of yellow-debt export
   `.debt/scanner-output/` as CI build artifacts and import them in later steps?
   If yes, the gitignore claim is irrelevant for those users.

3. **`stats.migrated_from_v1` counter consumers:** Is the `migrated_from_v1`
   counter surfaced in any report output, dashboard, or hook? If yes, removing
   it requires updating those consumers.

---

## Follow-Up Checklist (Path A: Remove Now)

Mapped to Phase 4 task list in `plans/complete/pr-316-yellow-debt-residual-review-cleanup.md`:

**Task 4.2 implementation steps:**

- [ ] **audit-synthesizer.md Step 1**: Remove the v1.0 migration branch (~14
  lines: field mapping, `_migrated_from` stamp, `stats.migrated_from_v1`
  increment, multi-file fan-out logic). Replace with:
  ```
  - **v1.0** (`schema_version: "1.0"` or missing) — not supported. Log:
    `[synthesizer] Error: <file>.json is schema_version 1.0 which is no longer
    supported. Re-run the scanner to generate a v2.0 output.` Skip the file.
  ```

- [ ] **audit-synthesizer.md Step 4 rule 4**: Remove the `_migrated_from: "1.0"`
  OR clause. Rewrite rule 4 as:
  ```
  4. **Missing-failure-scenario bump.** If the finding has
     `failure_scenario == null`, add `+0.05` to the category threshold for
     this finding only. [rest of explanation unchanged]
  ```
  Remove the "expires when the transition window closes" language from the
  rule 4 prose (it no longer applies; the `failure_scenario == null` arm
  is permanent).

- [ ] **SKILL.md**: Remove the "Schema Migration (v1.0 → v2.0)" section
  (lines 360-376 approximately). The section exists to document the dual-read
  behavior for scanner authors; without the dual-read code, scanner authors
  have no migration to implement.

- [ ] **Phase 2 `_migrated_from` documentation**: Remove any `_migrated_from`
  documentation added during Phase 2 cleanup (check audit-synthesizer.md and
  SKILL.md for any references added in that phase that are not part of Step 1
  or Step 4).

- [ ] **stats schema**: Verify whether `stats.migrated_from_v1` appears in a
  stats schema definition or downstream report. If yes, remove the field and
  any report references.

- [ ] **Changeset**: `pnpm changeset` with type `patch`. Changeset body:
  ```
  BREAKING CHANGE (low-impact): v1.0 scanner output schema is no longer
  accepted. The synthesizer now emits a hard error for v1.0 artifacts and
  skips them. Re-run all scanners after upgrading to regenerate v2.0 outputs.
  The audit command (/debt:audit) performs this automatically.
  ```

- [ ] **Validation**: Run `pnpm validate:schemas && pnpm validate:plugins` to
  confirm no regressions.

- [ ] **Commit type**: `refactor:` (internal simplification, no public API
  change).

---

**Decision: (a) remove now — Rationale:** The gitignored artifact directory and all-scanners-migrated condition mean the transition window was already closed on the day PR #316 landed. The defense-in-depth argument requires a v1.0 artifact to appear in a supported workflow, but the primary user flow (`/debt:audit`) regenerates artifacts before synthesis, making stale-artifact encounters structurally rare. The `_migrated_from` trigger in Step 4 rule 4 has already been decoupled from the `failure_scenario == null` permanent calibration by the PR1 round-1 fix, so removal does not regress v2.0 scoring. The ongoing cost — three-file prose synchronization, dead `stats.migrated_from_v1` telemetry, and a non-falsifiable closure criterion in SKILL.md — is real and was the source of most P2/P3 findings in PR #316's review. Hard error + skip is a clean, already-precedented code path in the synthesizer, and the error message is immediately actionable. Remove now.
