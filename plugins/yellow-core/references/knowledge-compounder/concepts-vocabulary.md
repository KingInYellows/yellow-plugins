# CONCEPTS.md vocabulary rules

`docs/CONCEPTS.md` defines the words that mean something specific in this
project — substrate that `docs/solutions/` and AGENTS.md can cite without
redefinition. Adapted from CE `ce-compound/references/concepts-vocabulary.md`
with this repo's conventions (target path is `docs/CONCEPTS.md`, capture is
interactive-only and M3-gated).

## What earns a slot

A term qualifies when its meaning here is precise enough that a new engineer
would need it defined to follow conversations, tickets, or code. General
programming vocabulary (caches, queues, jobs, sessions) does not belong,
even when used heavily.

**Hold the bar conservatively.** Clear core domain nouns qualify; borderline
terms wait for a later run. A class, table, or file name dressed up as an
entity is excluded — if the "term" is an implementation identifier, it is
not vocabulary. Conservatism is about quality, not count.

## Where terms come from

Scan the newly written solution doc **and** the surrounding conversation —
qualifying terms often live in the conversation rather than the doc itself.
A scoped run defines only terms it actually investigated; it does not reach
for repo-wide nouns it never touched. (A repo-wide bootstrap glossary is an
explicit user request, not a side effect of one compound run.)

## The file stands on its own

Each entry teaches its concept to a reader with no access to anything else.
This rules out:

- Implementation specifics (file paths, class names, function signatures,
  table names, library calls)
- Status fields, dates, owners
- Current-config values that will change — state the behavior, not the
  number
- Links to PRs, issues, or roadmap items
- Version-specific claims ("currently uses X; migrating to Y")

Cross-references between entries are fine — they resolve internally. If an
entry leans on another *project-specific* term to make sense, that term is
itself a candidate to add.

## Per entry

Definition is one sentence — what the term means in this domain, what makes
it distinct from neighbors. A term with non-obvious behavioral rules
(lifecycle, ownership invariants) earns one extra paragraph for those rules,
never for elaborating the definition. When retired synonyms exist, list them
directly under the definition: *Avoid: <synonyms>*.

## Be opinionated

When the team uses several words for one concept, pick the best one and
record the rest as aliases. Settled distinctions go to a short "Flagged
ambiguities" tail section — the audit trail for vocabulary opinions.

## Output contract (for the Vocabulary Extractor subagent)

Return either:

- `NO_QUALIFYING_TERMS` (alone) when nothing meets the bar, or
- one block per candidate:

  ```
  TERM: <term>
  KIND: <new | refinement>
  DEFINITION: <one sentence; plus at most one behavioral-rules paragraph>
  ```

The subagent only proposes candidates. Only the orchestrator writes
`docs/CONCEPTS.md`, inside the M3 gate.
