---
"yellow-core": minor
---

CONCEPTS.md vocabulary capture: `knowledge-compounder` Phase 1 gains a 6th
extraction subagent (Vocabulary Extractor) that proposes glossary candidates
per a new `references/knowledge-compounder/concepts-vocabulary.md` criteria
file (conservative bar — clear core nouns qualify, borderline waits,
implementation identifiers excluded). Only the orchestrator writes
`docs/CONCEPTS.md`, inside the existing M3 gate; the M3 preview always
carries an explicit CONCEPTS line (+N terms / no qualifying terms /
not scanned). `docs/CONCEPTS.md` seeded with the bootstrap preamble.
Background-drain path unchanged (staging-promoter write scope frozen).
