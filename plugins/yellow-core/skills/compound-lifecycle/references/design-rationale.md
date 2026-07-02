# Design rationale — compound-lifecycle skill

Non-executed background for the `compound-lifecycle` skill's design
decisions. Content moved verbatim from SKILL.md (C6
progressive-disclosure split).

## Why "archive, don't delete"

The upstream `ce-compound-refresh` skill explicitly says delete and let
git history serve as the archive. yellow-plugins diverges deliberately:

- **Searchability** — archived entries remain `Grep`-able for
  `learnings-researcher` to find when a related-but-not-identical
  problem recurs
- **Citation continuity** — external references (Linear issues, Slack
  threads, PR descriptions) that link `docs/solutions/<...>.md` paths
  don't 404 when the entry moves to `archived/`
- **Drift forensics** — when a consolidated entry turns out to have
  been over-eager and a sub-entry's specific advice was lost, the
  archive is a single `Read` away, not a `git log --follow`
  excavation

The `archived/` subtree is intended to be out of `learnings-researcher`'s
default search path — matching the upstream's effective "don't surface
old advice" goal — but the agent does not currently filter
`docs/solutions/archived/**` automatically. Until that exclusion is
added (separate follow-up), archived entries may still surface in
search results; until then, the archive is functionally citable but
not yet operationally separated from live retrieval.
