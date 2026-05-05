# yellow-council

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
