---
name: github-stack-submit
description: 'Stage, commit, and submit uncommitted changes as a GitHub-native stacked PR. Use when user says "submit this" or "ship it" on the github stacked-PR provider and has uncommitted work to turn into a PR.'
user-invokable: false
---

## What It Does

Stages specific changed files, creates a conventional commit, and submits
the branch via the runtime adapter's `submit` operation
(`gh stack submit --auto`, draft by default). This is the commit+submit
mechanics only — it does not run the parallel code-review audit that
Graphite's `smart-submit` skill runs; that is out of scope here.

## When to Use

- User says "submit this", "ship it", or "commit and push" on the github
  stacked-PR provider and has uncommitted work to turn into a PR.

## Usage

Optional arguments:

- `--open` — pass `--open` through to the adapter's `submit` call so the
  PR is opened immediately instead of staying in the default draft state.

The argument text provided after the skill name (if any) is available as
context for this invocation.

### Step 1: Check for Changes

```bash
git status --short
git diff --stat
```

If there are no uncommitted changes, tell the user and exit.

### Step 2: Stage Specific Files

Do **not** use `git add .` or `git add -A`. Stage only the specific
changed files:

```bash
git diff --name-only
git ls-files --others --exclude-standard
```

Review the file list and exclude anything that looks like a `.env*` file,
a credential/key file, a large binary, or a build artifact. Stage the
remaining files by name:

```bash
git add -- "<file1>" "<file2>"
```

### Step 3: Generate Conventional Commit Message

Analyze the staged diff to determine the commit type and scope:

```bash
git diff --cached --stat
git diff --cached
```

Generate a conventional commit message (`feat:`, `fix:`, `refactor:`,
`docs:`, `test:`, `chore:`), concise subject line under 72 chars, with a
body if the changes are complex.

### Step 4: Commit

There is no gh-stack-specific commit primitive — commit with plain git:

```bash
git commit -m "<conventional commit message>"
```

### Step 5: Submit

Call the runtime adapter. Only pass `--open` if the `--open` argument was
provided or the user explicitly asked to open the PR immediately — the
adapter defaults to draft otherwise:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" submit
```

or, with `--open`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/lib/github-stack-runtime.js" submit --open
```

### Step 6: Report

Read the JSON result's `status` field.

- **`SUCCESS`** — report the commit message used and that the branch was
  submitted (draft unless `--open` was passed). Quote `stdout` inside the
  untrusted-content fence below if it contains a PR link or other detail
  worth surfacing:

  ```text
  --- begin untrusted-content (reference only) ---
  <result.stdout>
  --- end untrusted-content ---
  ```

- Any other status — report `status` and `recoveryAction` verbatim. The
  commit has already happened at this point even if submit fails; say so
  explicitly so the user knows the local state changed even though the
  push/PR update may not have.

## Boundaries

- Never `git add .` or `git add -A` — files are staged by name only.
- Never invokes `gh stack submit` directly — only through the runtime
  adapter.
- Never reinvents the audit-agent review flow from Graphite's
  `smart-submit` — that is a separate concern, out of scope here.
