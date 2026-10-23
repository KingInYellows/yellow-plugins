---
'yellow-ruvector': patch
---

Skip the co-edit bats case that starts two background edits a fixed 20ms
apart and then requires the later path to be the session's last file. On
a busy runner the later edit can finish first, and the earlier one then
overwrites that path. The synchronous busy-store case still checks that a
held store lock drops one increment and keeps the session's latest path.
