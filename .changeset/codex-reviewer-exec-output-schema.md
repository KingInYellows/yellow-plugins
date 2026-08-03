---
"yellow-codex": patch
"yellow-council": patch
---

Fix `codex-reviewer` so its structured output actually arrives. Step 4 invoked
`codex exec review`, which silently ignores `--output-schema` and always writes
its own hardcoded prose to `-o` — so Step 6's `jq` parsing found no
`findings[]`/`overall_correctness` and every Codex review degraded to
UNKNOWN/no-findings while appearing healthy.

Step 4 now uses plain `codex exec`, which honours `--output-schema`. Because
plain `exec` has no `--base` selector, the diff is written to a temp file and
named in the prompt rather than fetched by Codex itself — instructing Codex to
run `git diff` made it explore the repository until the 300s timeout expired
(measured: 66 tool calls, exit 124, no output). The file-based form converges in
3-4 minutes and scopes the review to exactly what Step 3 already size-checked.

`schemas/review-findings.json` is rewritten for OpenAI strict structured-output
mode (`additionalProperties: false` on every object, every key listed in
`required`, nullable unions for optional fields). Step 6's `jq` is unchanged —
`null` and absent behave identically under `//`.

Also in this change:

- `</dev/null` on the invocation: plain `exec` appends stdin to the prompt and
  blocks waiting for EOF if stdin is left attached.
- A fail-closed guard when the schema file is missing from the installation,
  rather than silently falling back to unparsable prose.
- `$DIFF_FILE` cleanup on every exit path.
- Fixed the `FINDINGS` byte-cap guard: `wc -l` counts newlines, so a cut landing
  mid-second-line leaves exactly one and the `-gt 1` test wrongly returned the
  chopped tail. Now `-ge 1`, which accepts dropping one complete line when the
  cut lands exactly on a boundary — preferable to emitting a truncated one.
- Corrected the docs that asserted `exec review`'s `-o` file already contains
  this JSON, and the "may be ignored with certain model variants" note — the
  subcommand, not the model, is the deciding factor.
