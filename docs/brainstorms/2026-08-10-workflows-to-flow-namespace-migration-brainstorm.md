# Migrate the `workflows:` command namespace to `flow:`

## What We're Building

Rename the 10 commands currently under the `workflows:` namespace to a new
`flow:` namespace, because native Claude Code's built-in `/workflows` shadows
the `workflows:` prefix in autocomplete — the 10 commands still resolve when
typed in full, but the prefix no longer narrows the command list, forcing the
full command name to be typed every time instead of a short unambiguous
prefix. The fix is scoped as a functional rename (no user-facing deprecation
machinery) plus a machine-checked, incrementally-shrinking sweep of the prose
references to the old name across the repo.

Affected commands (10 total, 2 plugins):

- `plugins/yellow-core/commands/workflows/{brainstorm,compound,decompose,expand-shell,pick-next-shell,plan,review,spec,work}.md`
  → `plugins/yellow-core/commands/flow/{...}.md` (9 files)
- `plugins/yellow-research/commands/workflows/deepen-plan.md`
  → `plugins/yellow-research/commands/flow/deepen-plan.md` (1 file)

Resulting names: `/flow:plan`, `/flow:work`, `/flow:spec`, `/flow:brainstorm`,
`/flow:compound`, `/flow:review`, `/flow:decompose`, `/flow:expand-shell`,
`/flow:pick-next-shell`, `/flow:deepen-plan`.

## Why This Approach

**Recommended: rename now, no forwarders, land a machine-checked CI gate in
the same PR as the rename, then sweep prose incrementally against a shrinking
allowlist.**

Two facts settled during this dialogue changed the shape of the problem from
how it was originally scoped:

1. **Usage is author-only** — there is no external install base for this
   marketplace today. A deprecation window with dual-registered forwarder
   commands exists to convert a hard break into a soft one for users who
   aren't the person making the change. With no such users, that machinery
   has no one to protect and is unearned complexity (this repo's own
   precedent: `docs/solutions/code-quality/dual-read-migration-window-gitignored-artifacts.md`
   flags exactly this shape of dead-on-arrival transition code).
2. **The collision is ergonomic, not functional** — all 10 commands still
   resolve today; the defect is that `/workflows` no longer narrows to just
   them in autocomplete. There is no urgency forcing a rushed, unreviewable
   sweep. That removes the only argument for keeping the diff small via
   forwarders, and instead argues for using the available time to make the
   sweep *provably* complete rather than *asserted* complete.

That second point is the load-bearing one. This repo has two documented,
repeated failure patterns of exactly this shape:
`docs/solutions/code-quality/sweep-incomplete-application-orphaned-jargon.md`-style
"sweep misses N+1" (recurred across #664/#666), and
`docs/solutions/code-quality/doc-fix-mechanical-verification-gap.md`
("assertion is not a check", 8 occurrences, #677). This brainstorm
reproduced that exact failure live: the original scope count of ~485
references (measured against `plugins/`, `docs/`, and root `*.md`) missed
two more sites entirely outside those globs —
`.github/pull_request_template.md:23` and
`.github/workflows/validate-schemas.yml:1191`, both hardcoding
`/workflows:compound --in-pr`. The true count is closer to 487, and the
fact that a second miss surfaced on the very next look is itself the
strongest argument in this brainstorm for gating sweep completeness by CI,
not by manual review.

### Alternatives considered

**B — Keep the original dual-publish/forwarder plan** (rename to `flow:`,
keep `workflows:*` as thin forwarders emitting a deprecation line, drop them
in a later minor). This was the approach initially selected during ideation,
before the author-only fact was established. Rejected: it optimizes for
protecting external muscle memory that, per the confirmed answer, doesn't
exist. It would also be new pattern-setting for this repo — there is no
existing standalone forwarder-command precedent to build from (the closest
analog, the "shell-03" thin-wrapper `Skill`-invocation idiom enforced by
`validate-agent-authoring.js` RULE 17, only forwards within the same plugin,
not across a namespace/plugin boundary). `plugins/gt-workflow/CLAUDE.md:41`
does document a dual-publish pattern designed for this exact scenario
(ship old + new for one minor, drop old next major) — it's a reasonable
mechanism in the abstract, just not justified here.

**C — Fully atomic single-PR migration** (rename + entire ~487-site sweep +
CI gate, all in one PR). Rejected: a ~487-site diff in one PR is exactly the
shape where prefix-substring corruption hides undetected (see
`docs/solutions/code-quality/mcp-tool-rename-prefix-collision.md` — `\b`
alone doesn't stop substring corruption) and where a large mechanical diff
gets rubber-stamped rather than genuinely reviewed. Splitting the sweep
across PR2-4 while keeping the CI gate green throughout via a shrinking
allowlist gets the small-diff reviewability benefit without needing
forwarders to justify the multi-PR window.

## Key Decisions

- **Namespace word: `flow:`.** Checked for autocomplete-uniqueness (first
  2 characters) against every currently-occupied command namespace in this
  repo: `browser-test, ci, codex, composio, compound, council, debt, devin,
  docs, linear, mempalace, morph, plan, research, review, ruvector, semgrep,
  setup, statusline, workflows, worktree`, plus the bare gt-workflow
  top-level commands (`gt-amend, gt-sync, gt-nav, gt-setup, gt-cleanup,
  gt-stack-plan, smart-submit`) and the incidentally-known native commands
  `/plugin`, `/usage`. `fl` is unique against all of these. At 4 characters
  it is also the shortest of the candidates considered (`pipeline:`,
  `chain:`, `cascade:` were the other three evaluated), which matters
  because the actual success criterion here is typing/autocomplete
  ergonomics, not naming taste.

- **`flow` is a substring of `workflow` — anchor every sweep/gate regex.**
  Per `docs/solutions/code-quality/mcp-tool-rename-prefix-collision.md`,
  unanchored find/replace on a rename target that shares a substring with
  something that must NOT change is a proven corruption vector in this repo.
  Patterns used by both the sweep and the CI gate must not (a) match inside
  the SINGULAR `yellow-core:workflow:*` agent-namespace `subagent_type`
  references (22 of them — these are agents, not commands, and are never
  renamed), and must not (b) partially rewrite `workflow` → `floww`-style
  corruption in either direction of the rename.

- **Four *permanent* decoy exclusions** — these are excluded from the CI
  gate forever, not swept, because they are historical record or a
  different (singular) namespace entirely:
  1. The singular `yellow-core:workflow:*` agent `subagent_type` references
     (22 refs).
  2. Every `plugins/*/CHANGELOG.md`.
  3. Everything under `plans/complete/**`.
  4. (See below — `references/workflows-work/` is explicitly NOT in this
     permanent group.)

- **One *temporary* allowlist entry, not a permanent decoy:**
  `plugins/yellow-core/references/workflows-work/` documents the
  `workflows:work` command being renamed, so unlike the three items above it
  must eventually be swept and renamed to match — it starts in the CI gate's
  allowlist (so PR1 doesn't fail on it) and gets removed once handled in a
  later PR, same as any other prose site.

- **The CI gate's file walk must include `.github/`.** The two misses found
  during this brainstorm (`pull_request_template.md:23`,
  `validate-schemas.yml:1191`) both live there, and both fell outside every
  glob the original ~485 count was measured against
  (`plugins/`, `docs/`, root `*.md`). This is direct evidence the gate needs
  broader coverage than the original scope assumed.

- **Terminal/pass condition for the gate is explicit and shrinking, not
  binary.** The gate is seeded in PR1 with an allowlist covering all ~487
  currently-known unswept sites plus the four permanent decoys. It passes
  (allows the bare `/workflows:` pattern) only for paths still on the
  allowlist. PR2-4 remove entries from the allowlist as they sweep prose.
  The gate is "done" — i.e., the migration is provably complete — only when
  the allowlist contains exactly the four permanent decoys and nothing else.
  This explicit terminal condition is what makes the sweep machine-checked
  rather than decorative; losing it would silently regress this plan back
  to the assertion-based sweep pattern this repo has repeatedly gotten
  wrong.

- **PR1 functional scope:** directory moves
  (`plugins/yellow-core/commands/workflows/` → `commands/flow/`, 9 files;
  `plugins/yellow-research/commands/workflows/` → `commands/flow/`, 1 file)
  + `name:` frontmatter updates on all 10 files + the new CI gate script,
  seeded allowlist, and its wiring into `validate:schemas`. No forwarder
  files, no deprecation-line commands.

- **Two changesets required in PR1** — one for `yellow-core`, one for
  `yellow-research` — since both plugins own renamed commands.
  `validate:setup-all` (dashboard ↔ delegated command coverage) and
  `validate:versions` (three-way version sync) are both in play and must
  pass against the renamed command names.

- **New validator script needs an `ERROR-*` code.** Whatever script
  implements the bare-`/workflows:` gate must register a code in
  `errorCatalog.ts`, or `pnpm validate:error-codes` fails CI.

- **LF line endings.** Any new script file must be normalized
  (`sed -i 's/\r$//'`) before commit — this repo is regularly edited from
  WSL2, which produces CRLF by default, and CRLF blocks merges here.

- **Provenance note for the plan phase:** the approach selection (A), the
  namespace word (`flow:`), and this document's save path were each answered
  directly by the user in a visible `AskUserQuestion` exchange in the parent
  session, then relayed to the drafting agent. The drafting agent could not
  observe those exchanges and so flagged them as unverified; that caveat is
  resolved — they are genuine user decisions, not relay artifacts. For the
  record, the user was shown and declined approaches B (forwarders), C (fully
  atomic single PR), and an A-variant with short-lived forwarders, and chose
  `flow:` over `pipeline:`, `chain:`, and `cascade:` on typing-ergonomics
  grounds. The relayed factual claims (the two `.github/` sites, the
  `gt-workflow/CLAUDE.md:41` citation, the solution-doc citation) were
  independently verified against the actual files and all checked out.

## Open Questions

- **Live `/flow` collision check against native Claude Code commands.** No
  file in this repo enumerates the full native slash-command set, so the
  `fl`-prefix-uniqueness check above only covers this repo's own namespaces
  plus the two natives (`/plugin`, `/usage`) that came up incidentally. This
  needs a live check (e.g. typing `/flow` in Claude Code and confirming
  nothing native narrows under it) before implementation starts.
- Exact batching of PR2-4 (how the ~487 prose sites split across follow-up
  PRs) is left to the plan phase rather than decided here.
- Whether the CI gate is a new standalone script under `scripts/` or an
  extension of `validate-agent-authoring.js` is an implementation choice,
  not decided here — either needs the `ERROR-*` code registration either way.
