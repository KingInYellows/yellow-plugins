---
'yellow-council': patch
---

Propagate the redaction fixes to council.md and close the synthesis handoff gap

`council.md` carries two more copies of the credential-redaction awk program
(Step 4's `local redact_awk` and Step 7's fenced-file pass). Both now carry
the same four bypass fixes as the reviewer agents and the canonical skill —
five sites in total, which the drift test now enumerates rather than assumes.

Also closes the sanitized-field handoff: Step 4 redacted claude's summary and
findings into Bash associative arrays, but every Bash block runs in its own
subprocess, so those values were gone by the time Step 5 synthesized. Step 5
had nothing sanitized to read and would fall back to the raw Task return in
model context, bypassing the redaction entirely. Step 4 now redacts the
persisted fenced file in place (failing closed by truncating if the pass
errors), and Step 5 states that reviewer text must be read from that file
rather than from the Task return.
