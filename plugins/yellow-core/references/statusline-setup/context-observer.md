# Context observer — reference for /statusline:setup Step 5b

Loaded by `commands/statusline/setup.md` Step 5b when the user needs the
manual merge, the removal steps, or the composition rules. The behaviour is
implemented in `lib/context-observer.py` (the observer) and
`lib/statusline-settings.py` (the only writer of `statusLine.command`).

## What it records

The observer runs as the first stage of `statusLine.command`. It passes the
statusline payload through unchanged, releases stdout, and records the
context-window numbers for the session to
`<config>/projects/<slug>/context-observations/<session_id>.json`, where
`<config>` is `${CLAUDE_CONFIG_DIR:-$HOME/.claude}`. It always exits 0.
`session-handoff` reads the record into `context_at_capture`. Headless
`claude -p` sessions render no statusline, so they produce no observations
and `context_at_capture` reads `unknown`; context never changes a preflight
status. Installing or updating yellow-core never changes `statusLine`.

## Composition

`statusline-settings.py install` writes the stage

```text
{ command -v python3 >/dev/null && [ -r <observer> ] && exec python3 <observer>; exec cat; }
```

- no `statusLine` → refused with `statusline_missing`: the observer only wraps
  an existing command, so `remove` always restores exactly what was there.
  Run the full `/statusline:setup` first; a non-interactive caller
  (`observer enable --yes`) stops and reports `statusline_missing` instead,
  because the base install is interactive.
- any existing command → `<stage> | <existing>`; a command that
  contains `;`, `&`, `|`, `#` or a newline is wrapped as

  ```text
  <stage> | (
  <existing>
  )
  ```

  so the payload reaches its first stage and a trailing comment or heredoc
  stays closed.

The `exec cat` fallback keeps the payload flowing when `python3` or the
observer file is missing; without it the next stage would get empty stdin and
the whole statusline would go blank. `exec` matters too: a stage such as
`{ python3 <observer> || cat; }` keeps the pipe open in its subshell until the
observer exits, so the statusline script cannot start until the record write
ends. With `exec` it computes its output as soon as the observer releases
stdout. Claude Code still shows the statusline only once the whole command
exits, which waits for the observer's record write (capped at 2 s), and a new
statusline update in that window cancels the run. `install` upgrades that
earlier stage, and the plain `python3 <observer> |` prefix, to the current
form (action `upgraded`); `status` reports either as `refresh`.

`statusline-settings.py statusline` (Step 5) keeps the observer stage when
it is already composed, so re-running setup does not drop it.

## Manual merge

For JSONC settings or a hand-maintained statusline. Resolve
`${CLAUDE_PLUGIN_ROOT}` before showing these commands to the user:

```bash
cp "${CLAUDE_PLUGIN_ROOT}/lib/context-observer.py" "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/yellow-context-observer.py"
chmod 755 "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/yellow-context-observer.py"
```

Then edit `statusLine.command` to the composition above: prefix a simple
command with the stage and ` | ` (with `<observer>` as
`<config>/yellow-context-observer.py`), or wrap a compound one in `(` … `)` on
their own lines. The plain `python3 <config>/yellow-context-observer.py | `
prefix is also recognised, but it has no fallback, so a missing observer
file blanks the statusline.

## Removal

`statusline-settings.py remove` strips a leading observer stage in any of the
forms above and unwraps the `(` … `)` block, restoring the command it wrapped
(backing up settings.json first). By hand: delete that prefix from
`statusLine.command`. Deleting the whole `statusLine` key removes the
statusline too. When `remove` refuses with `observer_not_removable` (the
observer stage has nothing after it), edit the command by hand.

## Non-interactive use

Agents can call the script directly instead of the Step 5b questions, or use
`/statusline:setup observer enable --yes` or `observer disable --yes`
(`observer status` is read-only and takes no flag). Every path has a
default (`--settings`, `--observer-dest` and `--statusline` follow
`CLAUDE_CONFIG_DIR`, `--observer-src` is the
copy next to the script), so `statusline-settings.py status` works with no
flags.

| Subcommand | Effect |
| --- | --- |
| `status` | read-only: `enabled`, `refresh` (installed copy missing or outdated, or an older stage form) or `not-enabled`; an unconfigured statusLine is not an error |
| `plan` | what `install` would do (`install --dry-run`) |
| `install` | copy the observer, back up settings.json, compose the stage (or upgrade an older one) |
| `remove` | strip the stage, restoring the wrapped command |
| `statusline` | point `statusLine.command` at the yellow statusline, keeping a composed observer |
| `prune --older-than-days N` | delete observation records not modified for N days (default 30) |

`--dry-run` (on `statusline`, `install`, `remove`, `prune`) reports what would
happen and writes nothing. Each run prints one JSON object with `action`,
`error_code`, `existing_command`, `proposed_command`, `settings`, `backup`,
`observer`, `reason`; a failure also prints `error_code: reason` on stderr.
A dry run reports the present tense (`install`, `upgrade`, `refresh`,
`remove`, `prune`, `statusline`, `recover`), a write the past tense.
Settings backups keep the original and the newest four. A `statusline` run
that recovers from invalid settings.json resets it, saves the original as
`settings.json.corrupt.backup` (numbered when one exists), and reports action
`recovered` with the backup path.

| `error_code` | Meaning and next step |
| --- | --- |
| `settings_jsonc` | settings.json has comments: use the manual merge |
| `settings_invalid` | settings.json is not valid JSON: fix it, or run `statusline` to reset it |
| `settings_unreadable`, `settings_not_object` | settings.json cannot be read, or is not an object: fix it by hand |
| `statusline_not_object`, `command_not_string` | `statusLine` has an unexpected shape: use the manual merge |
| `statusline_missing` | no `statusLine` is configured, so there is nothing to wrap: run the full `/statusline:setup` first (interactive; a non-interactive caller stops and reports this code) |
| `observer_src_missing` | the plugin's `lib/context-observer.py` is missing: pass `--observer-src` or reinstall yellow-core |
| `observer_not_removable` | the observer stage has nothing after it: edit `statusLine.command` by hand |
| `prune_incomplete` | some old records could not be deleted: `reason` names the first failure |
| `io_error`, `internal` | unexpected failure; `reason` has the detail |
| `usage` | bad arguments (exit 2) |

`handoff.sh context` (session-handoff) reads the context back without git and
adds a `reason` code when it is `unknown`; a `format-mismatch` reason means the
installed observer copy no longer matches the plugin, so re-run
`/statusline:setup observer`. A `stale` or `no-record` reason while the
observer is enabled can mean it cannot write: the observer is silent by
default, so set `CONTEXT_OBSERVER_DEBUG=1` in the environment Claude Code
runs the statusline with, and it says on stderr why nothing was recorded.
