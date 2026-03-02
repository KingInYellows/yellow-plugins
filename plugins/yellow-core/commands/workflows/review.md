---
name: workflows:review
description: 'Deprecated — redirects to /review:pr for adaptive multi-agent PR review'
argument-hint: '[PR number/URL/branch]'
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
  - Task
  - AskUserQuestion
  - Skill
---

# Code Review (Redirect)

> **Deprecated:** `/workflows:review` now redirects to `/review:pr` from the
> yellow-review plugin, which provides adaptive agent selection, automatic fix
> application, and knowledge compounding.

## Redirect

Pass arguments through to `/review:pr`:

#$ARGUMENTS

Invoke the Skill tool with `skill: "review:pr"` and `args: "$ARGUMENTS"`.

If the yellow-review plugin is not installed, inform the user:

> yellow-review plugin is not installed. Install it for full adaptive PR review:
>
> ```
> /plugin marketplace add KingInYellows/yellow-plugins
> ```
>
> Select `yellow-review` from the list.
