---
'yellow-goal': minor
---

feat: pin goal-gen 0.3.0 and speak provider protocol v2

The yellow-goal consumer now pins the published `goal-gen-0.3.0.tgz` release
and uses protocol v2 for capabilities discovery, the stub run, and a user-only
`/goal:run-real` command. The real-run command displays the engine manifest,
forwards an operator approval path, never passes `--yes`, and never mints an
approval. Stub scenarios and their flag refusals are unchanged.
