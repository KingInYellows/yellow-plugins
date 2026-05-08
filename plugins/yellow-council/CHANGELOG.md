# yellow-council

## 0.2.1

### Patch Changes

- [`c3cdfdb`](https://github.com/KingInYellows/yellow-plugins/commit/c3cdfdb5a2c0d260e32096a524c4712fe277d019)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Add `$schema`
  pointer to all remaining plugin manifests:
  `https://json.schemastore.org/claude-code-plugin-manifest.json`

  Per https://code.claude.com/docs/en/plugins-reference, Claude Code's plugin
  loader ignores this field at load time, but editors and IDEs use it for
  autocomplete and inline validation against the official remote validator
  schema. yellow-core received the pointer earlier in the stack as a
  single-plugin probe; this PR extends it to the other 17.

  Also documents local vs remote validator divergence in CONTRIBUTING.md with a
  recipe for empirical install testing (`claude plugin validate`,
  `claude --plugin-url`, fresh-install probe). The `claude plugin validate` CI
  integration is deferred to a follow-up PR pending CI runtime evaluation.

## 0.2.0

### Minor Changes

- [`955cf03`](https://github.com/KingInYellows/yellow-plugins/commit/955cf03a9067003482c9968c799ff18672ffd3f3)
  Thanks [@KingInYellow18](https://github.com/KingInYellow18)! - Initial release
  of yellow-council plugin: on-demand cross-lineage council command
  (`/council <mode>`) fanning out to Codex (via yellow-codex), Gemini, and
  OpenCode CLIs in parallel for advisory consensus. Four modes: `plan`,
  `review`, `debug`, `question`. Synchronous fan-out with 600s per-reviewer
  timeout and partial-result reporting on timeout. Inline synthesis (Headline /
  Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. PR1 ships the scaffold + manifests +
  spike documentation; full reviewer agents and `/council` command
  implementation land in subsequent stacked PRs
  (yellow-council-core-implementation, yellow-council-polish-and-tests).

## 0.1.0

### Minor Changes

- Initial release: on-demand cross-lineage council command (`/council <mode>`)
  fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in
  parallel. Four modes: `plan`, `review`, `debug`, `question`. Synchronous
  fan-out with 600s per-reviewer timeout and partial-result reporting. Inline
  synthesis (Headline / Agreement / Disagreement) plus persisted report at
  `docs/council/<date>-<mode>-<slug>.md`. V1 scaffold + spikes; full
  implementation lands in subsequent PRs.
