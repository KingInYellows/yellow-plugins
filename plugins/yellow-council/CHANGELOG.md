# yellow-council

## 0.1.0

### Minor Changes

- Initial release: on-demand cross-lineage council command (`/council <mode>`) fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in parallel. Four modes: `plan`, `review`, `debug`, `question`. Synchronous fan-out with 600s per-reviewer timeout and partial-result reporting. Inline synthesis (Headline / Agreement / Disagreement) plus persisted report at `docs/council/<date>-<mode>-<slug>.md`. V1 scaffold + spikes; full implementation lands in subsequent PRs.
