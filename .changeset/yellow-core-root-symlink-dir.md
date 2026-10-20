---
"yellow-core": patch
---

The stack library lookup also rejects a plugin root that is a symlink, has a symlinked `lib/` directory, is relative, or contains a `.` or `..` component, so none of these can point it at repository-controlled JavaScript.
