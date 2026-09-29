# Statusline payload fixtures — Claude Code 2.1.284

Real statusline payloads used by `tests/context-observer.bats` (spec R25).

- **Client:** Claude Code 2.1.284 (`version` field in the payloads).
- **Captured:** 2026-09-28, interactive session, Opus 5.5 with a 1M-token window.
- **Method:** a one-off session started with
  `claude --settings '{"statusLine":{"type":"command","command":"tee -a ~/.claude/statusline-capture.jsonl | python3 ~/.claude/yellow-statusline.py"}}'`,
  so `settings.json` was never edited. Three payloads were recorded, each one
  compact JSON line ending in a newline.

| File | Source |
| --- | --- |
| `startup-null.json` | Payload 1, rendered before the first reply: `current_usage`, `used_percentage` and `remaining_percentage` are `null`. |
| `mid-session.json` | Payload 3, after the first reply: 10 % used, 90 % remaining. |
| `missing-session.json` | `mid-session.json` with the `session_id` key removed. |
| `malformed.json` | The first half of `mid-session.json` (truncated JSON, no newline). |

No post-compact payload was captured; post-compaction behaviour is not
covered by a real-host fixture.

## Sanitization

Plain string replacement on the raw lines, then re-serialized and checked
byte-identical to compact JSON. Numbers, booleans, key order and every other
field are unchanged.

- `session_id` (also inside `transcript_path` and `scratchpad_dir`) →
  `00000000-0000-4000-8000-000000000001`
- `prompt_id` → `00000000-0000-4000-8000-000000000002`
- the project directory → `/home/user/project`; its projects-dir slug →
  `-home-user-project`; the home directory → `/home/user`
- `workspace.repo.owner` / `name` → `example-owner` / `example-repo`
