---
name: workflows:review
description: 'Multi-agent PR review (redirects to /review:pr from yellow-review)'
argument-hint: '[PR number/URL/branch]'
allowed-tools:
  - Skill
  - AskUserQuestion
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
