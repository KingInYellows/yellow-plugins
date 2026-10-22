---
"yellow-review": patch
---

resolve-text: an awk program that never ran (gawk exits 1 on a parse error) is now a scan failure instead of clean. Both the credential scan and the `rt_text_clean` mention/URL pass require an END `clean` line before reporting clean, so `check-resolve-text` exits 6 rather than 0.
