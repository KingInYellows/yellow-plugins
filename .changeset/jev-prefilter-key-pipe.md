---
'yellow-core': patch
---

The Jev shadow pre-filter now hands `TYPESAFE_API_KEY` to curl through a
process substitution instead of a here-document, so the key stays off disk on
bash before 5.1 (including macOS `/bin/bash` 3.2), which backs here-documents
with a temp file.
The key also stays out of bash xtrace output.
