---
'yellow-core': minor
---

Add an opt-in TypeSafe Jev shadow pre-filter to the compound-staging Stop
hook. With `COMPOUND_JEV_PREFILTER=shadow` and `TYPESAFE_API_KEY` set, the
capture subshell asks Jev whether a finished session looks worth staging and
logs the answer to `compound-staging/jev-shadow.jsonl`. It never changes what
is staged, logs no transcript text, and fails silently. Off by default.
