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

Routing is an adapter-phase prerequisite, not part of v0: the delegate
classifier gains `READY_AGY` and accepts `--provider agy`. `READY_JULES` and
`--provider jules` keep working until yellow-jules is removed after 2026-12-31,
and an explicit `--provider` always wins over the classifier.

Hard rules. The spike tested the auth, bridge, permission and containment
behavior; the rules that depended on open questions (MCP, sandbox,
`finished_reason`, settings merge, command matching) are requirements the
adapter verifies, and they fail closed until it does:

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
- **One live run per controller.** Before spawning, a call atomically claims the
  controller's active-run record under the journal lock (see "Reservations,
  retries and recovery"). A second `delegate`, `reply`, `approve`, `collect` or
  `abandon` while a run is live fails with `AGY_BUSY`.
- **agy never pushes.** `git push`, `gh` and any network-reaching command stay
  off every allowlist. Every agy child gets `GIT_CONFIG_COUNT=2`,
  `core.hooksPath=<null device>` (`/dev/null` on POSIX hosts and inside WSL,
  `NUL` for native `agy.exe`) and `core.fsmonitor=false` through
  `GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, so the `git status` and `git commit`
  agy runs fire no repo or global hooks and no fsmonitor command. On the WSL
  bridge they are set inside the distro as `env` arguments, not through
  `WSLENV`. Every spawn drops all other `GIT_*` variables (config overrides and
  repository routing such as `GIT_DIR`), and the bridge unsets them inside the
  distro too. `collect` stages patches, and the owner's stack provider opens the
  PR.
- **No MCP servers in delegated runs.** agy starts every configured MCP server
  on every run, and the command allowlist doesn't govern their tools. A
  delegated run must start with none. agy 1.4.12 has no per-run way to turn them
  off, so `setup` refuses with `AGY_MCP` while any server is enabled; the owner
  can run `agy mcp disable <name>`.
- **No branch code runs outside agy's sandbox.** Test and lint commands execute
  code the task wrote, with the owner's privileges. The implement profile allows
  them only when `--sandbox` is verified to confine files and network on that
  host. Otherwise the profile carries edits plus `git add` / `git commit` only,
  and the owner's CI runs the checks on the PR.

## Host bridge

agy may be on `PATH` (including native `agy.exe` on Windows) or installed only
in WSL. The hard rules apply on every host. `--sandbox` is unverified on native
Windows, so test and lint commands stay off there. `setup` resolves one
invocation and records it in the data dir:

| Host                       | Invocation                                                                                                                                                                                       | Worktree root                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Linux / macOS / inside WSL | `agy` on `PATH`                                                                                                                                                                                  | `${XDG_DATA_HOME:-$HOME/.local/share}/yellow-agy/worktrees`              |
| Windows with agy in WSL    | `wsl.exe -d <distro> --cd <wsl-path> -e env -u … GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=core.hooksPath GIT_CONFIG_VALUE_0=/dev/null GIT_CONFIG_KEY_1=core.fsmonitor GIT_CONFIG_VALUE_1=false agy …` | WSL `~/.local/share/yellow-agy/worktrees` (agy trusts only the WSL home) |
| Windows native agy         | `agy.exe`                                                                                                                                                                                        | `%LOCALAPPDATA%\yellow-agy\worktrees`                                    |

The worktree is created where agy runs. On the WSL bridge that means a WSL clone
of the repo, never `/mnt/c`. The bridge always uses `wsl.exe --exec` (`-e`),
never the `--` form, so no shell in the distro re-parses prompts or the
`--settings` JSON. Argv is always an array, and stdin is closed except in
`stream-json` mode, which v0 doesn't use. Windows caps a command line at 32,767
characters, so on the bridge a prompt whose full argv would exceed 30,000
characters fails with `AGY_PROMPT_TOO_LONG` before anything spawns.

## Run lifecycle

1. `delegate --branch <name>` (under a grant with `create`): the branch is a
   concrete, new name that matches the grant's branch pattern; an existing
   branch fails with `AGY_WORKTREE`. Journal a reservation, fetch the base, then
   `git worktree add -b <name> <root>/<localId> <fetched base commit>`. Run a
   **plan turn**:
   `agy -p <prompt> --output-format json --json-schema <plan.schema.json> --settings <read-only profile>`,
   with cwd = the worktree. Journal `conversation_id`, the plan, and usage. The
   state becomes `PLAN_PENDING`.
2. `approve` (grant op `approve`): re-read the stored plan and confirm, then run
   an **implement turn**:
   `agy -p "Implement the approved plan" --conversation <id> --mode accept-edits --output-format json --settings <implement profile> [--sandbox]`,
   where `--sandbox` is required whenever the profile grants test or lint
   commands (see Permission profiles). Post-approval `reply` turns follow the
   same rule. The state becomes `IMPLEMENTED`, or `DENIED` / `TIMED_OUT` /
   `INTERRUPTED` from the classification below.
3. `reply [--correction]`: another `--conversation` turn. In `PLAN_PENDING` it
   runs under the read-only profile without `--mode accept-edits`, so only
   `approve` can start implementation. After approval it uses the implement
   profile. A correction spends a corrective round (R31 counters, unchanged). A
   `PLAN_PENDING` correction passes `--json-schema <plan.schema.json>` and
   replaces the stored plan, so `approve` implements the corrected plan.
4. `collect` (no live run): `git -C <worktree> format-patch <base>..HEAD` for
   commits, then, in a temporary `GIT_INDEX_FILE` seeded from the real index,
   `git add --intent-to-add --all` and `git diff --binary HEAD`, leaving the
   real index untouched, for staged, unstaged and untracked changes, into
   `artifacts/<localId>/`. Every artifact is scanned with yellow-jules'
   secret-shape layers; a hit sets `secretShapedContent: true` and
   `requiresAttention`, and the owner reviews it before the stack provider opens
   a PR.
5. `abandon` (terminal-gated, no live run): run `collect` first so nothing is
   lost, settle the journal, `git worktree remove --force` the worktree, and
   keep the branch.
6. `status` / `list`: built from the journal and worktree git state. There's no
   vendor polling. `supervise` does at most one `reply` or `approve` per pass,
   the same as today.

## Reservations, retries and recovery

These follow yellow-jules contract-v1's reservation and lock model, adapted to
local processes.

- Every mutating call takes `--request-id` (generated when absent) and journals
  a reservation under the journal lock before it creates a worktree or spawns
  agy. The reservation holds the active-run claim: request id, operation, child
  pid, the worktree `HEAD` before the turn, and a pre-turn snapshot commit. The
  adapter builds the snapshot with a temporary index (`GIT_INDEX_FILE`) seeded
  from a copy of the real index, so tracked files that match `.gitignore` stay
  in it. It then runs `git add --all`, `git write-tree` and `git commit-tree`,
  and stores the result under `refs/yellow-agy/<localId>/pre-turn`, so
  uncommitted and untracked work from earlier turns is captured without touching
  the branch or the real index. Before that, `git write-tree` on the real index
  saves the staged state as `refs/yellow-agy/<localId>/pre-turn-index`. Ignored
  untracked files (build output, `.env`) are not captured and sit outside the
  reset guarantee. `git clean -fd` leaves them alone, but `git reset --hard` or
  `read-tree -u` can delete one that obstructs a tracked path, so reset first
  checks for ignored paths that collide with a path in the pre-turn `HEAD` or
  the snapshot, and refuses with `AGY_WORKTREE` when it finds any.
- A retry with a request id whose operation already finished returns the
  recorded outcome and spawns nothing.
- A claim whose pid is dead is stale. The next call settles it before doing
  anything else. A `delegate` reservation with no `conversation_id` is released:
  its worktree is removed, and its branch is deleted if it has no commits beyond
  the base. A turn reservation is settled as `INTERRUPTED`.
- After `INTERRUPTED` or `TIMED_OUT`, the worktree may hold partial edits. The
  next `approve` or `reply` refuses with `requiresAttention` until the owner
  passes `--keep-partial` (continue on top of them) or `--reset-partial`. Reset
  runs `git reset --hard <pre-turn HEAD>` and `git clean -fd`, then restores the
  snapshot with `git read-tree --reset -u <snapshot>` followed by the index-only
  `git read-tree <pre-turn-index>`, so work from earlier turns, deletions
  included, comes back with its staged and unstaged parts as they were. Both
  refs are deleted once the reset or the next turn settles.

## Permission profiles (`--settings` JSON)

Both profiles pin every top-level key that can widen a run, because agy overlays
`--settings` on the global config per top-level key: a key the run gives
replaces the global key wholesale, and a key it leaves out leaks through (probed
2026-11 on agy 1.4.12). The pinned keys are `useG1Credits: false`,
`allowNonWorkspaceAccess: false`, `toolPermission` (default `request-review`,
never `always-proceed`), `agentMode`, `enableTerminalSandbox` and `permissions`.
The profiles accept only `request-review`, `strict` and `proceed-in-sandbox`;
each of these runs headless: a call the profile doesn't allow is soft-denied at
once and shows up in `denied_actions`. A per-run `agentMode: ""` overrides a
global `accept-edits`, and `--mode` beats both, so the profile alone keeps a
plan turn from editing. `setup` still refuses a loose global `agentMode` as
defense in depth.

- **read-only:** `permissions.allow: ["command(git status)"]`, `agentMode: ""`,
  `enableTerminalSandbox: false`. No `--mode accept-edits`. `git diff` and
  `git log` are left out: a rule matches any trailing arguments, and their
  `--output=<file>` writes a file anywhere even with edits off.
- **implement:** read-only, plus `command(git add)` and `command(git commit)`,
  with `agentMode: "accept-edits"` and `--mode accept-edits`. A `command(...)`
  rule is a prefix match: it matches any arguments after its words, so no
  `regex:` rules are needed, and every grant has to be safe with any trailing
  arguments. The repo's own test and lint commands named in the grant
  (`--allow-command`, which `authorize` validates: plain words, a first word
  from a fixed list of test, lint and build tools with no path or `.exe`-style
  suffix, so no wrappers such as `env` or `timeout`; a package or build tool
  only with a test, lint or build subcommand, or `run <script>` for npm, pnpm,
  yarn and bun) are added only on a host where `--sandbox` is verified (hard
  rules). Such a profile sets `enableTerminalSandbox: true` and every turn that
  uses it also passes `--sandbox`; without granted commands it keeps
  `enableTerminalSandbox: false` and no `--sandbox`. The adapter refuses any
  profile where the two disagree.
- **Unverified:** whether agy runs a matched command through a shell, so that
  `$(…)`, backticks or `>` in the trailing arguments of an allowed rule (such as
  `git status $(…)`) would execute or write. The 2026-11 probe covered only `&&`
  chaining with every part granted, and not a chain with an ungranted part. Both
  are probed before the first real delegated run.
- **Git config every agy child sees** (`GIT_CONFIG_COUNT`/`KEY_n`/`VALUE_n`):
  `core.hooksPath=<null device>`, `core.fsmonitor=false`, and, for each filter
  driver the repo's effective config defines (the caller passes the names),
  `filter.<name>.clean`, `.smudge` and `.process` set to empty and
  `filter.<name>.required=false`, so no hook, fsmonitor or filter command runs
  during the allowed `git status`, `git add` and `git commit`.

## Result classification

agy's `status` alone isn't trustworthy. Classify in this order:

| Signal                                                                                                  | Class                                                                             | Exit                                  |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------- |
| process killed by our deadline, or `finished_reason: "print_timeout"` (agy still says SUCCESS / exit 0) | `TIMED_OUT`                                                                       | 1, `AGY_TIMEOUT`, partial output kept |
| owner cancel / SIGTERM, or `finished_reason: "interrupted"`                                             | `INTERRUPTED`                                                                     | 1, `AGY_INTERRUPTED`                  |
| non-empty `denied_actions`                                                                              | `DENIED`. Report each denied action, and reply or re-authorize with a wider grant | 0 with `requiresAttention`            |
| `status: "SUCCESS"`, empty `denied_actions`, `finished_reason` absent (agy 1.4.12's normal finish)      | `OK`                                                                              | 0                                     |
| `status: "SUCCESS"`, empty `denied_actions`, `finished_reason` present but unrecognized                 | Not `OK`. Report with partial output kept                                         | 0 with `requiresAttention`            |
| `authentication required` on stderr                                                                     | `AGY_AUTH_REQUIRED`. The owner signs in interactively once                        | 1                                     |
| exit 3 / `status: "ERROR"`, no auth message                                                             | `AGY_MODEL_ERROR` (quota text on stderr → `AGY_QUOTA`)                            | 1                                     |

A Not `OK` turn (`SUCCESS` with an unrecognized `finished_reason`) is still a
settled turn. It settles its reservation as completed, journaling the usage and
the observed `finished_reason`, and releases the active-run claim. The task
keeps the stored `conversation_id` and advances as it would after `OK`: a plan
turn moves to `PLAN_PENDING` and an implement turn to `IMPLEMENTED`. The result
carries `requiresAttention`, so the owner reviews the output before approving or
opening a PR.

A turn that ends in `AGY_AUTH_REQUIRED`, `AGY_MODEL_ERROR` or `AGY_QUOTA`
settles its reservation as terminal, journaling the code and any usage, and
releases the active-run claim. The task keeps its pre-turn state (`PLAN_PENDING`
stays `PLAN_PENDING`, `IMPLEMENTED` stays `IMPLEMENTED`). A failed `delegate`
plan turn moves the task to `FAILED`, keeping the worktree and branch for
`abandon`. Edits a failed implement turn left behind go through `--keep-partial`
/ `--reset-partial`, like `INTERRUPTED`. A retry needs a new `--request-id`; the
same id returns the recorded failure. For `delegate`, the quota gate runs before
the worktree is created, so a refusal leaves no worktree or branch behind. The
quota gate's `AGY_QUOTA_LOW` and `AGY_QUOTA_UNKNOWN` refuse before spawning, so
they release the reservation with no turn and no state change. No quota is
reserved ahead: the failed turn's journaled usage counts toward the gate's
15-minute window.

`structured_output` is read only from turns that passed `--json-schema`, because
a resumed turn repeats the previous turn's value. `WAITING` never showed up in
the spike, so questions arrive as plain `response` text. `supervise` never
replies on a heuristic: an implement turn's prompt asks agy to end with a line
`NEEDS_INPUT: <question>` when it is blocked, and only that line marks the run
as needing a reply. Any other response is reported as is.

## Quota gate

Before every model turn, run `agy -p "/usage" --output-format json` (no quota
cost) with the same per-run `--settings` profile as the turn it guards. `/usage`
runs in print mode without a model call and returns machine-readable remaining
fractions per model bucket. `/usage` updates late, so the gate subtracts the
journaled cost of turns from the last 15 minutes (or 2% per turn when a turn's
cost is unknown) from the reported bucket. It refuses with `AGY_QUOTA_LOW` when
the result is below the grant's `minQuotaPercent` (default 10), and with
`AGY_QUOTA_UNKNOWN` when `/usage` fails or can't be parsed. Journal usage before
and after each turn.

## Output envelope, exit codes, error catalog, local state, grants

These are the same as yellow-jules contract-v1 (one JSON object on stdout, exit
0/1/2, `requiresAttention` + `attention`, owner-only data dir, grants written
only by `authorize` on `/dev/tty`, controller epoch). The changes are the
`AGY_*` code prefix, the `YELLOW_AGY_*` env prefix, and a grant that names
`--allow-command` patterns and `minQuotaPercent` instead of vendor sources.

New codes: `AGY_NOT_INSTALLED`, `AGY_VERSION` (below the pinned floor),
`AGY_AUTH_MODE`, `AGY_OVERAGES`, `AGY_AUTH_REQUIRED`, `AGY_BUSY`, `AGY_QUOTA`,
`AGY_QUOTA_LOW`, `AGY_TIMEOUT`, `AGY_INTERRUPTED`, `AGY_DENIED`,
`AGY_MODEL_ERROR`, `AGY_WORKTREE`, `AGY_BRIDGE`, `AGY_MCP`,
`AGY_PROMPT_TOO_LONG`, `AGY_QUOTA_UNKNOWN`, `AGY_SETTINGS`.

## Probe answers (2026-11, agy 1.4.12 under WSL2)

The adapter probe answered five of the six open questions; the run sheet is
`docs/spikes/antigravity-cli-adapter-probe-2026-11.md`.

1. **MCP:** `--settings` rejects the MCP keys as unknown and no flag turns MCP
   off for one run. The only switch is the global `agy mcp disable <name>`, so
   `setup` refuses with `AGY_MCP` while `agy mcp list` shows an enabled server.
   Disabling is the owner's call; the adapter never changes it.
2. **Sandbox: still open.** bwrap works under WSL2, but the probe was
   inconclusive. Until it is shown to confine files and network, the implement
   profile allows no test or lint commands (hard rules).
3. **`finished_reason`:** absent on a normal finish. Present values seen are
   `print_timeout` and `interrupted`; any other value stays Not `OK`.
4. **`--input-format stream-json`:** exists (one message per stdin line, needs
   `--output-format stream-json`). v0 keeps one process per turn.
5. **Settings merge:** per top-level key (see Permission profiles). Each probed
   `toolPermission` value runs headless; `agentMode` accepts `accept-edits`,
   `plan`, `auto` and `""`.
6. **Command matching:** `command(<words>)` matches extra arguments. A chain
   whose parts were all granted ran; denial of a chain with an ungranted part,
   and shell expansion in trailing arguments, are still unverified.

## Non-goals for v0

Running on a remote or always-on host, GitHub-triggered runs, parallel runs, and
any non-subscription auth. Option C in the replacement design (project plans)
covers the host case in its own repo.
