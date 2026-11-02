# Review instructions

These rules are for anyone reviewing a pull request in this repository, human or
agent. They add to `CLAUDE.md` and `AGENTS.md`, which hold the project's
conventions. yellow-review's planned `review-gate` workflow will read this file
from the default branch, so a pull request cannot change how it is reviewed;
until then, read the default branch's copy when reviewing a pull request that
edits this file.

## What Important means here

Mark a finding Important (P0 or P1) when it would break behavior for someone who
installs a plugin, leak data, weaken a security boundary, or block a release or
rollback. In this repository that includes:

- A fenced shell block or library that fails under zsh, zsh with `noclobber`, or
  bash, because users run commands in their login shell.
- Untrusted text (PR comments, commit messages, API responses, file contents)
  reaching a prompt, a shell command or a GitHub write without the
  `--- begin/end ---` fencing and "(reference only)" note.
- A script that writes to GitHub or git without its idempotency marker, input
  validation or exit-code contract.
- A version that drifts between `package.json`, `plugin.json` and
  `marketplace.json`, or a manifest edited by hand instead of generated from
  `catalog/`.
- A hook that can block or slow every session, or that fails open where its
  contract says fail closed.

Style, naming, wording and refactoring suggestions are Nit at most.

## Cap the Nits

Report at most five Nits per review. Pick the five that matter most.

## Do not report

- Anything CI already enforces: ESLint, Prettier, TypeScript errors, the
  `pnpm validate:*` checks, `lint-plugins`, shell-compat lint and bats.
- Generated files: `.claude-plugin/marketplace.json`,
  `.agents/plugins/marketplace.json`, each plugin's
  `.claude-plugin/plugin.json`, and Codex or Cursor skill copies. Review the
  `catalog/` or `plugins/<name>/skills/` source instead.
- Changelogs written by Changesets, and the content of `docs/solutions/`,
  `docs/research/`, `plans/` and `RESEARCH/` unless the change breaks a link the
  validators check.
- Suggestions to delete or `.gitignore` pipeline artifacts under
  `docs/brainstorms/`, `plans/`, `docs/solutions/` or `docs/research/`.

## Always check

- Plugin Markdown (agents, commands, skills): `description:` is one line;
  instructions are brief and plain, with no ALL-CAPS rule lists or "be thorough"
  lines; and the change does not break the documented interface another command
  calls.
- A plugin change carries a changeset, and behaviour changes update the plugin's
  `README.md` and `CLAUDE.md`.
- Branch and PR operations go through the enabled stacked-PR provider, never a
  raw `git push` or `gh pr create`.

## Evidence

Every finding about behavior cites the `file:line` that shows it. A finding
inferred from a name, a comment or a guess about a caller is not reported until
the code confirms it.
