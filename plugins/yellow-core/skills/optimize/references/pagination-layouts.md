# Phase 4 pagination layouts — lower-ranked candidate follow-ups

Loaded by `optimize` SKILL.md Phase 4 when the user's "Other" reply
references lower-ranked candidates AND `parallel_count >= 3`. Content
moved verbatim from SKILL.md (C6 progressive-disclosure split).

- If the user typed `more`, `show 3`, `pick from rest`, or any phrase
  referencing the lower-ranked candidates AND `parallel_count >= 3`,
  surface a follow-up `AskUserQuestion`. Layout depends on
  `parallel_count`:

  **`parallel_count == 3`** (one lower-ranked candidate):
  ```text
  Question 2: "Which lower-ranked candidate?"

  Options:
  1. **<Third-ranked>** — score …
  2. "Cancel" — none of the above
  3. "Other" — supply your own variant (free-text)
  ```

  **`parallel_count == 4`** (two lower-ranked candidates):
  ```text
  Options:
  1. **<Third-ranked>** — score …
  2. **<Fourth-ranked>** — score …
  3. "Cancel"
  4. "Other" (free-text)
  ```

  **`parallel_count == 5`** (three lower-ranked candidates — exceeds
  the 4-option cap, so split again):
  ```text
  Options:
  1. **<Third-ranked>** — score …
  2. **<Fourth-ranked>** — score …
  3. "Cancel"
  4. "Other — see #2 follow-up below" (typing 'show 5' offers the
     fifth-ranked candidate via a third AskUserQuestion of the same
     shape; typing your own variant is free-text override)
  ```

  Routing on every follow-up question mirrors Question 1: pick a
  candidate → proceed to threshold step; `Cancel` → exit; `Other` →
  free-text override or further pagination.
