---
"yellow-codex": patch
---

Normalize `codex-reviewer` onto the structured 6-key return contract
(`verdict=`/`confidence=`/`summary=`/`fenced_output_path=`/
`findings_block_begin`...`findings_block_end`) already used by
yellow-council's Gemini and OpenCode reviewers. Every exit path — success,
diff-too-large, binary missing, timeout, auth failure, argument-parse
error, rate limit, and other CLI errors — now returns a structured verdict
block instead of free-text prose, fixing a silent bug where every Codex
leg of `/council` degraded to `verdict=ERROR` via the parser's default
fallback.
