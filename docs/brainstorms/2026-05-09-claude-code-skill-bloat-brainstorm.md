# Claude Code Skill Listing Bloat — Brainstorm

**Date:** 2026-05-09
**Status:** Ready for planning

## What We're Building

A two-part resolution to the `claude-doctor` warning about skill listing
truncation (179 descriptions dropped at 5.6% of context, 11k tokens for the
full listing):

1. **Immediate config fix** — raise `skillListingBudgetFraction` in user
   settings to stop the truncation warning today, with no code changes.
2. **Description audit PR** — a quality-driven pass over all 37 SKILL.md
   descriptions in the repo, cutting genuine redundancy while preserving
   context that strengthens skill selection.

The config fix is a bridge. The audit PR is the durable fix that also helps
marketplace consumers, not just the author's local setup.

---

## Immediate Operational Fix

**One-line change in `~/.claude/settings.json`:**

```json
"skillListingBudgetFraction": 0.06
```

**Where:** Add as a top-level key alongside the existing keys in the global
`~/.claude/settings.json` (not the project-level settings).

**Why 6%:** The `claude-doctor` warning reports the full skill listing costs
5.6% of context at current installed plugin count. Setting 6% clears the
warning with a small margin for plugin additions. The 11k tokens/session is
not a new cost — Claude Code was already allocating that budget and showing
truncated stubs. Raising the fraction shows complete descriptions for the same
approximate token spend.

**Expected outcome:** The truncation warning disappears. All 179 previously
dropped descriptions become visible. No change to skill invocation behavior —
only the listing display is affected.

**Post-trim revisit:** After the audit PR lands, the effective description
budget will be meaningfully smaller. At that point the fraction can be lowered
back toward 3-4% if desired, or left at 6% as comfortable headroom. Either
is fine — over-provisioning the listing budget has no runtime downside beyond
the token cost already being paid.

---

## Why This Happened

### Root cause: descriptions written as documentation, not selection metadata

The `description:` frontmatter field in SKILL.md serves exactly one purpose at
runtime: helping Claude Code decide which skill to invoke and whether to invoke
it at all. It is loaded during skill listing, not when the skill runs. The
skill body (everything below the frontmatter) is what gets loaded into context
on invocation.

The current descriptions were written to be informative and self-contained —
they explain the methodology, enumerate example trigger phrases, and summarize
the skill's algorithm. That is excellent documentation. It is not what the
listing-time field needs.

### Concentration: yellow-core is 61% of the problem

Across 37 SKILL.md files in this repo:

| Plugin | Skills | Total description chars | Avg per skill |
|---|---|---|---|
| yellow-core | 17 | 5,971 | 351 |
| yellow-ruvector | 3 | 564 | 188 |
| yellow-mempalace | 2 | 461 | 230 |
| yellow-ci | 2 | 397 | 198 |
| yellow-browser-test | 2 | 392 | 196 |
| yellow-council | 1 | 285 | 285 |
| remaining 10 plugins | 10 | ~1,736 | ~174 |

yellow-core's top three descriptions alone:
- `compound-lifecycle`: 692 chars
- `ideation`: 666 chars
- `optimize`: 619 chars

These are not outliers of a general problem — yellow-core's average of 351
chars/description is where the bloat lives. Most other plugins are already in
reasonable shape.

### What the description field is actually used for

At selection time, Claude Code uses the description to answer two questions:

1. **Capability match** — "can this skill do what I need?" (~20-40 chars of
   signal needed)
2. **Trigger match** — "does my current situation match when this skill
   applies?" (one strong "Use when..." clause is sufficient)

The current descriptions over-serve both needs. The verbose versions enumerate
5-6 synonymous trigger phrases when one semantic summary covers the same
territory. They also repeat content that lives in the skill body (methodology
names, algorithm details, scoring rubrics) — information that only matters
after the skill is invoked, not during selection.

---

## Why This Is Not a Consumer Problem Yet

Because descriptions are currently being truncated, marketplace consumers with
a large plugin install set may already be seeing degraded skill selection for
yellow-core skills. The description audit PR is not just housekeeping — it is
a quality improvement that benefits every user of the marketplace.

Uninstalling plugins is not a viable mitigation for this author: all 18
yellow-plugins must remain installed for testing and authoring. Raising the
budget fraction is a personal workaround; trimming descriptions is the
structurally correct fix.

---

## Key Decisions

### 1. Quality-driven audit, not a char cap

There is no hard character limit. The audit applies these signals as
inspection triggers, not pass/fail thresholds:

- **>200 chars:** inspect for redundancy
- **>300 chars:** high probability of cuttable content — read carefully
- **>400 chars:** almost certainly has documentation-style content that
  belongs in the body, not the description

These are audit prompts, consistent with the existing position on line count
guidelines ("120 = audit prompt; 200/300 = inspect for redundancy, not
split-trigger"). The same principle applies here: count triggers review, it
does not trigger cuts.

### 2. What to cut vs what to keep

**Cut these patterns:**

- Enumerated trigger phrase lists: `"Triggers on phrases like 'X', 'Y', 'Z',
  or any request for..."`
  — The model infers coverage from a well-written capability summary. Listing
  synonyms does not expand trigger coverage, it just costs chars.

- Body-content repetition: methodology names, algorithm steps, scoring rubric
  details.
  — These belong in the skill body. They add zero information at listing time.

- Capability listings: `"This skill helps with X, Y, Z, and any situation
  where..."`
  — One precise capability statement outperforms a list of three vague ones.

**Keep these patterns:**

- The differentiating clause: what makes this skill distinct from adjacent
  skills (e.g., `ideation` vs `brainstorming` — these must remain
  distinguishable in description alone).

- One strong "Use when..." trigger: the primary condition under which this
  skill is the right choice.

- Non-obvious applicability: if a skill applies to an edge case that a
  reasonable person would not guess from the skill name, that context belongs
  in the description.

- Specificity that prevents misfire: if a skill has a narrow scope that would
  otherwise cause over-invocation, the description should make that boundary
  clear.

### 3. The differentiating clause failure mode

The primary risk in description trimming is collapsing similar-sounding skills
into descriptions that cannot be distinguished at selection time. If `ideation`
and `brainstorming` both get trimmed to "explore solution space before
committing," Claude will pick arbitrarily between them.

The trim PR must verify for each skill: after trimming, can a reader (or the
model) still distinguish this skill from its closest neighbor? If not, the trim
went too far on the differentiating clause specifically.

### 4. No validator rule added

Description quality remains a review concern, not a CI concern.
`validate-agent-authoring.js` will not be modified. The trim PR is the fix.

---

## Open Questions

1. **Should the config change land as a committed project-level setting, or
   stay as a personal user-level override only?**
   Current recommendation: user-level only (`~/.claude/settings.json`), since
   consumers will have a different plugin install count and 6% would be
   over-provisioned for them. If the project gains a canonical `.claude/settings.json`
   for contributor onboarding, add it there too at that time.

2. **After the audit PR, can the budget fraction be lowered to 3%?**
   Depends on measured outcome. If the audit gets yellow-core's descriptions
   to an average of ~150 chars, total description budget drops from 9,806
   chars (~2,450 tokens) to roughly ~5,500 chars (~1,375 tokens). The full
   listing would then cost roughly 3-3.5% of context — so yes, 3-4% would
   then be comfortable. This is a "nice to have" optimization after the PR,
   not a goal of the PR itself.

3. **Third-party plugin descriptions (firecrawl, pr-review-toolkit, etc.) also
   contribute to the budget but cannot be edited in this repo.** The config
   fraction must stay high enough to accommodate those even after yellow-plugins
   descriptions are trimmed. This is another reason to not lower the fraction
   aggressively post-trim.

---

## Handoff to /workflows:plan

The trim PR is ready to be planned. Suggested phase breakdown for the planner:

**Phase 1 — Audit yellow-core (17 skills)**
Read each description. Apply quality criteria above. Rewrite descriptions that
have cuttable content. Verify each trimmed description can still be
distinguished from its nearest neighbor. Expect ~12-14 of the 17 to need
changes; 3-4 may already be acceptable density.

Priority order based on current char counts:
1. `compound-lifecycle` (692), `ideation` (666), `optimize` (619)
2. `debugging` (522), `session-history` (518)
3. `agent-native-audit` (379), `agent-native-architecture` (316)
4. Remaining 10 yellow-core skills (~150-285 chars each) — inspect, trim only
   if clearly redundant

**Phase 2 — Spot-check borderline plugins**
Read descriptions for: yellow-ruvector (3 skills, avg 188), yellow-mempalace
(2 skills, avg 230), yellow-council (1 skill, 285 chars).
These may need light trimming but are not the primary work.

**Phase 3 — Full pass on remaining 15 skills**
Quick read-through of the other 10 plugins' descriptions. Most are likely fine.
Trim only if a clear bloat pattern is visible. Time-box this phase.

**Success criteria for the PR:**
- `claude-doctor` shows no truncation warning at `skillListingBudgetFraction:
  0.06` (or lower)
- All skill descriptions retain their differentiating clause
- No skill that was previously selectable becomes unselectable after trim
  (cannot be verified mechanically — this is a judgment call in review)
- `pnpm validate:schemas` passes (description field format unchanged, just
  shorter content)
- Changeset committed for each plugin whose SKILL.md was modified

**Out of scope for this PR:**
- Validator rule for description length
- Uninstalling any plugins
- Changes to skill body content (only `description:` frontmatter field)
- Changes to non-yellow-plugins (firecrawl, pr-review-toolkit, etc.)
