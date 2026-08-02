---
"yellow-council": minor
---

Migrate the Gemini reviewer slot from the retired consumer-tier Gemini CLI to the Antigravity CLI (`agy`). Google stopped serving Gemini CLI requests for consumer subscriptions on 2026-06-18, so the slot was non-functional under subscription auth. The reviewer now invokes `agy --sandbox --add-dir <pack-dir> --print-timeout <duration> -p "<pointer>"` with the council pack delivered as a workspace file (agy does not read piped stdin). Setup detection, skill invocation patterns, and docs updated accordingly; spike record at `docs/spikes/antigravity-cli-headless-2026-08.md`.
