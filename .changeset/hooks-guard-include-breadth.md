---
'yellow-review': patch
---

The `.git/hooks` guard no longer refuses a config with more than 64 includes:
`rp_config_paths` now reads each real config file's includes once instead of
capping the walk, which still ends on a self-include spelled differently each
pass (CLAUDE-184).
