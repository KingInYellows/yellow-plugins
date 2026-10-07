# Phase 5 private/local distribution decisions

The repository and .agents/plugins/marketplace.json remain the only source of
truth. The canonical distribution document provides pinned WSL install/list
commands and per-plugin same-version cache refresh after regeneration.
cache-refresh.json records actual disposable 0.157.0 behavior: repeated add and
remove/add both replaced installed skill bytes after a staged source edit. No
owner profile was changed. Hook trust is separate from install/refresh.

Windows desktop setup is documented separately. WSL HOME/CODEX_HOME, native
tools, login and cache do not establish desktop state. No desktop install,
activation or trust was tested. Native Windows execution must be validated in
its own selected profile; no repository mirroring was introduced.

Conditional decisions under the user's defaults:

- Public publication: deliberately deferred; no submission or publication.
- Portable root plugin.json: not applicable, no demonstrated package need.
- Separate generated distribution repository: not applicable, no access or
  release constraint demonstrated.
- A staged Codex-only marketplace was used solely for candidate acceptance, with
  selected skills and existing tracked runtime resources. It is not a new
  distribution source or a root manifest in the source plugins.

These are completed local decisions, not release actions or unresolved blockers.
No commits, pushes, PR operations, history rewrite, owner installation/trust,
credential copy/change, production mutation or service restart occurred.
