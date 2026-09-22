---
'yellow-ruvector': patch
---

Read the documented Claude hook payloads and keep the ruvector pin at
0.2.34. UserPromptSubmit uses the string field `prompt` and ignores
`user_prompt`; non-string values are not recall queries. Recalled text
for UserPromptSubmit and SessionStart is model context in
`hookSpecificOutput.additionalContext`. The SessionStart embedder
provenance note stays on `systemMessage`. PostToolUse and
PostToolUseFailure record a bash or edit outcome only when the event
supplies an explicit success or an `Exit code N` failure. A missing
status, an interrupt, or a bare error is not submitted upstream.
Setup, status, and upgrade instructions stay on `ruvector@0.2.34`.
