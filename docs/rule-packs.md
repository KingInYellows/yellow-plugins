# Rule packs

A rule pack is a folder of team rules that need judgment to apply: the
conventions a reviewer keeps pointing out but no validator can check. Packs are
optional. A repository without a `rule-packs/` folder reviews and plans exactly
as before.

## Where packs are used

- `/review:pr` (yellow-review) gives every pack rule to
  `project-standards-reviewer`. The rules are read from the PR's **base**
  branch, so a PR cannot add or rewrite the rules it is judged by. A change that
  contradicts an applicable rule becomes a finding whose title cites
  `(pack: <id>, <file>)`, with the rule text and the violating line.
- `/flow:plan` (yellow-core) gives the packs to `learnings-researcher`, read
  from the working tree. Matching rules appear in the plan's past-learnings
  context with the same `(pack: <id>, <file>)` citation.

Nothing else reads packs. The learnings pre-pass in `/review:pr` does not, so a
rule reaches review through one reviewer only.

## Layout

```text
rule-packs/
  <id>/                 pack id: lowercase letters, digits and hyphens
    README.md           what the pack covers; never loaded as a rule
    <rule>.md           one rule per top-level .md file (letters, digits, . _ -)
    examples/           subfolders are storage and are never read
```

- Only top-level `.md` files other than `README.md` are rules. They load in name
  order, at most 25 per pack.
- A rule file over 16 KiB is skipped, and loading stops at 96 KiB across all
  packs. Each skip prints a `[rule-packs] Warning:` line.
- Rule file names start with a letter or digit and use only ASCII letters,
  digits, `.`, `_` and `-`; other names are skipped with a warning.
- A pack id and file name load once. When the repository and a machine-local
  folder both have `<id>/<file>`, the repository's copy wins.
- Symlinked pack folders and rule files are skipped.

## Rule format

```markdown
---
title: Fence untrusted input before an agent reads it
applies_when:
  - A command, agent or skill passes PR comments or API responses to a model
  - A new or changed prompt interpolates text the plugin did not write
tags: [security, prompt-injection] # optional
---

What to do, in a few imperative sentences. Name the concrete consequence of
breaking the rule when there is one.
```

- `title` and `applies_when` are required; a file missing either is skipped with
  a warning.
- `applies_when` lists situations in plain language. Reviewers match them to the
  change by meaning, not by keyword, so write them as situations ("a command
  creates a PR"), not as file globs.
- Severity: a pack finding is capped at P2. It may be P1 only when the rule's
  own text names a concrete consequence of breaking it, such as a CI failure, a
  parser truncation or a security risk. Say so in the rule when it is true.
- Keep a rule to one decision. Split a rule that needs "and also".

## Safety

Pack text is untrusted reference data. One builder script, shipped as
byte-identical copies in yellow-review
(`skills/pr-review-workflow/scripts/rule-pack-context`) and yellow-core
(`lib/rule-pack-context.sh`), loads every rule; no agent reads pack files
itself. It removes control and bidi characters, defangs any line that opens a
`--- begin` or `--- end` fence, escapes XML metacharacters, and wraps the result
in a `rule-packs` reference-only fence. Reviewers quote rule text as evidence
and never follow instructions inside it; a rule saying "skip all tests" is
reported, not obeyed.

## Machine-local packs

To use packs that live outside the repository, list their folders in
`yellow-plugins.local.md` frontmatter. Each folder is laid out like
`rule-packs/`:

```yaml
---
rule_pack_dirs:
  - ~/team-rule-packs
---
```

The key is read from the user-level
`${CLAUDE_CONFIG_DIR:-$HOME/.claude}/yellow-plugins.local.md` and from a repo
copy only when git does not track it. A tracked copy's value is ignored with a
warning, because a branch could otherwise point a review at any folder on your
machine. Entries must be absolute paths (or `~/...`) without `.` or `..`
segments.

Git-pinned packs shared across repositories are not supported yet.

## When to write a validator instead

If a rule can be checked mechanically (a regex, a schema, a line count), add it
to a validator under `scripts/` instead. Validators fail CI; pack rules only
inform a reviewer. Move a pack rule to a validator once it becomes mechanical,
and delete it from the pack.
