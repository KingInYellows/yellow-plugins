# Stacked-PR provider fixtures

Sanitized `claude plugin list --json` snapshots used by
`tests/integration/stack-provider-state.test.ts`.

Each file is a **flat array**, matching the real Claude Code CLI output
shape verified on 2.1.233 (see
`docs/research/2026-08-16-github-native-stacks-vs-graphite.md` §4.3). Every
`id` is `name@marketplace`, a plugin may appear once per scope, and
`project`/`local` rows carry a `projectPath`.

Sanitization: paths are rooted at `/fixture` rather than a real home
directory, timestamps are fixed, and no marketplace other than
`yellow-plugins` appears except where a test needs an unrelated row.

| File | Scenario |
| --- | --- |
| `neither-installed.json` | No provider installed at all |
| `both-installed-graphite-enabled.json` | Both installed, Graphite enabled |
| `both-installed-github-enabled.json` | Both installed, GitHub enabled |
| `both-enabled.json` | Both providers enabled — conflict |
| `none-enabled.json` | Both installed, neither enabled |
| `managed-conflict.json` | GitHub enabled at `managed` scope, Graphite at `user` |
| `foreign-project-scope.json` | Provider rows belonging to a different repository |
