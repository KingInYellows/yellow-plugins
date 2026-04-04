---
"yellow-codex": patch
"yellow-semgrep": patch
"yellow-core": patch
"yellow-browser-test": patch
---

Fix shell portability and reliability in setup scripts. Replace bash-only
version_gte() with POSIX-compatible implementation in install-codex.sh and
install-semgrep.sh. Add fnm/nvm activation before Node version check and guard
against fnm multishell ephemeral npm prefix in install-codex.sh. Fix dashboard
reliability in setup:all by replacing Python heredoc with python3 -c, snapshotting
tool paths to prevent PATH drift, and using find|xargs instead of find|while for
plugin cache detection. Add web-app pre-flight check to browser-test:setup.
