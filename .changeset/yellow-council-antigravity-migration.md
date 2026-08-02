---
"yellow-council": patch
---

Migrate the Gemini reviewer slot from the retired consumer-tier Gemini CLI to the Antigravity CLI (`agy`). Google stopped serving Gemini CLI requests for consumer subscriptions on 2026-06-18, so the slot was non-functional under subscription auth. The reviewer now runs `agy --sandbox --print-timeout <duration> -p "<pointer>"` cwd-isolated inside the throwaway pack dir, with the council pack delivered as a workspace file (agy does not read piped stdin), a validated integer `COUNCIL_TIMEOUT`, and pack ingestion verified via a final-line INGEST_TOKEN echo. Setup detection, skill invocation patterns, security docs, and manual tests updated accordingly; spike record at `docs/spikes/antigravity-cli-headless-2026-08.md`.
