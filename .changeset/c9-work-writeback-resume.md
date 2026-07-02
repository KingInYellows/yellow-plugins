---
'yellow-core': patch
---

Session-survivable execution state for non-stack `/workflows:work` runs (Tier 2 C9): Phase 2 gains an entry resume check (read the plan; if any task checkboxes are already `[x]`, announce resume mode and start from the first unchecked box) and a per-step writeback (step 1k ticks the step's own checkbox in the same loop iteration as its TaskUpdate, with the stack path's read-back verification). No parallel `## Progress` section is introduced — the plan's existing checkboxes are the single progress surface, keeping `validate-plans.js` and `/plan:complete` Gate A semantics unchanged. A granularity guard requires task-tracking entries to match plan checkboxes one-to-one. Prose-only plans (no checkboxes) degrade to the previous behavior.
