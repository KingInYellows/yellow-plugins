---
'yellow-review': patch
---

Close the remaining #952 resolver-hardening findings: `run-verify-command`
refuses repository-local git filter drivers (stock Git LFS allowed), forces
`core.fsmonitor` off on its rollback status and `check-ignore`, keeps a
listed FIFO, socket or device in place until the recovery patch is saved,
and requires `--ignored-since` for every verify run, attended or not;
`commit-resolve-fixes` judges `gt` and `node` by their canonical file, so an
outside-repository symlink to an in-repo executable is refused.
