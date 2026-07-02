# Plugin Scope/Mode Interface Protocol

The scope and mode conventions that yellow-plugins command surfaces
currently share. This document records CURRENT behavior — it is
descriptive, not aspirational; every contract below is quoted from a
shipped surface. Sibling of `docs/plugin-credential-status-protocol.md`
(same structure: contract → adopters → non-adopters).

**Non-goal (explicit):** unifying the divergent semantics documented
below is future work, not part of the PR that introduced this document.
Where two surfaces disagree, this document records the disagreement; it
does not resolve it.

## Interface 1: `--non-interactive` flag

Suppresses human gates for unattended invocation. Callers that pass the
flag accept responsibility for pushes and skipped confirmation prompts.

### Contract

| Property | Value |
|----------|-------|
| Token | exactly `--non-interactive`, whitespace-separated in `$ARGUMENTS` |
| Parsing | split on whitespace; remove the flag token; any OTHER `--`-prefixed token is a hard error (`unknown flag`) |
| Default | OFF |
| Effect (`/review:pr`) | suppresses the Step 9 push-confirmation prompt and the Step 9b "save learnings" prompt (P2 memory writes are skipped, not prompted) |
| Effect (`/review:resolve`) | suppresses the spawn-cap, CONFLICT, and push-confirmation gates |

Defined identically in
`plugins/yellow-review/commands/review/review-pr.md` Step 1 and
`plugins/yellow-review/commands/review/resolve-pr.md` Step 1.

### Adopters

| Surface | Role |
|---------|------|
| `/review:pr` | accepts the flag (definition site) |
| `/review:resolve` | accepts the flag (definition site) |
| `/review:sweep` | forwards the flag to both commands above |
| `/review:sweep-all` | forwards via `/review:sweep` per PR |
| `/review:resolve-stack` | forwards to `/review:resolve` per PR in the stack |

### Non-adopters (interactive-only surfaces)

`/workflows:work`, `/workflows:review`, `/workflows:compound`,
`/debt:audit`, and all setup commands have no `--non-interactive` mode
today. Their gates (AskUserQuestion checkpoints, push confirmations) are
always live.

## Interface 2: `--in-pr` flag

Switches `/workflows:compound` from live-conversation sourcing to
PR-context sourcing (PR body + commit subjects) so a solution doc can
co-ship with the code change.

### Contract

| Property | Value |
|----------|-------|
| Token | literal `--in-pr` anywhere in whitespace-separated `$ARGUMENTS` |
| Parsing | detect, then STRIP from the user hint before forwarding the remainder (`--in-pr extra context` forwards `extra context`) |
| Default | OFF (standard mode: live conversation is the source) |
| Precondition | on a feature branch with an open PR |

Defined in `plugins/yellow-core/commands/workflows/compound.md` Step 2.

### Adopters

`/workflows:compound` only. No other surface accepts `--in-pr`.

## Interface 3: Debt scanner JSON-file interface

Scope/mode for `/debt:audit` scanners is passed via a JSON file contract
rather than flags: the orchestrator writes a scan-scope config, each
scanner agent writes findings JSON conforming to the Scanner Output
Schema v2.0, and the synthesizer merges the files.

### Contract

Canonical definition:
`plugins/yellow-debt/skills/debt-conventions/SKILL.md` § "Scanner Output
Schema (v2.0)". This protocol doc does not duplicate the schema — the
skill is the single source; consult it for field-level detail
(`staleness_score`, `severity`, `files_skipped_malformed`, etc.).

### Adopters

The five yellow-debt scanner agents plus `audit-synthesizer`. This is a
file-based interface, deliberately different from Interfaces 1–2: scanner
output is machine-merged, so a structured file beats flag plumbing.

## Interface 4: Positional-type detection (`/workflows:review`)

`/workflows:review` dispatches on the TYPE of its positional argument
instead of a mode flag.

### Contract

| Argument shape | Route |
|----------------|-------|
| existing file path | session-level review mode |
| path-like but missing (ends `.md`, starts `./`/`../`/`plans/`) | error + list recent plans, stop |
| PR number / URL / branch name | redirect to `/review:pr` (yellow-review), with install notice fallback |

Defined in `plugins/yellow-core/commands/workflows/review.md` Step 1
("Argument Disambiguation").

### Adopters

`/workflows:review` only. Other commands that accept a positional target
(`/review:pr` PR-number-or-blank, `/workflows:work` plan path) validate a
single expected type rather than dispatching across types.

## RECOMMENDED (not yet uniform): diff-scope vs file-scope

turbo's skill conventions define a scope interface worth adopting for
FUTURE surfaces that operate on "the current change": resolve scope in
three branches — explicit path argument → that file; dirty working tree →
the diff; clean tree → the branch diff against trunk (see turbo
`claude/skills/simplify-code/SKILL.md` for the concrete 3-branch shape).

No yellow-plugins surface implements this today — `/review:pr` always
diffs a PR, `/workflows:review` takes a plan file, `/debt:audit` scans a
tree. This section is a recommendation for new surfaces, explicitly
marked not-yet-uniform; adopting it on existing surfaces is out of scope
(see the non-goal at the top).

## Adding a new scope/mode surface

1. Prefer one of the four interfaces above over inventing a new flag
   grammar; `--non-interactive` parsing (Interface 1) is the template for
   any new boolean mode flag (exact token, whitespace split, unknown-flag
   hard error, OFF default).
2. Add a one-line "conforms to / diverges from" cross-reference in the
   new command file pointing at this document.
3. Record any deliberate divergence here in the same PR.
