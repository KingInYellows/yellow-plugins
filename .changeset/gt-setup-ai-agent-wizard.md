---
"gt-workflow": minor
"yellow-core": patch
---

Expand `/gt-setup` from validation-only into a 3-phase AI agent configuration
wizard: prerequisite validation, guided Graphite CLI settings (branch prefix,
pager, dates, submit body), and convention file + PR template generation.
Update consumer commands (`/smart-submit`, `/gt-amend`, `/gt-stack-plan`) to
read `.graphite.yml` for repo-level behavior overrides. Add `.graphite.yml`
and PR template checks to `/setup:all` dashboard.
