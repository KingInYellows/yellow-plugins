---
'yellow-cursor': patch
'yellow-linear': patch
---

Fix three defects in the Cursor delegation surface that survived onto `main`.

`delegate`'s `--max-active` cap could be exceeded: the active-agent sweep
stopped after a fixed page bound and returned the partial count as if it were
the total, so an account with more pages of cloud agents silently undercounted
and a billable launch was authorized past the configured cap. The sweep now
fails closed with `CURSOR_CONCURRENCY_LIMIT` when the listing is still
paginating at the bound. Archived agents remain **in** the concurrency count
whenever their status is still `running`: `/cursor:archive --force` archives an
agent without cancelling its run, so force-archiving hides an agent from the
default listing but never frees a `--max-active` slot. Only the agent's status
gates the count, so archived-and-finished agents cost nothing.

`/cursor:archive` did not actually hide anything: the adapter always requested
archived agents, so they stayed in `/cursor:list` despite the archive and
unarchive command contracts promising the opposite. Archived visibility is now
caller-driven — excluded from the default listing only, and included both for
canonical-id reconciliation (which must still find an agent archived between
`send()` and the sweep) and for the concurrency sweep described above — and
opt-in via `/cursor:list --archived`.

`/linear:delegate`'s launch step consumed shell variables assigned in earlier
Bash calls, which do not persist, and derived `CURSOR_REPO_URL` after the block
that used it. The derivation now precedes the launch and every required value is
asserted non-empty first, so a missing plugin root or empty delegation packet
fails loudly instead of launching a billable agent with no instructions.
