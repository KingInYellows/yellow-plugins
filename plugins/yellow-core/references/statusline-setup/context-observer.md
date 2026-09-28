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

`statusline-settings.py install` writes:

- no `statusLine` → `{ python3 <observer> || cat; } | python3 <statusline>`
- any existing command → `{ python3 <observer> || cat; } | <existing>`; a command that
  contains `;`, `&`, `|`, `#` or a newline is wrapped as

  ```text
  { python3 <observer> || cat; } | (
  <existing>
  )
  ```

  so the payload reaches its first stage and a trailing comment or heredoc
  stays closed. The `|| cat` keeps the payload flowing when the observer file
  is missing or cannot start; without it the next stage would get empty stdin
  and the whole statusline would go blank.

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
command with `{ python3 <config>/yellow-context-observer.py || cat; } | `, or
wrap a compound one in `(` … `)` on their own lines. The older plain
`python3 <config>/yellow-context-observer.py | ` prefix is still recognised.

## Removal

`statusline-settings.py remove` strips a leading
observer stage (`{ python3 <…>/yellow-context-observer.py || cat; } |` or the
older plain `python3 <…>/yellow-context-observer.py |`) and unwraps the `(` … `)`
block, restoring the command it wrapped (backing up settings.json first). By
hand: delete that prefix from `statusLine.command`. Deleting the whole
`statusLine` key removes the statusline too.

## Non-interactive use

Agents can call the script directly instead of the Step 5b questions, or use
`/statusline:setup observer enable|disable|status --yes`. Every path has a
default (`--settings` and `--observer-dest` follow `CLAUDE_CONFIG_DIR`,
`--statusline` is `~/.claude/yellow-statusline.py`, `--observer-src` is the
copy next to the script), so `statusline-settings.py status` works with no
flags.

| Subcommand | Effect |
| --- | --- |
| `status` | read-only: `enabled`, `refresh` (installed copy missing or outdated) or `not-enabled`; an unconfigured statusLine is not an error |
| `plan` | what `install` would do (`install --dry-run`) |
| `install` | copy the observer, back up settings.json, compose the stage |
| `remove` | strip the stage, restoring the wrapped command |
| `statusline` | point `statusLine.command` at the yellow statusline, keeping a composed observer |
| `prune --older-than-days N` | delete observation records not modified for N days (default 30) |

`--dry-run` (on `statusline`, `install`, `remove`, `prune`) reports what would
happen and writes nothing. Each run prints one JSON object with `action`,
`error_code`, `existing_command`, `proposed_command`, `settings`, `backup`,
`observer`, `reason`; a failure also prints `error_code: reason` on stderr.
Settings backups keep the original and the newest four. A `statusline` run
that recovers from invalid settings.json saves the original as
`settings.json.corrupt.backup` (numbered when one exists) and says so in
`reason`.

`handoff.sh context` (session-handoff) reads the context back without git and
adds a `reason` code when it is `unknown`; a `format-mismatch` reason means the
installed observer copy no longer matches the plugin, so re-run
`/statusline:setup observer`.
