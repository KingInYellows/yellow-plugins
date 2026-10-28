# Thermonuclear-reviewer fixture eval

Runs `thermonuclear-reviewer` against the ten fixtures in
`plugins/yellow-review/tests/fixtures/thermonuclear/` and grades each run
pass/fail against that README's "Expected" column. It is a manual evidence pass,
not a gate: never wire it into CI or bats (the fixture README says why).

`run` and `smoke-claude` spend real model usage. `prepare`, `run --dry-run` and
`grade` spend nothing.

```bash
W=$(mktemp -d)
python3 scripts/eval/thermonuclear-fixtures/eval.py prepare "$W"
python3 scripts/eval/thermonuclear-fixtures/eval.py run "$W" -k 3   # opus, xhigh, as the agent declares
python3 scripts/eval/thermonuclear-fixtures/eval.py grade "$W"
python3 scripts/eval/thermonuclear-fixtures/eval.py smoke-claude "$W"
```

`prepare` builds the dispatch prompt the way `/review:pr` Step 5 does: delimiter
substitution then XML escaping, the pr-context fence, a `<file-line-counts>`
fence (header plus rows) when the fixture has a `.linecounts` file, the
`.context` file inside the pr-context fence, and the `<rule-vocabulary>` block.
The system prompt is the agent file with its preloaded skill appended. Each run
is one `claude -p` through `../model-swap/run-one.sh` in an empty directory, so
the reviewer sees only the prompt. The exception is `canonical-helper-reuse`,
whose directory holds `src/lib/strings.ts` with `slugify` at line 14: in a real
review the helper is in the checkout, and the reviewer should Read it before
recommending reuse. With only the `.context` text it reports the finding at
confidence 50, below `/review:pr`'s gate of 75.

`grade` is binary per run and exits non-zero unless every run in the matrix
`run` last wrote passes. A run fails when it left no output, when its output is
not parseable JSON or lacks a top-level `reviewer`, `findings`, `residual_risks`
or `testing_gaps` key, when a finding breaks the persona's output contract (a
missing compact-return field, severity above P1, a category other than
`maintainability`, `autofix_class` other than `advisory`, `owner` other than
`human`, `requires_verification` not `true`, a `line` that is not a positive
integer, `confidence` off the 0/25/50/75/100 anchors, or a non-boolean
`pre_existing`), or when the case predicate in `eval.py` `CASES` fails. Each
run's fingerprint hashes its prompts and seeded files, so after a persona or
fixture change `run` reruns it instead of reusing the old output. Read the
findings column as well: the predicates are regexes, and a title can match
without the finding being right.

## Cross-host smoke

- **Claude Code:** `eval.py smoke-claude` loads yellow-core, yellow-linear and
  yellow-review with `--plugin-dir` and dispatches the persona through the Agent
  tool, as `/review:pr` does. yellow-review does not load without both
  dependencies, and `--agent` is no substitute: the main-thread agent does not
  get its `skills:` preload.
- **Codex:** `pnpm smoke:codex --plugin yellow-review --keep-temp` installs into
  a temporary `CODEX_HOME` and checks app-server discovery. Do not put `--`
  before the flags: the repo's pinned pnpm 8.15 passes it through and the script
  fails with "Unknown argument". The script accepts only Codex CLI 0.157.0; with
  a newer `codex` on PATH, install 0.157.0 elsewhere and point `CODEX_BIN` at
  it. Then run
  `node scripts/eval/thermonuclear-fixtures/check-installed-skill.js` on the
  installed `SKILL.md` path from its report. To invoke the skill, reuse the kept
  profile and the same binary, or the run can skip the installed copy
  (`KEPT_CODEX_HOME` is the profile path from the report, `REPO` this checkout):

  ```bash
  cp ~/.codex/auth.json "$KEPT_CODEX_HOME/" # never print it
  cd "$(mktemp -d)" && git init -q && cp "$REPO/plugins/yellow-review/tests/fixtures/thermonuclear/wrapper-indirection.diff" . \
    && git add . && git commit -qm fixture
  CODEX_HOME="$KEPT_CODEX_HOME" "${CODEX_BIN:-codex}" exec --disable remote_plugin -s workspace-write \
    'Use the yellow-review:yellow-thermonuclear-review skill to review wrapper-indirection.diff. Report findings only.'
  git status --porcelain # must print nothing
  ```

  `workspace-write` is deliberate: a clean tree then tests the skill's
  report-only rail, not the sandbox. Expect the indirection finding.

- **Cursor:** needs the Cursor editor. Place the plugin at
  `~/.cursor/plugins/local/yellow-review/` (on Windows, the Windows profile's
  `.cursor`, not WSL's), reload the window, and confirm
  `yellow-thermonuclear-review` is listed. Run `check-installed-skill.js` on
  `cursor/skills/yellow-thermonuclear-review/SKILL.md` in that copy, the path
  `.cursor-plugin/plugin.json` points Cursor at. The Claude Code copy under
  `skills/` fails the frontmatter check by design (`user-invocable: false`).
  Before invoking, remove or disable every other `yellow-review` Cursor can see:
  Cursor imports Claude Code's installed plugins and its own marketplace copies,
  does not log which same-named plugin wins, and lets a marketplace install take
  precedence over a local copy. Then invoke the skill by name on one fixture
  diff.

Results so far: [`results-2026-10-26.md`](results-2026-10-26.md) (fixture eval,
Claude Code smoke, Codex discovery) and
[`results-2026-10-28.md`](results-2026-10-28.md) (Codex invocation, Cursor).
