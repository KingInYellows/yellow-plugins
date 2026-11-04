---
'yellow-core': minor
---

Add an optional `retire_when` frontmatter field to `docs/solutions/` docs,
ported from Compound Engineering's ce-compound schema. `knowledge-compounder`
sets it only when a learning holds just while something outside the repo holds
(an upstream bug, a tool version, a dependency's behavior). `compound-lifecycle`
lists those docs as their own triage group, checks each condition read-only, and
routes a met condition to Update, Replace or Delete-and-archive.
`validate-solutions` rejects a present but empty, non-string or multi-line
value.
