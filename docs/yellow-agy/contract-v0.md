# yellow-agy provider CLI contract, version 0 (draft)

Status: draft for review, 2026-10-30. Nothing implements it yet. It replaces
`docs/yellow-jules/contract-v1.md` once yellow-agy ships. Evidence:
`docs/spikes/antigravity-cli-delegate-2026-10.md`.

## Scope

yellow-agy hands one coding task to the Antigravity CLI (`agy`) running on the
owner's own machine, in an isolated git worktree, under the owner's Google AI
Pro sign-in. It keeps yellow-jules' authority model (owner-typed grants,
controller epoch, locked journal) and its verbs, so `/linear:delegate` keeps its
shape. It replaces the vendor session API with local child processes.

Hard rules (tested, not just documented):

- **Subscription auth only.** Every spawn scrubs `GEMINI_API_KEY`,
  `GOOGLE_API_KEY`, `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`,
  `GOOGLE_APPLICATION_CREDENTIALS` and `AGY_ADC_AUTH` from the child env. On the
  WSL bridge the Windows-side scrub isn't enough, because the distro can set
  them itself or `WSLENV` can forward them, so the bridge runs
  `env -u <each var> agy …` inside WSL. `setup` refuses with `AGY_AUTH_MODE` if
  any of them is set in the caller's env or, on the bridge, in
  `wsl.exe -d <distro> -e env`, and with `AGY_OVERAGES` unless the global config
  has `useG1Credits: false`. Every run's `--settings` also forces
  `useG1Credits: false`.
- **Unmodified binary, own sign-in.** The CLI never reads, copies or moves agy
  credential files. It doesn't proxy agy or embed it behind a network listener
  (Antigravity Additional Terms §6).
- **No blanket approval.** `--dangerously-skip-permissions` is never passed.
  Writes are enabled per run with `--mode accept-edits` plus a `--settings`
  allowlist.
- **One live run per controller.** A second `delegate`, `reply` or `approve`
  while a run is live fails with `AGY_BUSY`.
- **agy never pushes.** `git push`, `gh` and any network-reaching command stay
  off every allowlist. `collect` stages patches, and the owner's stack provider
  opens the PR.

## Host bridge

agy may be installed only in WSL. `setup` resolves one invocation and records it
in the data dir:

| Host                       | Invocation                                              | Worktree root                                                            |
| -------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------ |
| Linux / macOS / inside WSL | `agy` on `PATH`                                         | `$XDG_DATA_HOME/yellow-agy/worktrees`                                    |
| Windows with agy in WSL    | `wsl.exe -d <distro> --cd <wsl-path> -e env -u … agy …` | WSL `~/.local/share/yellow-agy/worktrees` (agy trusts only the WSL home) |
| Windows native agy         | `agy.exe`                                               | `%LOCALAPPDATA%\yellow-agy\worktrees`                                    |

The worktree is created where agy runs. On the WSL bridge that means a WSL clone
of the repo, never `/mnt/c`. The bridge always uses `wsl.exe --exec` (`-e`),
never the `--` form, so no shell in the distro re-parses prompts or the
`--settings` JSON. Argv is always an array, and stdin is closed except in
`stream-json` mode (an open question).

## Run lifecycle

1. `delegate` (under a grant with `create`): fetch the base, then
   `git worktree add <root>/<localId> -b <grant branch>`. Run a **plan turn**:
   `agy -p <prompt> --output-format json --json-schema <plan.schema.json> --settings <read-only profile>`,
   with cwd = the worktree. Journal `conversation_id`, the plan, and usage. The
   state becomes `PLAN_PENDING`.
2. `approve` (grant op `approve`): re-read the stored plan and confirm, then run
   an **implement turn**:
   `agy -p "Implement the approved plan" --conversation <id> --mode accept-edits --output-format json --settings <implement profile>`.
   The state becomes `IMPLEMENTED`, or `DENIED` / `TIMED_OUT` / `INTERRUPTED`
   from the classification below.
3. `reply [--correction]`: another `--conversation` turn under the implement
   profile. A correction spends a corrective round (R31 counters, unchanged).
4. `collect`: `git -C <worktree> format-patch <base>..HEAD`, plus `git diff` for
   uncommitted changes, into `artifacts/<localId>/`.
5. `abandon` (terminal-gated): settle the journal, remove the worktree, and keep
   the branch.
6. `status` / `list`: built from the journal and worktree git state. There's no
   vendor polling. `supervise` does at most one `reply` or `approve` per pass,
   the same as today.

## Permission profiles (`--settings` JSON)

Both profiles carry `{"useG1Credits": false}`.

- **read-only:**
  `permissions.allow: ["command(git status)", "command(git diff)", "command(git log)"]`.
  No `--mode accept-edits`.
- **implement:** read-only, plus the repo's own test and lint commands named in
  the grant (`--allow-command`, which `authorize` validates against an allowlist
  pattern), plus `command(git add)` and `command(git commit)`.
  `--mode accept-edits`.

## Result classification

agy's `status` alone isn't trustworthy. Classify in this order:

| Signal                                                                         | Class                                                                             | Exit                                  |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ------------------------------------- |
| process killed by our deadline or SIGTERM, or `finished_reason: "interrupted"` | `INTERRUPTED`                                                                     | 1, `AGY_INTERRUPTED`                  |
| `finished_reason: "print_timeout"` (agy still says SUCCESS / exit 0)           | `TIMED_OUT`                                                                       | 1, `AGY_TIMEOUT`, partial output kept |
| non-empty `denied_actions`                                                     | `DENIED`. Report each denied action, and reply or re-authorize with a wider grant | 0 with `requiresAttention`            |
| `status: "SUCCESS"`, empty `denied_actions`, finished normally                 | `OK`                                                                              | 0                                     |
| exit 3 / `status: "ERROR"`                                                     | `AGY_MODEL_ERROR` (quota exhaustion → `AGY_QUOTA`)                                | 1                                     |
| `authentication required` on stderr                                            | `AGY_AUTH_REQUIRED`. The owner signs in interactively once                        | 1                                     |

`structured_output` is read only from turns that passed `--json-schema`, because
a resumed turn repeats the previous turn's value. `WAITING` never showed up in
the spike, so questions arrive as plain `response` text. `supervise` treats a
response ending in a question as needing a reply.

## Quota gate

Before every model turn, run `agy -p "/usage" --output-format json` (no quota
cost) and refuse with `AGY_QUOTA_LOW` when the relevant bucket is below the
grant's `minQuotaPercent` (default 10). Journal usage before and after each
turn.

## Output envelope, exit codes, error catalog, local state, grants

These are the same as yellow-jules contract-v1 (one JSON object on stdout, exit
0/1/2, `requiresAttention` + `attention`, owner-only data dir, grants written
only by `authorize` on `/dev/tty`, controller epoch). The changes are the
`AGY_*` code prefix, the `YELLOW_AGY_*` env prefix, and a grant that names
`--allow-command` patterns and `minQuotaPercent` instead of vendor sources.

New codes: `AGY_NOT_INSTALLED`, `AGY_VERSION` (below the pinned floor),
`AGY_AUTH_MODE`, `AGY_OVERAGES`, `AGY_AUTH_REQUIRED`, `AGY_BUSY`, `AGY_QUOTA`,
`AGY_QUOTA_LOW`, `AGY_TIMEOUT`, `AGY_INTERRUPTED`, `AGY_DENIED`,
`AGY_MODEL_ERROR`, `AGY_WORKTREE`, `AGY_BRIDGE`.

## Open questions (probe in the adapter PR)

1. Can `--settings` turn off the owner's MCP servers for one run? Every run
   currently starts them (10+ s, and an unpinned `npx` server). If it can't,
   `setup` warns and lists them.
2. Does `--sandbox` do anything under WSL2?
3. What `finished_reason` value marks a normal completion?
4. Is `--input-format stream-json` worth using for multi-turn runs? v0 uses one
   process per turn.

## Non-goals for v0

Running on a remote or always-on host, GitHub-triggered runs, parallel runs, and
any non-subscription auth. Option C in the replacement design (project plans)
covers the host case in its own repo.
