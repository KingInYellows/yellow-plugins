# yellow-council

On-demand cross-lineage code review for Claude Code. Fans out to three external
LLM CLIs (Codex, Gemini, OpenCode) in parallel and synthesizes their verdicts
inline.

## Install

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-council@yellow-plugins
```

### Required external CLIs

- **Gemini CLI** — `npm install -g @google/gemini-cli` (v0.40+)
- **OpenCode CLI** — `curl -fsSL https://opencode.ai/install | bash` (v1.14+)
- **Codex CLI (optional)** — install `yellow-codex` plugin for Codex coverage.
  Without it, the council runs with 2 of 3 reviewers.

## Usage

The `/council` command takes a mode and arguments:

### `plan` — review a planning doc or design proposal

```text
/council plan docs/brainstorms/2026-05-04-my-feature-brainstorm.md
/council plan "Should we replace the auth middleware with a service-layer guard?"
```

### `review` — council the current diff

```text
/council review
/council review --base origin/develop
```

Defaults to the upstream-tracking branch's merge-base when `--base` is omitted
(matches yellow-codex's review default).

### `debug` — investigate a symptom

```text
/council debug "TypeError: cannot read property 'x' of undefined" --paths src/foo.ts,src/bar.ts
```

### `question` — open-ended consultation

```text
/council question "What's the right pattern for retrying idempotent HTTP requests in Go?"
/council question "Is this approach overkill?" --paths plans/my-plan.md
```

### Bare `/council` — print help

```text
/council
```

## Output

Each invocation produces:

- **Inline synthesis** — Headline (verdict count) + Agreement (findings cited
  by ≥2 reviewers) + Disagreement (unique findings or verdict conflicts).
- **Persisted report** at `docs/council/<date>-<mode>-<slug>.md` — synthesis
  plus three labeled raw reviewer outputs (each wrapped in injection fences
  and credential-redacted).

The user is asked for confirmation (M3 gate) before the report file is written.

## Configuration

| Var | Default | Purpose |
|---|---|---|
| `COUNCIL_TIMEOUT` | `600` | Per-reviewer timeout in seconds |
| `COUNCIL_OPENCODE_VARIANT` | `high` | OpenCode reasoning effort |
| `COUNCIL_PATH_CHAR_CAP` | `8000` | Per-file content cap for `--paths` |
| `COUNCIL_PATH_MAX_FILES` | `3` | Max `--paths` files per invocation |

## What yellow-council does NOT do

- It does NOT block merges. Output is advisory.
- It does NOT modify git state. Read-only file inspection only.
- It does NOT replace `/review:pr` from yellow-review. The 14-reviewer
  Claude-only pipeline runs unchanged. Council is for cases where you want
  cross-lineage input.
- It does NOT auto-trigger. Always invoked by the user explicitly.

## V1 / V2

V1 is single-shot, synchronous, advisory-only. V2 will add multi-round
iterative review, lineage-weighted quorum aggregation, quote-backed evidence
verification, and persistent-session fleet management. See plugin CLAUDE.md
for the full V2 trajectory.

## License

MIT. Algorithmic ideas borrowed from `99xAgency/GodModeSkill` (also MIT).
