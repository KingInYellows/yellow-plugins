# Dirty-tree cleanup after a resolve or sweep

Loaded by `/review:resolve-stack` Step 3 item 3b and `/review:sweep-all`
Step 4 item 4 when the tree is dirty after a PR. The tree was clean at
pre-flight, so a dirty tree means the resolve or sweep left edits behind, or
an editor or build touched it. Revert only what the run owns and leave
everything else in place. `<PR#>` is the PR just processed; the caller
substitutes the literal number.

Each command loads its own copy, because offloaded detail lives under that
command's `references/<slug>/`: this file and
`references/review-sweep-all/dirty-tree-cleanup.md` are byte-identical.
Change both together; `tests/skill-content.bats` fails when they differ.

## 1. List the dirty paths

```bash
git status --porcelain=v1 -z --untracked-files=all
```

Output is NUL-separated records of `XY <path>`. When `X` or `Y` is `R` or
`C`, the next NUL field is the original path with no `XY` prefix; list both and
keep them together as one rename/copy entry (destination first, then original).
Never use plain `--porcelain`: it collapses untracked directories and quotes
unusual paths. If the command fails, treat the tree as dirty with unknown
contents: revert nothing and report `revert incomplete`.

## 2. Classify each path

A path is **owned** when it is one of:

- a changed file of the PR, except anything under `.claude/agent-memory/`
  (never owned, even when the PR changes it): the first column of
  `"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/pr-changed-ranges" "<PR#>"`
  (paginated files API; it works past `gh pr diff` size limits and lists only
  paths matching `^[A-Za-z0-9._/-]+$`) — plus the `previous_filename` of each
  renamed file, read with
  `"${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/pr-changed-ranges" --previous "<PR#>"`
  (one original path per line, nothing else). The script validates each value
  against `^[A-Za-z0-9._/-]+$` with whole-string anchors and fails the whole
  call (exit 1, no output) on any other value, because git permits a newline
  in a file name and an unchecked name would forge a record. A non-zero exit,
  including a `gh` timeout, means the lookup failed: discard its output.

  The PR's owned file set is each file's `filename` plus its
  `previous_filename`, under the same `^[A-Za-z0-9._/-]+$` and
  `.claude/agent-memory/` rules. If this call fails, no `previous_filename` is
  known and original paths stay unrecognized;
- a **trusted-config path**, which a refused resolver edit must never leave on
  disk: a path `rp_trusted_config` in
  `${CLAUDE_PLUGIN_ROOT}/lib/resolve-paths.sh` accepts. It is the one
  predicate for this policy; `/review:resolve`'s `--revert-denied` uses it
  too. It matches case-insensitively at any depth, because a nested file
  steers tooling as the root one does: a path inside, or equal to, a
  `.claude`, `.cursor`, `.codex`, `.agents`, `.gemini`, `.windsurf`, `.cline`,
  `.vscode`, `.devcontainer` or `.idea` directory, and a file named
  `yellow-plugins.local.md`, `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`,
  `.mcp.json`, `.cursorrules`, `.windsurfrules`, `.clinerules` or
  `copilot-instructions.md`, except `.claude/agent-memory/` at the
  repository root (described below). The function is authoritative; this
  copy is for classifying, and step 3 never passes it on a command line.

`.claude/agent-memory/` is excluded because agents with `memory: project`
write learnings there as a normal part of a run. Those writes are not
evidence of a refused edit, and reverting them would delete legitimate
memory. They are not owned, even when the PR's own file list includes them,
so they follow the unrecognized path below.

A rename or copy entry (two paths from step 1) is owned only when **both** of
its paths are owned. If either path is unrecognized, the whole entry is
unrecognized.

Every other path is **unrecognized**. When `pr-changed-ranges` exits non-zero,
no path is owned through the PR file list (only trusted-config paths remain
owned), so the remaining dirty paths are unrecognized. A path outside
`^[A-Za-z0-9._/-]+$` is unrecognized.

## 3. Revert

Call `run-verify-command` by its full path, check its exit code, and read its
JSON before acting. Exit `2` means it refused and reverted nothing.

- **Every dirty path is owned** — save and revert all of it:

  ```bash
  "${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/run-verify-command" --pr "<PR#>" --revert-dirty
  ```

  Print its `patch` path when it is not null. A non-zero exit,
  `treeClean: false`, or an incomplete-revert `reason` (below) is
  `revert incomplete`.
- **Any dirty path is unrecognized** — do NOT run `--revert-dirty`. Revert
  only the trusted-config paths; the script lists them itself with
  `rp_trusted_config`, so no path goes on the command line:

  ```bash
  "${CLAUDE_PLUGIN_ROOT}/skills/pr-review-workflow/scripts/run-verify-command" --pr "<PR#>" --revert-denied --no-ignored-guard
  ```

  `--no-ignored-guard` is required here: this cleanup holds no
  `--ignored-since` marker, and `/review:resolve` already guarded the
  gitignored files of its own run. Skip the call when step 2 found no
  trusted-config path. A non-zero exit,
  `deniedClean: false`, or an incomplete-revert `reason` (below) is
  `revert incomplete`; `result: "noop"` means nothing needed reverting.
  `treeClean` stays `false` here because the unrecognized paths remain, so do
  not read it as a failure. Report the unrecognized paths as
  `unrecognized changes left in place`.

An **incomplete-revert `reason`** is a `reason` in the JSON containing
`nothing was reverted` (patch save failed) or `revert failed:` (a checkout or
delete failed). The script exits `0` for both, so check `reason` even after a
zero exit.

`--revert-dirty` and `--revert-denied` delete an untracked, non-ignored file
they revert, whoever created it, because the pre-resolve state is not
recorded (tracked in #973). Neither lists a gitignored file, so a gitignored
trusted-config edit stays on disk.

The caller says what to do with the outcome: the patch path, `revert
incomplete`, and `unrecognized changes left in place` all feed its summary.
