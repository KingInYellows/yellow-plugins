---
'yellow-codex': patch
---

Correct the shared 6-key reviewer-contract note in `CLAUDE.md`: it listed only
yellow-council's Gemini and OpenCode reviewers, omitting `claude-reviewer`,
which has held a council slot since the four-reviewer rollout. One of seven
reviewer-roster claims across the repo that had gone stale without any reviewer
being added; the new `scripts/validate-council-roster.js` gate now blocks this
class of drift.
