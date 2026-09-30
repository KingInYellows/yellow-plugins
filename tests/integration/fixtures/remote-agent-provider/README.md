# Remote-agent provider fixtures

Sanitized `claude plugin list --json` snapshots used by
`tests/integration/remote-agent-provider-state.test.ts`. Same shape and
sanitization convention as `../stack-provider/README.md`: a flat array, `id` is
`name@marketplace`, paths rooted at `/fixture`, fixed timestamps.

| File                                 | Scenario                                          |
| ------------------------------------ | ------------------------------------------------- |
| `neither-installed.json`             | No provider installed at all                      |
| `both-installed-cursor-enabled.json` | Both installed, yellow-cursor enabled             |
| `both-installed-devin-enabled.json`  | Both installed, yellow-devin enabled              |
| `both-enabled.json`                  | Both providers enabled — conflict                 |
| `none-enabled.json`                  | Both installed, neither enabled                   |
| `foreign-project-scope.json`         | Provider rows belonging to a different repository |
| `jules-enabled.json`                 | Only yellow-jules installed, enabled              |
| `three-installed-jules-enabled.json` | All three installed, yellow-jules enabled         |
| `cursor-and-jules-enabled.json`      | yellow-cursor and yellow-jules enabled — conflict |
| `three-enabled.json`                 | All three providers enabled — conflict            |
| `foreign-project-jules.json`         | Another repository's enabled yellow-jules row     |
