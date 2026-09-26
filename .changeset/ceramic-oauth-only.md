---
"yellow-research": minor
"yellow-core": patch
---

Ceramic is OAuth-only: `CERAMIC_API_KEY` is no longer read anywhere. The
Ceramic MCP always authenticated via OAuth 2.1, but `/research:setup` still
checked the key, validated its `cer_sk` format and ran a REST live-probe with
it, and `/setup:all` listed it — suggesting a key was required.
`/research:setup` and `/setup:all` now decide Ceramic availability from
`ceramic_search` visibility alone, and the docs name EXA, Tavily and Perplexity
as the only API keys. An exported `CERAMIC_API_KEY` is ignored; unset it if you
like. The opt-in live REST test (`tests/integration/ceramic.test.ts`) is
removed. The key name stays on the never-commit and name-based redaction lists.
