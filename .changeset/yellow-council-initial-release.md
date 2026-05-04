---
"yellow-council": minor
---

Initial release of yellow-council plugin: on-demand cross-lineage council command (`/council <mode>`) fanning out to Codex (via yellow-codex), Gemini, and OpenCode CLIs in parallel for advisory consensus. Four modes: `plan`, `review`, `debug`, `question`. Synchronous fan-out with 600s per-reviewer timeout and partial-result reporting on timeout. Inline synthesis (Headline / Agreement / Disagreement) plus persisted report at `docs/council/<date>-<mode>-<slug>.md`. PR1 ships the scaffold + manifests + spike documentation; full reviewer agents and `/council` command implementation land in subsequent stacked PRs (yellow-council-core-implementation, yellow-council-polish-and-tests).
