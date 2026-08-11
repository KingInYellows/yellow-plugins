---
"yellow-core": major
"yellow-research": major
"yellow-linear": patch
"yellow-review": patch
"gt-workflow": patch
---

Rename the `workflows:` command namespace to `flow:`. Native Claude Code's
built-in `/workflows` occupies that autocomplete prefix, so typing
`/workflows` no longer narrows to these commands; `/flow` does.

The nine yellow-core commands are now `/flow:brainstorm`, `/flow:spec`,
`/flow:decompose`, `/flow:pick-next-shell`, `/flow:expand-shell`,
`/flow:plan`, `/flow:work`, `/flow:review`, and `/flow:compound`. Their
directory moved to `commands/flow/`, and `/flow:work`'s progressive-disclosure
reference moved to `references/flow-work/` alongside the `work.md` path that
loads it. Runtime surfaces moved with the names: `skill:` dispatch targets,
log tags, user-facing error text, and the `<!-- Updated by flow:work -->`
marker `/flow:work` stamps into plan files.

yellow-research's `/workflows:deepen-plan` becomes `/flow:deepen-plan`, moving
to `commands/flow/` alongside the yellow-core commands it shares a namespace
with. Its documented pipeline is now `/flow:plan` → `/flow:deepen-plan` →
`/flow:work`.

yellow-linear takes a `patch`: `/linear:work` dispatches into the renamed
namespace via `skill: "flow:plan"`, and those two dispatch strings would have
silently failed to resolve at runtime had they been left behind. No
yellow-linear command name changes.

yellow-review takes a `patch` for the same reason: `/review:sweep-all`'s
end-of-loop learning capture dispatches `skill: "flow:compound"`.

gt-workflow takes a `patch`: its stack-decomposition skills, output styles,
and docs name `/flow:work` / `/flow:plan` as the plan consumer, updated from
the retired `workflows:` names.

`major` for both: the old `/workflows:*` command files are deleted outright
with no forwarding alias, and both AGENTS.md and `CONTRIBUTING.md` state the
bump-type rule as major for "removal of a command" / "removed or breaking
command interfaces" with no carve-out for a marketplace with no external
install base. The singular `yellow-core:workflow:*` agent namespace is
unchanged.

A new CI gate, `pnpm validate:flow-namespace`, walks the whole repository
(including hidden directories) for surviving `workflows:` references and
fails on any that is not in `scripts/flow-namespace-allowlist.json` at its
exact expected occurrence count. The allowlist shrinks to nothing as the
remaining prose sweep lands.
