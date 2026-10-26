---
'yellow-review': patch
---

Make the `poll-new-threads` bats suite deterministic. Its tests asserted exact
sleep lengths while the script measured real `date +%s` time, so a second
ticking over on a slow runner shortened a sleep (`10` became `9`). `setup()` now
stubs a frozen `date`; the wall-clock tests keep their own fake clock.
