---
'yellow-core': patch
---

Remove four "be thorough" exhortations from `/flow:plan`, `/flow:work`,
`repo-research-analyst`, and `spec-flow-analyzer`. Anthropic's Claude 5-generation
prompting guidance says blanket thoroughness instructions that earlier models
needed now cause over-exploration; the concrete halves of each line (cite
files and line numbers; walk each user journey's happy, empty, error, and
permission paths) are kept. First slice of the prescriptiveness-trim work; the
file-level trims of the council and codex agents follow once the live A/B
harness (including the `agy` CLI) is available.
