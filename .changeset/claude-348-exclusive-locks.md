---
'yellow-core': patch
'yellow-morph': patch
'yellow-ruvector': patch
'yellow-review': patch
---

Keep the remaining directory locks exclusive on Ubuntu 26.04, whose uutils
`mkdir` can tell several racing callers they created the same directory
(CLAUDE-348).

- yellow-core: the compound-staging drain lock and the Stop capture lock are
  held by whoever creates `<lock>/.owner` exclusively (`cs_lock_take`), and are
  released by renaming them aside first (`cs_lock_drop`). The `/setup:all`
  ruvector probe caps what it and any process it leaves behind can write at 2 MiB, and still probes when `TMPDIR` is unusable.
- yellow-morph and yellow-ruvector: the install locks, the ruvector model lock
  and its reclaim markers are claimed by an exclusive create of their `pid` or
  `.owner` file. A waiter reclaims a morph lock with an empty or invalid `pid`
  only when it is unchanged a second later, so an owner between its create and
  its write keeps the lock. The morph timeout hint now says `rm -rf`, since a
  held lock always contains its `pid` file.
- yellow-ruvector co-edit locks: a lock whose `.owner` could not be created is
  removed at once, and an expired reclaim marker is renamed aside whole.
- yellow-review: the ignored-file guard skips the empty `.owner` files of
  yellow-ruvector's co-edit lock and reclaim markers, which otherwise made
  `run-verify-command` refuse while a co-edit lock or marker existed.
