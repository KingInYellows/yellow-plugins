---
'yellow-review': patch
---

Close the remaining #952 resolver-hardening findings: `run-verify-command`
refuses repository-local git filter drivers (stock Git LFS allowed, judged
on the NUL-delimited config so a multi-line value cannot hide a second
command; `commit-resolve-fixes` reads its filter check the same way), forces
`core.fsmonitor` off on its rollback status and `check-ignore`, keeps a
listed FIFO, socket or device in place until the recovery patch is saved,
and requires `--ignored-since` for every verify run, attended or not;
`commit-resolve-fixes` judges `gt` and `node` by their canonical file, so an
outside-repository symlink to an in-repo executable is refused.
`commit-resolve-fixes` also ends a URL host at `?`, `#` or `\` as well as at
`/` and `:` (as git does), so `https://host#@github.com/...` is `host`, and
refuses a push URL containing any of them. The commit scanner, verify-log
redactor and final log scan catch `DEVIN_ORG_ID` in JSON and YAML form
(`"DEVIN_ORG_ID": "<value>"`), in lowercase and with `-` separators.
