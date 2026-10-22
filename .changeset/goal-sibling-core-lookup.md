---
"yellow-goal": patch
---

Find yellow-core's `lib/validate-fs.sh` in the version-suffixed plugin cache.
`/goal:setup`, `/goal:run-stub` and `/goal:run-real` built the path as
`${CLAUDE_PLUGIN_ROOT}/../yellow-core/...`, which resolves to
`<marketplace>/yellow-goal/yellow-core/` in an installed cache and reported
yellow-core missing even when it was installed. They now resolve it through a
copy of yellow-review's `lib/sibling-plugin.sh`: source-tree sibling, then
yellow-core's active install, then its newest cached version.
