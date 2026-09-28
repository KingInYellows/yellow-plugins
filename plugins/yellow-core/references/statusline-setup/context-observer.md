# Context observer — reference for /statusline:setup Step 5b

Loaded by `commands/statusline/setup.md` Step 5b when the user needs the
manual merge, the removal steps, or the composition rules. The behaviour is
implemented in `lib/context-observer.py` (the observer) and
`lib/context-observer-setup.py` (the only writer of `statusLine.command`).

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

`context-observer-setup.py install` writes:

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

`context-observer-setup.py statusline` (Step 5) keeps the observer stage when
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

`context-observer-setup.py remove` strips a leading
observer stage (`{ python3 <…>/yellow-context-observer.py || cat; } |` or the
older plain `python3 <…>/yellow-context-observer.py |`) and unwraps the `(` … `)`
block, restoring the command it wrapped (backing up settings.json first). By
hand: delete that prefix from `statusLine.command`. Deleting the whole
`statusLine` key removes the statusline too.

## Non-interactive use

Agents can call the script directly instead of the Step 5b questions:
`plan` (read-only status: `already-installed` means enabled, `refresh` means
enabled with a missing or outdated copy; pass `--observer-src` to also detect
an outdated one), `install`, `remove`. A `statusline` run that recovers from
invalid settings.json saves the original as `settings.json.corrupt.backup`
(numbered when one exists) and says so in `reason`. Each prints
one JSON object with `action`, `error_code`, `existing_command`,
`proposed_command`, `settings`, `backup`, `observer`, `reason`.
