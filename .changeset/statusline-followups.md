---
"yellow-core": patch
---

Document the statusline in the README: the installed copy does not update with
the plugin, so re-run `/statusline:setup` after an upgrade, and check the
installed version with `grep STATUSLINE_VERSION`. `/statusline:setup` now reads
the reported version from the installed script instead of a hard-coded 1.0.0.
