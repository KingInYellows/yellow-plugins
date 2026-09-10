---
title: "Cross-Plugin Frontmatter Sweeps and Canonical Skill Copy Drift"
date: 2026-04-28
category: code-quality
track: knowledge
problem: 'Cross-Plugin Frontmatter Sweeps and Canonical Skill Copy Drift'
tags: [frontmatter, skill, canonical, cross-plugin, sweep, documentation-rot]
components: [plugins/yellow-debt, plugins/yellow-ci, plugins/yellow-review, plugins/yellow-core]
---

## Problem

Four distinct but related patterns surfaced in a single PR:

1. **Frontmatter sweep misses structurally-equivalent agents in other plugins.**
   Adding `background: true` + `memory: project` to "all review agents" applied
   to one plugin's `agents/` directory and silently skipped 10 functionally
   equivalent scanner and CI agents across two other plugins.

2. **Paraphrased canonical skill blocks re-introduce drift immediately.**
   A security-fencing block was copied into a new CI agent with one sentence
   dropped and one qualifier removed. The other three CI agents added in the same
   PR carried the full block verbatim.

3. **Wait-gate prose duplicates an existing step lead.**
   Adding a wait-gate paragraph to an orchestration command re-stated "After all
   scanner tasks complete" — a clause already present as the step's lead sentence.

4. **Inconsistent terminology inside a canonical SKILL.md.**
   Prose referred to "artifact-typed delimiters" but the example showed a
   content-fencing delimiter (`--- code begin ---`). The CI-artifact section
   correctly defines artifact-typed as `--- begin ci-log: <name> ---`. Overloading
   the same term for two distinct forms makes the skill self-contradicting.

## Root Cause

- **Mental-model mismatch in sweeps:** The author's concept of "review agents"
  mapped to one plugin's directory. Without an explicit roster (a grep pattern or
  a list of affected paths), the sweep boundary is whatever the author imagines,
  not what the codebase contains.

- **Paraphrase instead of verbatim copy:** When a SKILL.md is designated as
  canonical source-of-truth, any re-authoring — even dropping a closing sentence —
  forks the content. The only safe backfill method is copy-paste of the exact
  block.

- **Additive editing without reading surrounding context:** Wait-gate content was
  inserted without checking whether the step lead already encoded the same
  condition. A pre-write read of the target step would have caught it.

- **Terminology reuse across distinct variants:** Using the same label
  ("artifact-typed") for both the flat content-fencing form and the structured
  CI-artifact form makes every reader guess which one is meant.

## Fix

**Frontmatter sweeps:** derive the file list from a grep, not from memory.

```bash
rg --files-with-matches 'subagent_type.*review\|category.*review' plugins/*/agents/**/*.md
```

Run before the sweep; confirm count matches expectation; apply to every match.

**Canonical skill blocks:** copy verbatim. If the block needs a minor
contextual tweak (e.g., different delimiter name), make the tweak visible as a
comment, not a silent paraphrase.

**Wait-gate prose:** before adding a "wait for X" sentence, read the full
target step. If an "after X completes" clause already exists, add any new detail
as a parenthetical inline — not a second paragraph.

**SKILL.md terminology:** use distinct labels for distinct variants throughout.
If the skill defines `content-fencing` and `artifact-typed` as two forms, those
exact terms must appear consistently in all prose, headings, and examples.

## Prevention

- **Cross-plugin sweep checklist:** for any PR that touches frontmatter across
  plugins, require a grep-derived file list as a PR description attachment. If the
  list changes during review, re-run and re-attach.
- **Canonical block integrity check:** after copying a skill block, diff it
  against the SKILL.md source. Zero diff is the only acceptable result (excluding
  intentional documented adaptations).
- **On-touch SKILL.md terminology audit:** whenever a canonical skill is edited,
  grep for all variant names to confirm they are used consistently. Pattern:
  `rg 'artifact-typed\|content-fencing\|artifact.typed' plugins/yellow-core/skills/`.
- **Duplicate prose detection:** before adding wait-gate or "after X" language,
  `rg 'after all.*complete\|wait.*complete' <target-file>` — if a match exists,
  inline instead of appending.

## Related Documentation

- `docs/solutions/code-quality/stale-env-var-docs-and-prose-count-drift.md`
- `docs/solutions/code-quality/cross-plugin-documentation-correctness.md`
- `docs/solutions/code-quality/skill-frontmatter-attribute-and-format-requirements.md`

## Update — 2026-09-09: fifth instance — canonical skill lists no carrier roster (PR #781)

A concrete case of Root Cause #1 (mental-model mismatch in sweeps) turned
up in the security-sensitive PEM/credential-redaction awk lineage:
`plugins/yellow-council/skills/council-patterns/SKILL.md` is the canonical
source for a redaction program copied into two internal `council.md`
sites and two CLI reviewer agent files, but the canonical file's own prose
never lists where its copies live. A prior hardening pass fixed every copy
its test extractor could find and silently missed council.md, because
neither the extractor nor the canonical skill doc named it as a carrier —
only an external JSON roster (`scripts/council-roster.json`) tracked the
gap, and only because someone had thought to add an explicit entry for it.

**Prevention addition:** when a file is designated canonical
source-of-truth for a block that gets copied elsewhere — not just
frontmatter, as in the original four patterns above, but any
verbatim-copied code block — require the canonical file itself to
enumerate its known copy sites in adjacent prose, not only in an external
roster or extractor list. A roster file can itself drift or have blind
spots, as it did here; a carrier list next to the source is one read away
from the code someone is actually editing.

Full incident: `docs/solutions/security-issues/awk-pem-state-machine-variable-mutation.md`'s 2026-09-09 Update.

## Update — 2026-09-09 (PR #782): canonical-copy-roster prevention item enacted

PR #782, stacking directly on #781, closes the prevention gap the prior
Update flagged: AGENTS.md's validation matrix now routes any edit to a
redaction-awk carrier file to `bats plugins/yellow-council/tests/`, and the
two reviewer-agent carriers that lacked a provenance comment above their
copy of the program now carry one, matching the sites that already did.
Landing in a follow-up PR rather than the PR that found the gap is fine —
the point of flagging it was making sure it didn't get lost.

Full incident continuation:
`docs/solutions/security-issues/awk-pem-state-machine-variable-mutation.md`'s
2026-09-09 (PR #782) Update.

**Components (this Update):** `AGENTS.md`,
`plugins/yellow-council/agents/review/gemini-reviewer.md`,
`plugins/yellow-council/agents/review/opencode-reviewer.md`.
