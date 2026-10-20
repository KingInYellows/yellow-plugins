---
"yellow-core": patch
---

The stack library lookup also rejects a plugin root, or its `lib/` directory, that is a symlink, so a link cannot point it at repository-controlled JavaScript.
