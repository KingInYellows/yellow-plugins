---
'yellow-ruvector': patch
---

Skip the flaky SessionStart check that an old co-edit cursor temp is swept.
The assertion can fire before that temp is removed, which failed advisory
shell CI on an unchanged tree.
