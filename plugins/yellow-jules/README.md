# yellow-jules

Google Jules integration for Claude Code and Codex — **experimental**. Hand a
task to a Jules session, review its plan, answer its questions, and stage what
it produces for local review. Every write happens under a **grant** you create
on your own terminal; sessions are created with plan approval required and
vendor auto-PR off, so nothing runs without an approved plan and nothing is
merged for you.

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

| Command            | What it does                                                                       |
| ------------------ | ---------------------------------------------------------------------------------- |
| `/jules:setup`     | Check the credential and SDK, probe connected sources, install with consent        |
| `/jules:list`      | One page of Jules sessions with a normalized condition                             |
| `/jules:status`    | One session's live state, new activities, pending plan, and outputs; `--reconcile` |
| `/jules:collect`   | Stage a session's patches and generated files for review                           |
| `/jules:delegate`  | Launch a session: dry-run, covering grant, preview, confirm, launch                |
| `/jules:reply`     | Send one message to a session (`--correction` spends a corrective round)           |
| `/jules:approve`   | Re-read the pending plan completely, confirm, approve it once                      |
| `/jules:authorize` | List or revoke grants; prints the terminal command that writes one                 |
| `/jules:abandon`   | Prints the terminal command that gives up an operation whose outcome is unknown    |
| `/jules:supervise` | One bounded supervision pass; at most one reply or approval, never a loop          |

`--session` accepts a local id (`jl-…`, minted the first time the plugin sees a
session) or a vendor `sessions/<id>`.

## Grants

Treat grants as guardrails, not a hard security boundary: they stop accidental
and casual overreach by an agent that uses this plugin's CLI, not a determined
agent running as your user (see Limitations). Keep their scope narrow — one
repository, an exact scratch branch, the task refs you mean, only the operations
you need.

A write needs `--grant-id`. A grant names one repository, a branch (or a branch
prefix ending in `*`), the task refs it covers, a subset of `create`, `reply`,
`approve`, `collect`, limits, and an expiry.

| Limit                    | Default | Ceiling  |
| ------------------------ | ------- | -------- |
| Active sessions          | 1       | 3        |
| Tasks in total           | 3       | 10       |
| Corrective rounds / task | 2       | 3        |
| Lifetime                 | 2 hours | 24 hours |

**Write a grant yourself, in a terminal** — not through Claude Code, and not
through an agent:

```text
node <plugin-dir>/dist/cli.js authorize --repo owner/repo --branch 'scratch/*' \
  --task-ref ENG-123 --operations create,reply,approve,collect --owner you
```

`authorize` opens the terminal, prints the grant and a six-character code, and
writes the grant only when you type the code back. A process with no controlling
terminal — an agent's shell, a sandbox, CI — is refused with
`JULES_CONFIRMATION_REQUIRED`, and the error names the exact command to run.
That refusal is the control: the owner, not the agent, widens what the agent may
do. `/jules:authorize --list` shows grants and what each has used;
`--revoke <grant-id>` ends one immediately.

Expiry and revocation never stop a session that is already running. The error
that follows an expired grant lists the sessions that may still be running and
the containment steps: stop the session in the Jules console, revoke the
repository's source connection, or rotate `JULES_API_KEY`.

## Supervision

`/jules:supervise` runs one pass: it reads the session and returns a single
decision — `no-change`, `check-failed`, `pass-aborted`, `needs-plan-review`,
`needs-answer`, `needs-verification`, `escalate`, or `paused` — with a
`nextCheck` telling you when to run it again. It never loops or sleeps. A pass
may make at most one `reply` or `approve`, under the grant. A user message that
is none of the plugin's own, or a plan that changed under an evaluation,
**pauses** the session until you clear it on your terminal
(`supervise --clear-pause`). Local verification of a finished patch is not
available yet, so a completed session is never accepted automatically.

## Codex

Two host-neutral reference skills, `jules-delegation` and `jules-supervision`,
are exposed to Codex. They describe the CLI and the grant rules; they do not
write grants. Writing a grant is a terminal command on any host.

## Security model

- **Artifact-first.** `collect` writes patches and generated files, byte-exact,
  under the data directory's `artifacts/<local-id>/` only. It never touches a
  checkout, never applies a patch, and treats any vendor pull request as an
  external reference — never adopted, closed, rewritten, or merged.
- **Writes only under a grant**, each one a single request that is never
  retried. A failure after a request was sent is reported as an unknown outcome
  and reconciled with `/jules:status --reconcile` — a launch is never replayed.
  The read-only commands are tested to send no POST, PATCH, PUT, or DELETE.
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
- No live Jules session has been exercised yet; the owner-run smoke test
  (`docs/yellow-jules/smoke-procedure.md`) comes after this release. Response
  shapes are verified only against the SDK's types.
- A grant is stored in `state/grants.json` with owner-only permissions and no
  signature: a process running as your own user can edit it. The terminal code
  stops a caller with no terminal, not one that allocates its own
  pseudo-terminal. Run agents in a sandbox that matches how much you trust them.
- Grants constrain this plugin's CLI, not your Jules credential. An agent whose
  shell holds `JULES_API_KEY` can call the Jules API directly with no grant and
  no terminal. Keep the key out of an agent's environment if that matters to
  you.
- No cancel, pause, resume, or per-session cost: the vendor API does not offer
  them, and the commands say so rather than guessing.
- `/linear:delegate` launches through Jules only under a covering grant; with
  none it prints the terminal command and stops.
- Verifying a finished patch locally and handing it to your branch workflow
  (`integrate`) is not part of this release.

## License

MIT
