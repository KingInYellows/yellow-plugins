# Security Documentation

## MCP Servers Inventory

All remote MCP servers used by plugins in this marketplace. Review before
enterprise deployment.

| Plugin          | Server Key | Endpoint                                         | Transport | Auth                        | Data Sent                     |
| --------------- | ---------- | ------------------------------------------------ | --------- | --------------------------- | ----------------------------- |
| yellow-core     | context7   | `https://mcp.context7.com/mcp`                   | HTTP      | None                        | Library names, search queries |
| yellow-linear   | linear     | `https://mcp.linear.app/mcp`                     | HTTP      | OAuth (browser popup)       | Issue data, team info         |
| yellow-composio | composio-server | `https://connect.composio.dev/mcp`          | HTTP      | OAuth (browser); headless consumer key is plaintext | Connected-app tool calls |
| yellow-research | deepwiki   | `https://mcp.deepwiki.com/mcp`                   | HTTP      | None                        | Repo names, search queries    |
| yellow-devin    | devin      | `https://mcp.devin.ai/mcp`                       | HTTP      | TBD (may require API token) | Code, task prompts            |
| yellow-ruvector | ruvector   | Local stdio (`bin/start-ruvector.sh` → plugin-managed `ruvector@0.3.3 mcp start`) | stdio     | None (local)                | Code embeddings (local only)  |

The `ruvector` stdio server is network-free once the plugin-managed install
exists in the plugin data dir and the ONNX model is cached. The first session
fetches the pinned package tree from the npm registry (`npm ci` against the
plugin's committed `package-lock.json`, see
[Local npm Dependencies](#local-npm-dependencies)) and the first model load
downloads all-MiniLM-L6-v2 from huggingface.co. The SessionStart prewarm hook
does both in the background; `/ruvector:setup` does them in the foreground.

### Plugins Without MCP Servers

- **gt-workflow** — Pure CLI wrapper for Graphite, no network calls
- **yellow-review** — Uses `gh` CLI (GitHub CLI) for GraphQL API calls, not MCP
- **yellow-browser-test** — Uses `agent-browser` CLI locally, no MCP
- **yellow-debt** — Pure local analysis, no network calls
- **yellow-council** — Ships no MCP server. Three of its four reviewers are
  shelled-out CLIs (`agy`, `opencode`, and Codex reused from yellow-codex); the
  fourth, `claude-reviewer`, runs in-process with no subprocess at all and holds
  a narrowly-scoped `Write` grant (see "In-Process Reviewer" below)

## Setting Up Authentication

Plugins use three authentication patterns. No `.env` files are needed — Claude
Code handles credentials natively through OAuth and shell environment variables.

### OAuth servers (yellow-linear, yellow-composio)

These plugins use browser-based OAuth managed entirely by Claude Code:

1. On first MCP tool call, or from `/mcp` → Authenticate, Claude Code opens
   a browser login
2. Authenticate with the provider (Linear, or Composio at
   `https://connect.composio.dev/mcp`)
3. Token is stored securely in your operating system's credential manager (macOS
   Keychain, Windows Credential Manager, or libsecret on Linux)
4. To re-authenticate or revoke access: run `/mcp` → select server → "Clear
   authentication"

No API keys in the plugin manifest. Will not work in headless SSH sessions
(browser required for OAuth flow). A headless Composio host can instead
register a user-level server with a For You consumer key; that stores the
key in plaintext in `~/.claude.json`. See `/composio:setup`.

### API token servers (yellow-devin)

yellow-devin commands require two environment variables (V3 API / service user):

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export DEVIN_SERVICE_USER_TOKEN="cog_your_token_here"  # Enterprise Settings > Service Users
export DEVIN_ORG_ID="your_org_id"                      # Enterprise Settings > Organizations
```

Never commit tokens to version control. The `.gitignore` already excludes `.env`
files if you use one locally.

### API key CLI (yellow-jules)

yellow-jules has no MCP server. Its typed CLI reads one environment variable:

```bash
# Add to your shell profile (~/.zshrc, ~/.bashrc, etc.)
export JULES_API_KEY="your_key_here"
```

`/jules:setup` reports only whether the key is present; it never prints it.

### No-auth servers (yellow-core, yellow-ruvector, yellow-research deepwiki)

These servers require no configuration. They work immediately after plugin
installation:

- **context7** (yellow-core) — public library documentation endpoint
- **ruvector** (yellow-ruvector) — local stdio server, no auth configuration
  (on first use its launcher, `bin/start-ruvector.sh`, installs the pinned
  ruvector from the npm registry and downloads the ONNX model — see
  [MCP Servers Inventory](#mcp-servers-inventory) above)
- **deepwiki** (yellow-research) — public repository documentation endpoint

### CLI keyring auth (yellow-council)

yellow-council's Gemini-lineage reviewer shells out to the Antigravity CLI
(`agy`) rather than an MCP server, so it doesn't fit the three patterns above:

1. `agy`'s first interactive run migrates any existing Gemini CLI OAuth session
   tokens into the OS keyring (per Google's documentation) — Google retired
   Gemini CLI for consumer subscription tiers on 2026-06-18, and `agy` is the
   replacement
2. No API key or environment variable is configured by or read from plugin code;
   auth is subscription-based (Google AI Pro/Ultra or the free individual tier),
   same as the CLI it replaces
3. `council:setup` does not verify authentication — run bare `agy` once before
   the first `/council` invocation so interactive onboarding completes (trust +
   token migration; `-p` is explicitly noninteractive and does not perform
   onboarding), then optionally `agy -p "test"` to confirm headless auth works
4. Credential lifecycle (re-auth, revocation) is entirely `agy`'s own; this repo
   provides no revoke path and does not manage the keyring entry

See [Trust Boundaries](#trust-boundaries) below for the containment posture
around `agy` having no read-only mode.

## Enterprise Rollout Recommendations

### MCP Allowlisting

For managed Claude Code deployments, allowlist only the MCP endpoints your team
uses:

```
mcp.linear.app       — yellow-linear (issue management)
mcp.context7.com     — yellow-core (library documentation)
mcp.deepwiki.com     — yellow-research (public repo docs)
mcp.devin.ai         — yellow-devin (Devin orchestration)
connect.composio.dev — yellow-composio (connected-app tools)
```

### Selective Plugin Installation

Install only plugins your team needs. Each plugin is independent:

```bash
# Install only Linear integration
claude plugin add kinginyellow/yellow-plugins --plugin yellow-linear

# Install core toolkit without MCP dependencies
claude plugin add kinginyellow/yellow-plugins --plugin gt-workflow
```

### Network-Free Plugins

These plugins work entirely offline with no external network calls:

- `gt-workflow` — Graphite CLI wrapper
- `yellow-debt` — Local codebase analysis
- `yellow-ruvector` — Local vector search (stdio MCP, no network at runtime).
  Exceptions: the first install (npm registry) and the first ONNX model load
  (huggingface.co); see "Local npm Dependencies" below. Offline with a fresh
  store and no cached model, the launcher starts the server without
  `hooks_remember` so the store is not stamped with the hash embedder.

## Hook Safety

### Plugins with Hooks

Ten plugins execute hooks — yellow-ruvector, yellow-debt, yellow-core,
yellow-morph, yellow-research, yellow-semgrep, and yellow-review are shell;
yellow-ci, gt-workflow, and github-workflow run a dependency-free Node
runtime (only one of gt-workflow / github-workflow is enabled at a time):

| Plugin          | Hook Events                                       | Purpose                                                                                  |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| yellow-ruvector | PreToolUse, PostToolUse, SessionStart             | Install prewarm, memory recall, co-edit tracking                                         |
| yellow-ci       | SessionStart                                      | Check for recent CI failures (Node runtime, cached, 3s budget)                           |
| yellow-debt     | SessionStart                                      | Remind about high/critical debt findings                                                 |
| gt-workflow     | PreToolUse, PostToolUse                           | Block `git push`, validate commit messages                                               |
| github-workflow | PreToolUse, PostToolUse                           | Block `git push`, validate commit messages (same Node entrypoint as gt-workflow)         |
| yellow-core     | SessionStart, Stop, PreCompact                    | Staging-queue drain; transcript-tail capture; compaction-preservation instruction        |
| yellow-morph    | SessionStart                                      | Pre-warm `@morphllm/morphmcp` install for fast first tool call                           |
| yellow-research | SessionStart                                      | Pre-warm context7 docs cache; emit `credential-status.json` for `/setup:all`             |
| yellow-semgrep  | SessionStart                                      | Emit `credential-status.json` for `/setup:all`                                           |
| yellow-review   | SessionStart                                      | Report pending review-ledger findings (counts and PR numbers only)                       |

**yellow-ci SessionStart (Node port).** Ported from `session-start.sh` to a
dependency-free Node runtime (`hooks/scripts/`); byte/semantic parity is gated
by `tests/hook-parity.bats`. It is **fail-open** — always emits valid
`{"continue": true}` JSON and never blocks startup. Runtime cache writes were
relocated to a plugin-data dir
(`${CLAUDE_PLUGIN_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/yellow-ci}`) with a
read-only fallback to the legacy `${HOME}/.cache/yellow-ci`. The hook is carried
into the generated Codex manifest (`hooks/codex-hooks.json`) but is **inert on
Codex** — `plugin_hooks` is `removed` on codex-cli 0.144.x — so its Codex-side
behavior is schema/unit/parity-tested, not live-verified.

**yellow-review SessionStart.** `hooks/scripts/session-start.sh` reads the
review-findings ledger's `<pr>.pending` and `<pr>.state` sidecars under
`$(git rev-parse --git-common-dir)/yellow-review/findings/`, a directory
shared by every worktree of the clone and written only by
`lib/review-ledger.sh`. The ledger holds model-authored finding text derived
from untrusted PR content, so the hook never emits it: `systemMessage` and
`additionalContext` carry integers and PR numbers only. It is read-only (no
network, no writes), takes each ledger lock shared with a 0.2 s wait, caps
its fallback fold at 1.5 s, stops starting new PRs at a single 2.3 s overall
deadline inside the 3 s catalog timeout, and always exits with valid
`{"continue": true}` JSON, so a busy or corrupt ledger can block nothing. It is not carried into the Codex or Cursor manifests.

**yellow-core PreCompact.** `hooks/scripts/pre-compact.sh` prints a plain-text
compaction-preservation instruction that Claude Code appends to the compaction
prompt. It is read-only — no network, no file writes — and always exits 0, so
it can never block a compaction (exit 2 would). The instruction requires
every preserved item (plan tasks, modified files, user decisions, open
questions, failing-command output, branch/PR names) to have detected secrets
replaced with `--- redacted credential at line N ---` and then be wrapped in
the untrusted-content fence, so neither credentials nor instruction-like text
can re-enter as trusted context after compaction.

### yellow-ruvector Hooks (detailed)

yellow-ruvector has the most hooks. Its shell scripts:

| Hook               | Event            | Script                  | Time Budget | What It Does                                           |
| ------------------ | ---------------- | ----------------------- | ----------- | ------------------------------------------------------ |
| pre-tool-use       | PreToolUse       | `pre-tool-use.sh`       | 1s          | Fenced co-edit suggestions (jq only; partners re-validated as files under the root) |
| prewarm            | SessionStart     | `prewarm.sh`            | 5s          | Background install + ONNX model download (detached)    |
| session-start      | SessionStart     | `session-start.sh`      | 6s          | Worktree store-heal, one semantic recall into additionalContext |
| post-tool-use      | PostToolUse      | `post-tool-use.sh`      | 1s          | Record co-edit pairs in `.ruvector/coedit.json` (jq only) |

**Security properties:**

- All scripts validate input via shared `lib/validate.sh`
- Path traversal rejected (`..`, `/`, `~` in arguments)
- Hooks run only the plugin-managed CLI (`<data>/current/…/cli.js`), never a
  `ruvector` found on PATH, and run it from the git toplevel
- The worktree store-heal (`lib/resolve.sh`, run by the MCP launcher and
  `session-start.sh`) creates a symlink
  `<worktree>/.ruvector -> <main-checkout>/.ruvector` only when the session runs
  in a linked git worktree (`.git` is a file), the local entry is absent or a
  dangling symlink, and the main checkout has a store. The link target derives
  from `git rev-parse --git-common-dir` (never user input); a pre-existing
  non-symlink path (directory or regular file) is never replaced (warn-only)
- Queue files are append-only JSONL with `flock` for concurrency safety
- No network calls in any hook script except `prewarm.sh`'s detached
  background install (`npm ci`) and model download
- Scripts run with user's permissions (no escalation)

### Hook Review Process

Before enabling any plugin with hooks:

1. Review the hook scripts in `plugins/<name>/hooks/scripts/`
2. Check the `hooks` block in `.claude-plugin/plugin.json` (generated from
   `catalog/`) for hook configuration — plugins do not ship a separate
   `hooks/hooks.json`
3. Verify scripts match the documented behavior above
4. Test in a non-production environment first

## Trust Boundaries

### Remote MCP Servers (yellow-linear, yellow-composio, yellow-devin, yellow-core)

- Data sent over HTTPS to third-party servers
- Subject to each provider's privacy policy and terms
- OAuth tokens managed by Claude Code MCP client (not stored in plugin code)
- No credentials or API keys stored in plugin files

### Release PR token (`RELEASE_PR_TOKEN`)

`version-packages.yml` optionally uses a `RELEASE_PR_TOKEN` repository secret to
push the `changeset-release/main` branch, open the "chore: version packages" PR,
and push release tags. It exists so the PR's CI runs without maintainer approval
(the repo requires approval for all external contributors, and
`github-actions[bot]` counts as one); unset, the workflow falls back to the
ephemeral `GITHUB_TOKEN`.

- **Owner**: a KingInYellows organization member with write access to this
  repository. An outside collaborator's token is still subject to the approval
  policy, and a PAT cannot exceed its owner's role, so a read-only member's
  token passes the preflight but fails at the push.
- **Scope**: fine-grained PAT, resource owner KingInYellows, this repository
  only, Contents + Pull requests read/write, no other permissions.
- **Exposure**: available only to the `version-or-publish` job, which runs on
  pushes to `main` and `workflow_dispatch` — never on pull requests — and is
  passed to the pinned `changesets/action` step and the preflight probe.
- **Rotation**: set an expiry (90 days or less). Create the new PAT, install it
  with `gh secret set RELEASE_PR_TOKEN`, then revoke the superseded PAT in the
  owner's settings — replacing the secret does not invalidate the old token. An
  expired token fails the preflight step with an explicit error.
- **Revocation**: revoke the PAT in the owner's settings and run
  `gh secret delete RELEASE_PR_TOKEN`; the workflow reverts to `GITHUB_TOKEN`.

### Local Execution (yellow-ruvector, yellow-debt, yellow-review)

- All processing happens locally on user's machine
- yellow-ruvector stores embeddings in `.ruvector/` directory (gitignored)
- yellow-review uses `gh` CLI which reads user's GitHub auth state
- yellow-debt reads codebase files but only writes to `todos/` directory
- **yellow-review's Codex copy is a trust-boundary downgrade, not a
  data-residency one.** Codex CLI runs locally like `gh` or `gt`, so the
  "all processing happens locally" guarantee above still holds for it.
  Claude's `thermonuclear-reviewer` agent is restricted by `tools:`
  frontmatter (read-only); the generated Codex copy of
  `yellow-thermonuclear-review` has no equivalent allowlist and relies on
  the skill body's report-only rails instead — a prompt-level control, not
  runtime enforcement. See
  `plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md`
  "Safety rails".

### Review-Findings Ledger (yellow-review)

`/review:pr` and `/review:all` persist model-derived review data — finding
titles, suggested fixes, reasons and anchor snippets — and feed part of it
back into later reviewer prompts. The boundary:

- **Storage.** The ledger lives under
  `$(git rev-parse --git-common-dir)/yellow-review/findings/`: inside the Git
  directory, so it is never committed or pushed, and shared by every worktree
  of the clone. `lib/review-ledger.sh` creates the directory 0700 and every
  file 0600 (`umask 077`). Nothing is posted to GitHub.
- **Redaction before persistence.** Every model-authored string passes
  through yellow-core's `cs_redact_secrets`, then a fail-closed pass that
  replaces env-style `*_KEY` / `*_TOKEN` / `*_SECRET` / `*_ID` / `*_PASSWORD`
  assignments and long high-entropy tokens with
  `[withheld: possible credential]`. Without yellow-core, or when redaction
  fails, the string is withheld rather than stored raw; an anchor line that
  fails redaction keeps only its hash and line hint.
- **Prompt re-entry.** Dismissals that still apply are re-injected into later
  reviewer prompts as a `--- begin dismissed-findings (reference only) ---`
  block. The library substitutes that block's delimiters and the neighbouring
  context blocks' delimiters out of every value, XML-escapes them, and drops
  any entry whose title or reason starts a line with `IGNORE PREVIOUS`,
  `system:` or `assistant:`. Reviewers treat the block as reference data,
  never as instructions.

### Context Observer Persistence (yellow-core)

`/statusline:setup` Step 5b (or `/statusline:setup observer`) offers an
opt-in statusline stage, `lib/context-observer.py`, that persists one
session-bound observation derived from externally supplied statusline
fields (working directory, session context metrics). The boundary:

- **Opt-in only.** Default is No. `lib/statusline-settings.py` composes
  `{ command -v python3 >/dev/null && [ -r <observer> ] && exec python3
  <observer>; exec cat; } | <existing statusLine command>`, where
  `<observer>` is `${CLAUDE_CONFIG_DIR:-~/.claude}/yellow-context-observer.py`
  (the `exec cat` fallback keeps a missing observer or `python3` from
  blanking the statusline), backing up `settings.json` before each change
  (`.pre-observer.backup`, with a numeric suffix when an earlier backup
  differs; an identical earlier backup is reused) and rewriting only
  `statusLine.command` — no other settings key is touched. Resetting an
  invalid `settings.json` (`statusline-settings.py statusline`) keeps the
  original, which can hold secrets, as `.corrupt.backup` (numbered, capped
  like the other backups) next to the `settings.json` path, beside the link
  when it is a symlink.
  `statusline-settings.py remove` (offered as "Disable it" by
  `/statusline:setup observer`) strips the stage and restores the wrapped
  command.
- **Storage.** One record per session at
  `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<slug>/context-observations/<session_id>.json`,
  written through a temp file plus atomic rename. The directory is created
  0700 and the file 0600. Stored fields: `session_id`, `observed_at`,
  `transcript_present` (a boolean; the transcript path itself is never
  stored), context-window percentages/size, and advisory-watermark
  crossings. `session_id` is allowlisted to `[A-Za-z0-9_-]{1,128}`, and the
  slug is derived only from an absolute `project_dir` (or `cwd`) with no
  `.`/`..` component or control character; anything else writes nothing.
- **No side channels.** The observer does no network calls, spawns no
  subprocess and runs no git. On stdout it prints only the byte-for-byte
  pass-through of its stdin payload, which it writes and releases before any
  other work, or, run with `--help` or a terminal on stdin, its usage text
  instead of reading a payload. On stderr it writes one line saying why
  nothing was recorded, and only when `CONTEXT_OBSERVER_DEBUG=1`.
- **Latency.** The composed stage `exec`s the observer so no shell keeps the
  pipe open: the statusline script sees EOF and computes its output while
  the observer records. Claude Code shows the statusline only once the whole
  command exits, which waits for the record write. Recording has a 100 ms
  latency target; the R22 bats test is a looser regression guard (best of
  five runs against a limit well above the target), not a check of the
  target itself. Recording also has a 2 s deadline
  (`DEADLINE_SECONDS`) armed once the payload is read; a filesystem call
  that cannot be interrupted can outlast it. A new statusline update that
  arrives while a stalled write holds the command cancels that run, so a
  persistently stalled filesystem can keep the statusline from refreshing.
- **Read path treats the record as untrusted.** The reader
  (`lib/context-observer.sh`'s `co_read_observation`, wired into
  session-handoff to fill `context_at_capture`) revalidates
  `session_id`, `observer_format`, and an anchored `observed_at` timestamp;
  returns `unknown` for anything stale (> 300 s, either direction),
  malformed, cross-session, or out of range; and exposes only six known
  fields into the handoff note — five numbers or timestamps (each nulled
  when outside the range the observer writes) and the `advisory_state` enum.
  `cwd` is never stored (it can carry credential-bearing path components);
  it only keys the slug when `project_dir` is absent. The reader always takes the newest
  `projects/*/context-observations/<sid>.json` for the session id, since a
  linked worktree or subdirectory launch can key the write under a
  different slug than the read.
- **Retention.** Nothing prunes records automatically.
  `statusline-settings.py prune [--older-than-days N] [--dry-run]` (default
  30 days) deletes old records and stale part files on demand, and reports
  `prune_incomplete` when a file cannot be removed. Deleting a project's
  `context-observations/` directory also clears its history, and
  `statusline-settings.py remove` disables the observer entirely.

### Cloud/Remote Execution (yellow-review Cursor distribution)

- **yellow-review's Cursor copy is both a trust-boundary downgrade and a
  data-residency downgrade — it does not have the "all processing happens
  locally" guarantee from Local Execution above.** Cursor plugins installed
  through Cursor's Cloud/Background Agents run in Cursor's remote
  environment, not the user's local machine; a `yellow-thermonuclear-review`
  invocation started from a Cloud Agent processes the repository off-machine,
  under Cursor's data handling, not this repository's. The same skill can
  also run inside the local Cursor editor (see
  `docs/cursor-distribution.md` "Local Cursor loading procedure"), where the
  local-processing guarantee does hold — the boundary depends on which
  Cursor surface invokes it, not on the plugin itself.
- As with the Codex copy, the generated Cursor skill has no `tools:`
  allowlist equivalent to the Claude agent's read-only restriction and
  relies entirely on the skill body's report-only rails (prompt-level, not
  runtime-enforced). See
  `plugins/yellow-review/skills/yellow-thermonuclear-review/SKILL.md`
  "Safety rails".

### Remote API and Local Artifacts (yellow-jules)

yellow-jules is experimental and read-only in this release: `setup`, `list`,
`status`, `collect`. See `plugins/yellow-jules/README.md`.

- **Credential-bearing remote API.** `JULES_API_KEY` is read from the shell
  environment only, never from command arguments. Requests go to
  `https://jules.googleapis.com` and redirects are refused
  (`src/fetch-guard.ts`), so the key cannot be forwarded to another host. The
  key, auth headers, and common key shapes are redacted on every output path,
  and stderr carries error codes only.
- **No writes to Jules.** Every shipped command is a read; a test asserts none
  sends a POST, PATCH, PUT, or DELETE.
- **Local artifact persistence.** State lives in `$YELLOW_JULES_DATA_DIR`, else
  `$XDG_DATA_HOME/yellow-jules`, else the platform default. Directories are
  `0700` and files `0600`; a group- or world-writable or non-owned data dir is
  refused (`JULES_DATA_DIR`), and it is never placed inside a git work tree or
  the plugin directory. `/jules:collect` writes patches and generated files
  byte-exact under `artifacts/<local-id>/` only; it never touches a checkout or
  applies a patch, and files containing secret-shaped strings are flagged, not
  altered.
- **SDK install.** `/jules:setup` installs the pinned `@google/jules-sdk` into
  the data directory only with consent, via `npm ci --ignore-scripts` from a
  shipped lockfile, and re-verifies the install on every load.

### Engine Process Boundary (yellow-goal)

yellow-goal spawns the pinned `goal-gen` engine (a GitHub Release tarball whose
version, URL and SHA-256 are recorded in `plugins/yellow-goal/src/pin.ts`) as a
child process and never imports it. Containment assumptions:

- **Executable**: resolved once per operation from `PATH` (or the test-only
  `GOAL_GEN_BIN` override); every operation first probes `version --json` and
  `capabilities --json` and refuses an engine whose identity, version or
  capabilities disagree with the pin. **The locally installed executable is a
  trusted boundary**: the operator installs the verified release asset and
  controls `PATH`; the runtime probes validate an already trusted binary and do
  not claim to authenticate an arbitrary replacement (Provider Protocol v1,
  PP-11). Release-asset provenance is enforced by the SHA-256 check in the
  blocking CI gate, not at every spawn.
- **Authority**: `/goal:setup` and `/goal:request` are read-only;
  `/goal:run-stub` spawns exactly
  `run --executor stub --protocol v1 --stub-scenario <scenario> [--timeout-ms n] [--yes] -- <request>`.
  No executor, protocol, target, provider or raw-argv selector is exposed; the
  stub executor is zero-spend and never touches the request's target repository,
  and the consumer rejects a nonzero reported cost.
- **Environment**: the child receives only `PATH`, `LANG`/`LC_ALL` and a
  disposable `HOME`/`TMPDIR`/`XDG_*` under a per-operation scratch directory
  that is removed afterwards; ambient credentials and `NODE_OPTIONS` are never
  forwarded; stdin is closed.
- **Bounds**: stdout/stderr are byte-bounded before buffering, the JSON Lines
  stream is validated incrementally, one absolute deadline and AbortSignal span
  all phases, cancellation is SIGTERM then SIGKILL after 5 s, and results carry
  only the validated terminal summary plus bounded scalar diagnostics — never
  raw engine output, request contents or environment.
- **Request path**: `/goal:run-stub` validates the request path with
  yellow-core's `validate_file_path` (relative, inside the working directory, no
  symlink escape) before invoking the engine.
- **CI**: the blocking `Released Goal Engine Compatibility` job verifies the
  public asset's SHA-256 before installing it with lifecycle scripts ignored and
  drives every stub scenario with failing `claude`/`codex` traps first on
  `PATH`.

### External CLI Reviewers (yellow-council)

`/council`'s Gemini-lineage reviewer shells out to the Antigravity CLI (`agy`)
instead of talking to a remote MCP server, so its trust boundary doesn't match
either pattern above:

- **Credential store**: OS keyring, holding Gemini OAuth session tokens migrated
  on `agy`'s first interactive run (per Google's documentation) — no API key is
  configured by or read from plugin code
- **Auth model**: subscription (Google AI Pro/Ultra or the free individual
  tier), the same model the retired Gemini CLI used
- **Data sent**: the council pack (diff, plan, or question content) is staged to
  a throwaway pack directory and handed to `agy` as a workspace file; `agy` may
  send that content to Google's Antigravity service to produce a review
- **Containment posture — weaker than the retired plan**: `agy` has no read-only
  or `--approval-mode plan` equivalent; `--sandbox` restricts the terminal only
  and does not block file writes (spike-verified 2026-08-01,
  `docs/spikes/antigravity-cli-headless-2026-08.md`). The reviewer mitigates by
  running `agy` with its `cwd` isolated to the throwaway pack directory — the
  real repo checkout is never inside its workspace — plus a prompt-level
  instruction not to modify files. That is a prompt-plus-containment control,
  not a CLI-enforced one. See `plugins/yellow-council/CLAUDE.md` "Known
  Limitations" for the full writeup, including the standing recommendation to
  treat any unexpected file mutation after a `/council` run as a bug report.
- **Never use** `agy --dangerously-skip-permissions` — it auto-approves every
  tool permission request, including writes (same class as the retired Gemini
  `--yolo`)

#### Synthesis staging directory (yellow-council)

`council.md` Steps 5a-5e stage reviewer text for the blind two-pass synthesis
in a `/tmp/council-synth-XXXXXX` directory. That directory is a separate
trust boundary from the pack and fenced-output files above:

- **Contents**: `.token`, `labels.txt` (the S1-S4 label map),
  `forward.txt`/`reverse.txt` (normalized, already-redacted reviewer text,
  fenced as `council-output:S<n>` and relabeled so no reviewer is named),
  `<reviewer>.summary.txt` (Codex, plus excluded Gemini/OpenCode early-exit
  summaries, written by the model with `Write`), and `pass-a.md`
  (model-generated, untrusted; the 5d resume block validates it instead of
  trusting it). `mktemp -d` creates the directory 0700.
- **Ownership and authentication handoff**: the capability (directory plus a
  32-hex token) lives in a shell-owned state file,
  `$GIT_ROOT/.git/council-synth.state` (line 1 directory, line 2 token), written
  only by 5a and never relayed through the model. 5a refuses a symlink or a
  non-regular/foreign file at that path. If its own claim fails it removes the
  directory it minted and its temp file, and never an existing state file (it
  removes a leftover only when that file's directory is gone or past the 24-hour
  retention). Steps 5b, 5d resume, and 5e reload both values from the state file
  (regular, non-symlink, owned by the current user) and require a
  `/tmp/council-synth-*` shape with no `..` or extra `/`, a directory that
  exists, is not a symlink and is owned by the user, a 32-hex token, and a
  `$SYNTH_DIR/.token` equal to the state token. Anything missing, foreign, or
  garbled fails closed with nothing deleted. The token covers a state file that
  names a directory 5a did not mint for it (a stale or hand-edited entry, or a
  user-owned directory that reuses a `/tmp/council-synth-*` name): the check
  fails and nothing is deleted. It adds nothing against the forgery below. The
  model sees only the printed `COUNCIL_SYNTH_DIR`, for non-destructive
  `Read`/`Write`, so no destructive step trusts a path or token the model
  relayed. One synthesis runs per checkout at a time (the state file lives in
  `$GIT_ROOT/.git`): 5a refuses while another run's state file is live.
  Checkouts where `.git` is a file (linked worktrees) are unsupported, as with
  `.git/council-state.tsv`, and the state claim needs a filesystem with hard
  links.
- **Known residual (Write)**: the state file removes the relayed-literal
  vector, not a deliberate forgery. The orchestrator holds `Write`, which is
  not path-scoped at runtime, so a prompt-injected orchestrator could write a
  matching state file and `.token` for a directory it chose and steer 5e's
  `rm -rf` to it. The shape checks bound that to a `/tmp/council-synth-*`
  directory the user owns. Any model-driven write channel can do the same, a
  Bash fence as well as `Write`, so a `Write` deny rule for
  `.git/council-synth.state` only narrows the residual. Closing it needs a
  capability held where no model-launched process can write.
- **Known residual (stale-state reclaim race)**: "one synthesis per checkout"
  holds except while a stale state file is being reclaimed. Two runs that both
  find the same leftover can each remove the other's fresh claim between 5a's
  stale check and its `ln`, so two syntheses can proceed in one checkout. The
  window is milliseconds and is left open because `sh` has no atomic
  compare-and-remove.
- **Known residual (pathname unlink after validation)**: the final unlink in
  `council_rm_synth_state` is by pathname after validation, so a reclaim that
  lands between the check and the `rm` can remove another run's fresh claim.
  Narrow, same class as the reclaim race above, and left open for the same
  reason (no atomic compare-and-remove); the function's behavior is unchanged.
- **Cleanup and retention**: 5e and `council_synth_abort` release the claim
  first (unlink the state file) and only then remove the directory. The state
  file is authenticated with the directory's `.token`, and a `rm -rf` that fails
  partway can delete `.token` yet leave the directory, after which the file
  could no longer be authenticated and would block the next run for up to a
  day; so the file goes while `.token` is intact, and a directory that cannot be
  removed never blocks a new run. A file that fails authentication is still
  never unlinked, and a symlink is never followed. When `rm -rf` fails (a
  non-writable directory),
  they run `chmod -R u+rwx` on the directory and retry once, only for a real
  directory the user owns under `/tmp/council-synth-*`; if it still cannot be
  removed they print the exact `chmod -R u+rwx <dir> && rm -rf <dir>` command
  to run by hand. Step 7 early exit and Step 9 cleanup remove the state file
  only, and only when this run's 5a claimed it AND the file is still this run's
  claim (`council_rm_synth_state`: a regular, non-symlink file
  owned by the user whose line 1 equals the `COUNCIL_SYNTH_DIR` this run's 5a
  printed and, while that directory exists, whose token equals its `.token`).
  A missing file is success. A symlink (never followed or removed), a foreign
  owner, another run's directory or a token mismatch leaves the path alone with
  a one-line note: this covers a run whose 5a refused, a 5e that already removed
  the file (it prints that this run's claim is released) and a paused run whose
  stale state another `/council` reclaimed. The relayed `COUNCIL_SYNTH_DIR` is
  only compared, never deleted; a wrong or missing literal fails closed. A
  5d-resume or 5e failure runs the Step 8 Cancel block, which also removes the
  staging directory so the staged reviewer text does not outlive the run. It
  authenticates the directory BEFORE releasing the claim, because afterwards the
  state file can no longer prove which directory is this run's: only when this
  run's 5a claimed the file (`SYNTH_STATE_CLAIMED=1`) and `SYNTH_OWN_DIR` passes
  the shape check (`/tmp/council-synth-*`, no `..`, no extra `/`), the state
  file is a regular non-symlink file of the user whose line 1 equals it and whose
  line 2 is a 32-character hex token, and the directory is real, not a symlink,
  owned by the user, with a regular non-symlink `.token` equal to that token. It
  then releases the claim and removes the directory (same `chmod -R u+rwx`
  retry and manual-command warning as 5e). A run that claimed nothing, a
  symlinked or unowned directory, or a path outside the shape is never removed.
  24 hours is the eligibility threshold for the 5a sweep, not a maximum
  retention: the sweep runs only when a later `/council` invocation reaches 5a,
  and then deletes `/tmp/council-synth-*` directories older than 24 hours
  (with the same chmod-then-remove for an owned directory). An interrupted run
  leaves redacted, normalized reviewer text in `/tmp` until that later run, or
  until you remove it. A `.git/council-synth.state` left by such a run stays
  until a later 5a reclaims it (directory gone or over 24 hours old; before
  that 5a refuses to start another synthesis in the checkout) or you remove it
  by hand.
- **Prompt-injection boundary**: all staged reviewer text is untrusted. It is
  redacted in Step 4, normalized, fenced with `[ESCAPED]` delimiter handling,
  and read from files rather than large Bash results. Labels hide reviewer
  identity until 5e de-anonymizes.
- **Known residual**: the older `CLAUDE_FENCED_FILE` handoff (Steps
  5b/7/8/9) still relays its path through the model. It is guarded by a shape
  check on `/tmp/council-claude-fenced-*.txt` plus identity with the minted
  literal; converting it to a state file is a follow-up.

### In-Process Reviewer (yellow-council `claude-reviewer`)

`/council`'s fourth slot does not shell out at all. It runs inside Claude Code
with `tools: [Read, Grep, Glob, Write]` and no `Bash`, which makes its trust
boundary different from the three CLI reviewers above in three ways that matter:

- **`Write` on a `review/` agent.** The W1.5 rule in
  `scripts/validate-agent-authoring.js` denies `Write` to `review/` agents by
  default; `gemini-reviewer` and `opencode-reviewer` are also allowlisted
  exceptions, but for a different reason — they shell out to an external CLI
  binary via `Bash` and need `Write` alongside it. `claude-reviewer` is the only
  allowlisted reviewer with `Write` and no `Bash` at all: the exception exists
  solely so it can materialize its fenced-output file in-process, with no CLI
  invocation to justify it. The bound is a prompt constraint plus that
  review-time gate — **Claude Code has no runtime path-scoping for `Write`**, so
  nothing at execution time confines it. This is weaker than a sandbox and is
  stated as such in the agent body.
- **A two-hop path trust chain.** `council.md` mints the output path with
  `mktemp -u` in a Bash block, but the value reaches the agent because the
  orchestrating model copied the printed literal into the spawn prompt — a turn
  whose context already holds the untrusted pack. The `mktemp` suffix carries
  real entropy, so no attacker-chosen target is reachable, and both `council.md`
  and the agent shape-check the path against `/tmp/council-claude-fenced-*.txt`
  (rejecting `..`, extra separators, and symlinks) before reading, writing, or
  unlinking it. What is **not** enforced: the substitution itself is an LLM
  turn, not deterministic templating.
- **Prose safeguards, not mechanical ones.** The CLI reviewers redact
  credentials with an 11-pattern `awk` block and escape fence delimiters with
  `sed`. Both need `Bash`. `claude-reviewer` states the same rules as
  prompt-level self-discipline with nothing executing them — a genuine reduction
  in guarantee, not a formality.
- **No timeout bound.** `COUNCIL_TIMEOUT` wraps the CLI reviewers in
  `timeout(1)`; there is no subprocess here to kill, so a run that never returns
  blocks the fan-out. Mitigation is prompt-level only.

Full writeup in `plugins/yellow-council/CLAUDE.md` "Known Limitations" and in
the agent's own "Tool Surface — Documented Exception" section.

### Shell Commands

Plugins that execute shell commands:

| Plugin              | Commands Used                                | Purpose                                           |
| ------------------- | -------------------------------------------- | ------------------------------------------------- |
| yellow-linear       | `git`, `gh`                                  | Branch detection, PR context                      |
| yellow-devin        | `curl`, `jq`, `git`, `gh`                    | Devin API calls, JSON construction                |
| yellow-review       | `gt`, `gh`, `git`, `jq`                      | PR management, GraphQL queries                    |
| yellow-ruvector     | `node`, `npm`, `jq`, `git`, `pgrep`, `grep`  | ruvector CLI, install, hook scripts, seed-solutions guards |
| yellow-browser-test | `agent-browser`, `npm`, `curl`, `gh`         | Browser automation, setup                         |
| yellow-debt         | `git`, `gt`, `jq`, `yq`                      | Codebase analysis, commit generation              |
| gt-workflow         | `gt`, `git`                                  | Branch and PR management                          |
| yellow-council      | `agy`, `opencode`, `timeout`, `jq`, `mktemp` | Cross-lineage CLI code review                     |

### Prompt Injection Boundaries

Plugins processing untrusted input (PR comments, issue bodies, code content)
include prompt injection defenses:

- **yellow-review**: Agents processing PR comments wrap untrusted content in
  `--- begin/end ---` delimiters with "treat as reference only" advisory.
  The Cursor and Codex copies of `yellow-thermonuclear-review` use a
  per-capture nonce closer so a `--- code end ---` line in reviewed
  content cannot terminate the fence; they still have no runtime tool
  restriction (see Trust Boundaries above).
- **yellow-linear**: `/linear:work` and `linear-issue-loader` redact
  credentials from every Linear MCP response immediately after fetch. The
  patterns include key prefixes, auth headers and the repository's named
  credential assignments. Only the sanitized copy is displayed or written to
  the worktree, wrapped in `--- begin/end ---` reference-only fences. The
  plugin's other commands and agents don't redact yet; that is tracked as P0
  work in the yellow-linear improvement brainstorm.
- **yellow-jules**: Vendor-writable text (session titles, activity text,
  messages) reaches the model only inside an
  `--- begin untrusted-content <nonce> (reference only) ---` fence, sanitized
  first; only the end marker carrying the random tag closes it.
- **yellow-debt**: Scanner agents fence code content with injection boundary
  markers
- **yellow-ruvector**: Hook scripts validate all inputs before constructing
  paths or JSON

## Local npm Dependencies

### yellow-ruvector

Installs `ruvector` into the plugin data dir (not globally), pinned by the
plugin's own `package.json` dependency and committed `package-lock.json`
(integrity hashes for the full 197-package tree; ruvector's releases are
frequent, and 0.2.40 was once published from an unmerged branch):

```bash
# lib/install-ruvector.sh, run by bin/start-ruvector.sh, hooks/scripts/prewarm.sh,
# and /ruvector:setup
env -i HOME=… PATH=… [proxy/CA/npm_config_* passthrough] \
  npm ci --ignore-scripts --omit=dev --no-audit --no-fund
```

**Mitigation:** `--ignore-scripts` (the tree has no install scripts), `env -i`
so no other API keys or tokens reach npm: only proxy, CA, and
`NPM_CONFIG_*`/`npm_config_*` settings pass through, and those can carry a
registry auth token the user configured for npm, a data-dir prefix check (HOME or /tmp, or exactly
`<XDG_DATA_HOME>/yellow-ruvector` for a user-set, non-system absolute
`XDG_DATA_HOME` when `CLAUDE_PLUGIN_DATA` is unset, or a host-provided
`CLAUDE_PLUGIN_DATA` under a non-system `<CLAUDE_CONFIG_DIR>/plugins/data/`), one
install dir per lockfile hash with an atomic `current` symlink, and a
`ruvector mcp start --help` smoke test before the swap. The MCP server and all
hooks run this one install, so there is no second (global or npx) copy to
drift from the pin. Bats and vitest tests pin the package.json/lockfile sync.

### yellow-browser-test

May install `agent-browser` via npm:

```bash
npm install -g agent-browser
```

**Mitigation:** Only installed on explicit user request via
`/browser-test:setup` command.

## Reporting Security Issues

If you discover a security vulnerability in any plugin:

1. **Do not** open a public GitHub issue
2. Create a
   [private security advisory](https://github.com/kinginyellow/yellow-plugins/security/advisories/new)
   on the repository
3. Include: affected plugin, vulnerability description, reproduction steps
