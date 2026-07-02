# Run report template

Loaded by `compound-lifecycle` SKILL.md Step 9. Content moved verbatim
from SKILL.md (C6 progressive-disclosure split). Emit the report exactly
in this shape — the sections are parsed by downstream readers.

```markdown
## compound-lifecycle Report — <date> <time>

### Scope
- Candidates discovered: <int>
- Scope hint applied: <hint or "none — full catalog">
- Routing tier: <focused | batch | broad>

### Staleness
- Stale (score > threshold): <int>
- Pre-existing `status: stale`: <int>

### Overlap
- Cluster pairs (BM25 > p90): <int>
- High-confidence pairs (ruvector cosine ≥ 0.90): <int>
- Review-suggestions (0.78–0.90): <int>

### Applied (interactive mode: with user approval; autofix: unambiguous Updates only)
- <category>/<slug>.md — <classification> — <one-line rationale>
- ...

### Recommended (interactive mode: skipped or rejected; autofix: ambiguous cases)
- <category>/<slug>.md — <classification> — <one-line rationale>
- ...

### Archive moves
- <category>/<slug>.md → archived/<category>/<slug>.md (superseded_by: <new-path>)
- ...

### Coverage
- ruvector available: <yes|no — degraded scoring>
- Run mode: <interactive | autofix>
- Total runtime: <sec>
```
