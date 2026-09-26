# summarize-log

Throwaway fixture for review-ledger task 6.5a (manual SessionStart check).
This draft PR is never merged.

`summarize-log.sh <logfile> [max_lines]` prints how many of the last
`max_lines` lines contain `ERROR`, `WARN` and `INFO`.

- `max_lines` defaults to 50.
- `max_lines` must be a positive integer; the script rejects anything else
  with exit code 2.
- Level matching is case-insensitive.
