# yellow-jules

Google Jules integration for Claude Code — **experimental**. Observe Jules
remote-agent sessions and stage what they produce for local review. This release
is read-only: it lists sessions, reports their state, and collects their
artifacts. Starting, replying to, or approving Jules sessions from Claude Code
is not available yet.

yellow-jules is one of three providers in the `remote-agent` group, alongside
yellow-cursor (preferred) and yellow-devin. Enable at most one of them.

## Install

```text
/plugin marketplace add KingInYellows/yellow-plugins
/plugin install yellow-jules@yellow-plugins
```

Then run `/jules:setup`.

## Prerequisites

- **`JULES_API_KEY`** exported in your shell environment. Credentials are never
  read from command arguments and never printed; `/jules:setup` reports only
  whether the key is present.
- **The Jules SDK** (`@google/jules-sdk@0.2.0`). `/jules:setup` asks before
  installing it into the plugin's data directory with `npm ci --ignore-scripts`
  from a lockfile shipped with the plugin, so every package is integrity-checked
  and no install script runs.
- **`node`** 22.22 or later, and **`jq`**.
- A GitHub repository connected to Jules — sources are discovered, never created
  by this plugin.

## Commands

| Command          | What it does                                                                |
| ---------------- | --------------------------------------------------------------------------- |
| `/jules:setup`   | Check the credential and SDK, probe connected sources, install with consent |
| `/jules:list`    | One page of Jules sessions with a normalized condition                      |
| `/jules:status`  | One session's live state, new activities, pending plan, and outputs         |
| `/jules:collect` | Stage a session's patches and generated files for review                    |

`--session` accepts a local id (`jl-…`, minted the first time the plugin sees a
session) or a vendor `sessions/<id>`.

## Security model

- **Artifact-first.** `collect` writes patches and generated files, byte-exact,
  under the data directory's `artifacts/<local-id>/` only. It never touches a
  checkout, never applies a patch, and treats any vendor pull request as an
  external reference — never adopted, closed, rewritten, or merged.
- **No writes to Jules** in this release. Every shipped command is a read; a
  test asserts none of them sends a POST, PATCH, PUT, or DELETE.
- **Pinned network surface.** Requests go only to
  `https://jules.googleapis.com`; redirects are refused, so the API key can
  never be forwarded to another host.
- **Local state** lives in `$YELLOW_JULES_DATA_DIR`, else
  `$XDG_DATA_HOME/yellow-jules`, else `~/.local/share/yellow-jules`
  (`~/Library/Application Support/yellow-jules` on macOS), owner-only, never
  inside a git work tree or the plugin directory.
- **Redaction** on every output path: the live key, auth headers, and common key
  shapes are masked; vendor text is shown fenced as untrusted; staged files
  containing secret-shaped strings are flagged, not altered.

## Limitations

- Experimental: the Jules API is `v1alpha`, and `@google/jules-sdk` states it is
  "not an officially supported Google product".
- No live Jules session has been exercised yet; the owner-run smoke test is
  scheduled after delegation ships. Response shapes are verified only against
  the SDK's types.
- No cancel, pause, resume, or per-session cost: the vendor API does not offer
  them, and the commands say so rather than guessing.
- `/linear:delegate` recognizes Jules as a provider but stops with an
  explanation until Jules delegation ships.

## License

MIT
