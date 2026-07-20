---
title: 'Codex distribution pipeline: silent gaps until codex.enabled flips'
date: 2026-07-20
category: integration-issues
track: knowledge
problem: 'Codex generate/validate pipeline has silent CI gaps (manifest skills pointer, gated exposure lint) invisible until codex.enabled=true'
tags:
  - codex
  - openai-codex
  - plugin-manifest
  - skills
  - exposure-lint
  - ci-gap
  - golden-fixture
  - hooks
  - content-leak
components:
  - scripts/lib/generate/emit-codex.js
  - scripts/validate-codex.js
  - scripts/generate-manifests.js
  - plugins/yellow-core/tests/plan-commands.bats
  - tests/integration/generate-manifests-codex.test.ts
  - schemas/catalog-plugin.schema.json
  - plugins/yellow-core/skills/agent-native-audit/SKILL.md
---

# Codex distribution pipeline: silent gaps until codex.enabled flips

## Context

While expanding plan shell 03 (yellow-core — the first plugin in this repo
to ever set `targets.codex.enabled: true`) via `/workflows:expand-shell`, a
repo-research pattern survey of `scripts/lib/generate/emit-codex.js` and
`scripts/validate-codex.js` turned up several load-bearing asymmetries in
how the Codex distribution pipeline generates and lints skill files —
asymmetries that produce **zero CI signal today** only because every one
of the 17 `catalog/plugins/*.json` entries still has
`targets.codex.enabled: false`. All findings below were verified directly
against source at HEAD (not taken on a session summary's word alone).

## Guidance

### 1. `componentPaths.skills` manifest-pointer asymmetry

`buildCodexPluginManifest()` (`emit-codex.js:83-109`) only writes the
generated `.codex-plugin/plugin.json`'s `"skills"` field when **both**
`codex.componentPaths.skills` is explicitly set in the catalog source
**and** `codex.skillAllowlist` is non-empty:

```js
const skillsPath = codex.componentPaths && codex.componentPaths.skills;
const hasAllowlistedSkills = Array.isArray(codex.skillAllowlist) && codex.skillAllowlist.length > 0;
if (skillsPath && hasAllowlistedSkills) {
  manifest.skills = skillsPath;
}
```

But `buildCodexSkillTree()` (`emit-codex.js:189`) — the function that
*actually writes skill files to disk* — defaults the same field instead of
requiring it:

```js
const skillsPath = (codex && codex.componentPaths && codex.componentPaths.skills) || './codex/skills';
```

`scripts/validate-codex.js`'s exposure-lint file collector
(`collectCodexExposedFiles`) independently defaults `componentPaths.skills`
the same way `buildCodexSkillTree` does.

**Net effect:** a catalog author who sets `codex.enabled: true` and
populates `skillAllowlist`, but forgets to also set
`componentPaths.skills`, gets real skill files generated on disk at
`plugins/<name>/codex/skills/` — and those files pass exposure-lint — but
the manifest's `"skills"` pointer is never written at all. Every automated
gate passes (`pnpm generate:manifests`, `pnpm validate:codex`, schema
validation); the gap is invisible until a real Codex CLI install has
nothing telling it where to find the skills.

The code already has an explicit R-review comment (lines 94-99) guarding
the *opposite* asymmetry (a `componentPaths.skills` value with an
empty/missing `skillAllowlist` would point Codex at a directory
`buildCodexSkillTree` never writes) — but nothing symmetrically guards
this direction.

**Action:** always set `targets.codex.componentPaths.skills` explicitly in
`catalog/plugins/<name>.json` any time `skillAllowlist` is non-empty. Don't
rely on the default lining up between the manifest builder and the
skill-tree builder — it currently doesn't.

### 2. Sidecar-file hard rejection (fails loud, not silent)

`buildCodexSkillTree()` (`scripts/lib/generate/emit-codex.js`) rejects
**any** skill directory containing files other than `SKILL.md` — a
`references/` subdirectory, a `schema.yaml`, anything. The generator aborts
for that skill with an explicit error:

```
plugins/<name>/skills/<skillName>: has sidecar file(s) not yet supported
for Codex (<list>) — only SKILL.md is copied
```

This is a real, permanent constraint (not a bug to route around): a
Codex-targeted skill must be fully self-contained in one file. It also
rules out extracting shared bash logic into a sourceable helper file
inside a skill directory as a de-duplication strategy for anything meant
to ship to Codex.

### 3. `codex.enabled`-gated exposure lint

`runExposureLint()` in `validate-codex.js` (line 441) — which includes a
registry-gated slash-command check (`SLASH_COMMAND_PATTERN` matched
against `buildCommandNameRegistry()`, the real set of registered Claude
Code command names across the whole repo) — skips a plugin **entirely**
unless it's Codex-enabled:

```js
for (const name of pluginOrder) {
  const source = sources[name];
  if (!isCodexEnabled(source)) {
    continue;
  }
  // ... exposure-lint checks only run past this point
}
```

The file's own header comment concedes the consequence: "no plugin sets
`codex.enabled: true` yet ... so there is no real Codex-exposed artifact to
validate the check's shape against."

**Practical effect:** copying prose from an existing Claude command (which
may casually reference a sibling command, e.g. "/plan:complete") verbatim
into a new Codex-distributed skill body passes CI silently today, and will
start failing the moment `codex.enabled` flips to `true` for that plugin —
a "no gate catches this until the feature flag flips" latent-bug shape.

**Action:** when authoring or porting content into a Codex-exposed skill,
manually scan for embedded `/command-name` references before flipping
`codex.enabled`, and re-run `pnpm validate:codex` immediately after the
*first* time any plugin's `codex.enabled` flips to `true` — that's the
moment this whole class of check starts exercising for real.

### 4. Golden-fixture parity gate over hand-copied mirrors

Finding 2 (sidecar rejection) is *why* shared bash logic can't be pulled
into a sourceable helper for Codex-targeted skills — which is why this
repo already falls back to hand-copied, independently-maintained
reimplementations elsewhere. `plugins/yellow-core/tests/plan-commands.bats`
re-implements a command's inline bash/grep logic as bats functions
annotated with comments like:

```
# Gate A grep (mirrors complete.md Phase 3). ...
# Checked-box count (mirrors status.md, case-insensitive for GFM [X]).
```

(confirmed via `grep -n "mirrors" plugins/yellow-core/tests/plan-commands.bats`
— 7 call sites). A third, separately-maintained reimplementation like this
can silently drift from the command it mirrors, with nothing catching the
divergence.

**Stronger alternative when a task calls for "prove identical behavior
before/after a refactor"** in this sidecar-constrained environment: capture
the *original* command's actual stdout against fixed fixture scenarios as
golden files **before** the change, then assert the new location's logic
reproduces them byte-for-byte **after** — a real captured-baseline diff,
not a fourth hand-authored mirror that could itself drift from the
original.

### 5. Hook carryover is unconditional — no per-plugin opt-out existed until R22 needed one

`buildCodexHookConfig()` (`emit-codex.js`, R20) translates `source.hooks` —
a plugin's inline Claude hook config — into `hooks/codex-hooks.json`
whenever it's non-empty, with no catalog-level way to exclude it. This is
intended behavior for R20 in general (a plugin that wants Codex hook
support should get it), but it collides with R22's requirement that
yellow-core's Codex exposure be **exactly three skills, hooks excluded** —
yellow-core still needs its Stop/SessionStart hooks on the Claude side
(background compounding), so the fix can't be "remove the hooks."

Neither the schema nor the generator had a way to say "enable Codex for
this plugin, but not its hooks" before this PR. Since Shell 02 (PR2) never
exercised a real codex-enabled + hooks-bearing plugin, this asymmetry
produced zero CI signal — same shape as findings 1-3 above.

**Fix landed in this PR:** a new optional `targets.codex.includeHooks`
boolean (default unset/`true` — preserves R20's existing unconditional
carryover for every plugin that doesn't set it). `buildCodexHookConfig()`
returns `null` immediately when `includeHooks === false`, before it even
reads `source.hooks`. yellow-core's catalog source sets
`"includeHooks": false`. Regression coverage:
`tests/integration/generate-manifests-codex.test.ts` "targets.codex.includeHooks
opt-out (R22)".

**Action:** any future plugin that needs Codex enablement while keeping
Claude-only hooks out of its Codex exposure should set
`targets.codex.includeHooks: false` in its catalog source — don't assume
enabling Codex is hooks-neutral.

### 6. Content-leak class: the exposure lint and the emit pipeline both have blind spots for cross-references, found on the pilot's first real content pass

Reviewing yellow-core's first live Codex allowlist (`agent-native-architecture`,
`agent-native-audit`, `plan-status`) against real, pre-existing skill prose
(not synthetic fixtures) surfaced two related-but-distinct gaps that a
schema/fixture-only test suite can't catch, because both require real
content to trigger:

- **Registry-gated slash-command check misses plugin-qualified references.**
  `scripts/validate-codex.js`'s `SLASH_COMMAND_PATTERN` greedily captures an
  entire colon-chain after a leading `/` (e.g. `/yellow-debt:debt:audit`
  captures `yellow-debt:debt:audit` as one string), but
  `buildCommandNameRegistry()` only ever registers the bare, unprefixed
  `name:` frontmatter value (`debt:audit`). The registry lookup can never
  match a plugin-qualified reference, so this class of reference — the
  dominant convention this repo actually uses for cross-plugin mentions —
  passes the exposure lint silently. `agent-native-audit/SKILL.md` shipped
  exactly this pattern in this same PR before being caught by review and
  reworded to prose; the underlying registry gap itself was **deferred, not
  fixed**, since a proper fix means threading `pluginName` through the
  registry builder, confirming no other consumer of `commandNames` breaks,
  and adding a regression test — a focused validator PR, not a pilot
  bolt-on.
- **Codex-side skill copies inherit Claude-oriented cross-references
  verbatim.** Both `agent-native-architecture` and `agent-native-audit`
  have "What This Skill Doesn't Cover" sections pointing at other
  Claude-only skills/agents (`yellow-core:create-agent-skills`,
  `yellow-review:review:agent-native-reviewer`, etc.) that are correct and
  useful on the Claude side but don't exist in a Codex installation. These
  are not slash-command syntax (so the lint above is silent by design, not
  by bug) and not functionally broken — just dead pointers for a Codex
  reader. Fixing this by editing the canonical source would degrade the
  Claude-side skill to satisfy the Codex copy; the real fix is
  generator-level (transform or strip cross-references at Codex-emit time,
  in `buildCodexSkillTree()`), which belongs in the same follow-up as the
  registry gap above, not as a one-off content edit.

**Action:** before allowlisting a *pre-existing* skill for Codex for the
first time (as opposed to authoring new Codex-aware content), grep it for
slash-command syntax **and** plugin/skill/agent cross-references, the same
way this PR's Pattern Survey scrubbed `plan-status` — don't assume a skill
that's been fine on the Claude side for years is Codex-safe by default.
Treat `pnpm validate:codex` passing as necessary, not sufficient, until the
registry gap above is fixed.

## Why This Matters

yellow-core (plan shell 03) is the first plugin in this repo that will ever
set `codex.enabled: true` — every prior "Codex-enabled" state in this repo
has been synthetic/untested. All code-level gaps above (1-3, the
hooks-carryover asymmetry in 5, and the content-leak class in 6) were
invisible to `pnpm validate:schemas`, `pnpm test:unit`, `pnpm lint`, `pnpm
typecheck`, and even `pnpm validate:codex` as previously exercised, because
the CI baseline had never run against a real Codex-enabled plugin with real
skill content. The first PR that flips `codex.enabled: true` for any plugin
— and, separately, the first PR that allowlists a *pre-existing* skill
rather than newly-authored content — is exactly where these land; expect
friction there, not before.

## When to Apply

Any time a plugin author or reviewer:

- Enables Codex distribution for a plugin (`targets.codex.enabled: true` in
  `catalog/plugins/<name>.json`)
- Allowlists a skill for Codex (`skillAllowlist`), especially a
  *pre-existing* skill never written with Codex distribution in mind
- Authors or ports content into a Codex-exposed skill body
- Designs a before/after behavior-parity gate for logic that can't be
  shared via a sourceable file inside a Codex-targeted skill directory
- Enables Codex for a plugin that also declares inline Claude `hooks` and
  needs to keep them out of its Codex exposure (`includeHooks: false`)
- Extends `catalog/plugins/<name>.json`'s `targets.codex` block with a new
  field — add both a manual `typeof` check in
  `generate-manifests.js`'s `validateCodexTarget()` (matching the existing
  per-field checks) and a mutate-then-apply regression test, not just a
  schema `type` constraint (the schema's AJV gate runs in a separate CI
  matrix leg, not in `pnpm validate:schemas`/`validate:generated`)

## Examples

- `scripts/lib/generate/emit-codex.js` — `buildCodexPluginManifest`
  (manifest `"skills"` field, non-defaulted)
- `scripts/lib/generate/emit-codex.js` — `buildCodexSkillTree`
  (defaults `componentPaths.skills`; hard-rejects sidecar files)
- `scripts/validate-codex.js` — `runExposureLint` (gated on
  `codex.enabled`)
- `plugins/yellow-core/tests/plan-commands.bats` — hand-copied mirror
  pattern (7 call sites, per the `grep -n "mirrors"` count above)
- `scripts/lib/generate/emit-codex.js` — `buildCodexHookConfig`'s
  `includeHooks === false` opt-out guard
- `tests/integration/generate-manifests-codex.test.ts` — "targets.codex.includeHooks
  opt-out (R22)"; "rejects a non-boolean includeHooks..."
- `scripts/generate-manifests.js` — `validateCodexTarget()`'s per-field
  manual type checks (the pattern the `includeHooks` fix now matches)
- `scripts/validate-codex.js` — `SLASH_COMMAND_PATTERN` /
  `buildCommandNameRegistry` (deferred: plugin-qualified reference blind
  spot, finding 6)
- `plugins/yellow-core/skills/agent-native-audit/SKILL.md` — the
  `/yellow-debt:debt:audit` reference reworded to prose (fixed, finding 6)
- `plugins/yellow-core/codex/skills/agent-native-architecture/SKILL.md`,
  `plugins/yellow-core/codex/skills/agent-native-audit/SKILL.md` — dead
  cross-references to non-Codex-enabled skills/agents (deferred, finding 6)

## Related Docs

- [OpenAI Codex plugin manifest, marketplace, and hook contract](codex-plugin-manifest-and-hook-contract.md)
  — Codex's own *external* plugin contract (verified against OpenAI's
  docs); this doc instead covers gaps in *this repo's own* generator and
  validator code that implements that contract.
