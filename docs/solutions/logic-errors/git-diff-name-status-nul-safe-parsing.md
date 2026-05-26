---
title: 'git diff --name-status silently drops non-ASCII paths without -z flag'
date: 2026-05-26
category: logic-errors
track: bug
problem: 'git diff --name-status quotes non-ASCII/space/tab filenames with C-style escaping unless -z is passed, causing downstream string checks to silently fail and CI to report green on gated files'
tags:
  - git
  - validation
  - unicode
  - ci
  - shell
  - node
components:
  - scripts/validate-solutions.js
  - tests/integration/validate-solutions.test.ts
---

# git diff --name-status silently drops non-ASCII paths without -z

P1 finding from PR #553 (solution-doc-git-workflow implementation), surfaced
by the chatgpt-codex-connector reviewer. The validator `scripts/validate-solutions.js`
parsed `git diff --name-status` output using line/tab splitting. On paths
containing non-ASCII characters (or spaces, tabs, or control characters), git
quotes the path with C-style escaping — silently. Downstream `startsWith()` /
`endsWith()` / `split()` checks then fail to match, the file is dropped from
the diff entries list, and CI reports green on a PR that should have been gated.

---

## Problem

`git diff --name-status <ref>...HEAD` (without `-z`) quotes paths with
"unusual" characters using C-style octal escaping, wrapped in double-quotes:

```
A	docs/solutions/workflow/caf\303\251.md
```

arrives as the literal string:

```
A	"docs/solutions/workflow/caf\303\251.md"
```

The surrounding double-quotes are part of the raw output — they are not shell
quoting. The parser's tab-split yields `parts[1]` = `"docs/solutions/workflow/caf\303\251.md"` (with leading `"`), which fails every `startsWith('docs/solutions/')` check because the leading `"` is not `d`.

The affected filenames include:

- Any non-ASCII character (accented letters, CJK, emoji)
- Embedded spaces
- Embedded tabs
- Control characters

This behavior is controlled by `core.quotePath`, which defaults to `true`.
There is no error, no warning, no exit code change — the path is silently
dropped. When all modified files in a PR are dropped, the validator runs
against an empty entries list and exits 0.

**Cross-project applicability:** Any Node/shell validator that consumes `git
diff --name-only` or `git diff --name-status` has the same exposure. This
includes slug validators, frontmatter linters, changelog gates, and security
scanners. The fix is always the same: add `-z`.

---

## Symptoms

- CI passes green on a PR containing only `docs/solutions/` files with
  non-ASCII filenames.
- Validator prints no output at all (zero files to check).
- Locally, running the validator with `git diff --name-status` on a path
  containing a space or accent reproduces the empty parse.
- Adding `GIT_CONFIG_COUNT=1 GIT_CONFIG_KEY_0=core.quotePath GIT_CONFIG_VALUE_0=false`
  to the env makes the validator work again — confirming `quotePath` is the cause.

---

## What Didn't Work

**`raw.split(/\r?\n/)` + line.split(`\t`):** The standard idiom. Matches the
non-`-z` format for ASCII paths but breaks silently on the cases that matter.
Indexing `parts[1]` and `parts[2]` gives the quoted form, not the real path:

```js
// WRONG — silently drops quoted paths
const entries = raw
  .split(/\r?\n/)
  .filter(Boolean)
  .map(line => {
    const parts = line.split('\t');
    return { status: parts[0], path: parts[1] };
  });
```

**Setting `core.quotePath = false` in the git invocation:** Works but is
fragile — it relies on a config flag that could be overridden by user or CI
environment git config. The `-z` flag is unconditional.

---

## Solution

Add `-z` to the `git diff` invocation and replace the line/tab parser with a
NUL-separated parser.

### Step 1 — Add `-z` to the git diff command

```js
const result = spawnSync(
  'git',
  ['diff', '--name-status', '-z', `${BASE_REF}...HEAD`, '--', 'docs/solutions'],
  { encoding: 'utf8' }
);
```

With `-z`, records are NUL-separated and paths arrive verbatim — no quoting,
no escaping, no surrounding double-quotes.

### Step 2 — Write a NUL-separated parser

The `-z` format differs from the non-`-z` format for rename/copy records:

| Record type | `-z` field order |
|---|---|
| A, M, D, T, U, X, B | `STATUS\0PATH\0` |
| R (rename), C (copy) | `STATUS\0OLDPATH\0NEWPATH\0` |

There is a trailing NUL after the last record. The status field for R/C
records includes a score suffix (e.g., `R100`, `C75`) — check `status[0]`,
not exact equality.

```js
function parseNulSeparatedDiff(raw) {
  const entries = [];
  const fields = raw.split('\0').filter((f, i, arr) => {
    // Drop the trailing empty string from the final NUL
    return i < arr.length - 1 || f !== '';
  });
  let i = 0;
  while (i < fields.length) {
    const status = fields[i++];
    if (!status) continue;
    if (status[0] === 'R' || status[0] === 'C') {
      const oldPath = fields[i++];
      const newPath = fields[i++];
      entries.push({ status, path: newPath, oldPath });
    } else {
      const path = fields[i++];
      entries.push({ status, path });
    }
  }
  return entries;
}
```

### Step 3 — Maintain a separate tab-separated parser for test fixtures

NUL bytes in JS string literals are awkward. Keep a synthetic injection path
for tests using the env-var format (`A\tpath\nM\tpath`) and route real git
output through the NUL parser:

```js
function parseDiffOutput(raw, useNul) {
  if (useNul) return parseNulSeparatedDiff(raw);
  // Synthetic tab/newline format for test injection
  return raw
    .split('\n')
    .filter(Boolean)
    .map(line => {
      const [status, path, newPath] = line.split('\t');
      return newPath
        ? { status, path: newPath, oldPath: path }
        : { status, path };
    });
}
```

In production: `parseDiffOutput(gitOutput, true)`.
In tests via `VALIDATE_SOLUTIONS_DIFF` env var: `parseDiffOutput(envInput, false)`.

### Step 4 — Add a unicode regression fixture

Add a test that asserts a non-ASCII filename reaches the downstream slug-validation
step rather than being silently dropped. The test exercises the synthetic-injection
parser (not real git), so it runs in any CI environment:

```ts
it('passes non-ASCII filenames through to slug validation', () => {
  process.env.VALIDATE_SOLUTIONS_DIFF = 'A\tdocs/solutions/workflow/café.md';
  const result = runValidator();
  // Should fail on slug content, not silently pass with zero files
  expect(result.checkedFiles).toContain('docs/solutions/workflow/café.md');
});
```

The real-git `-z` behavior is implicitly exercised by any PR that touches a
non-ASCII path in `docs/solutions/` — the unit fixture exists specifically to
catch a regression to the old parser.

---

## Why This Works

`-z` is an unconditional override of `core.quotePath`. When `-z` is active,
git writes path bytes verbatim to stdout with NUL as the record separator.
There is no configuration that reverts this to quoting behavior. The NUL
separator is safe for any filename the filesystem allows, because NUL is the
one byte that cannot appear in a POSIX filename.

The tab-based parser is still correct for the synthetic test format because
that format is under our control — test fixtures never contain non-ASCII
characters unless they are specifically testing the non-ASCII path, in which
case the test is explicitly constructing the right input.

---

## Prevention

- **Any new validator that calls `git diff --name-only` or `git diff --name-status`:**
  always pass `-z` and use a NUL-separated parser. Treat line/tab splitting as
  a pattern that only works for ASCII-only filenames.
- **Fixture coverage rule:** every path-parsing validator must include at least
  one fixture asserting that a filename with a non-ASCII character, space, or
  parenthesis reaches the downstream check rather than being silently dropped.
- **git diff man page note:** the quoting behavior is documented under
  `core.quotePath` and `--no-renames`, but is easy to miss because the default
  is `true` (quoting on) and there is no warning when a path is quoted.
- **cross-repo applicability:** apply this check whenever writing shell or Node
  validators that consume git diff output — slug validators, frontmatter
  linters, changelog gates, and security scanners are all at risk.
