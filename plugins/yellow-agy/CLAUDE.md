# yellow-agy

Successor to yellow-jules: one coding task handed to the Antigravity CLI (`agy`)
on the owner's machine, in an isolated git worktree, under the owner's Google AI
Pro sign-in.

## Status

Experimental, built to `docs/yellow-agy/contract-v0.md`. Commands under
`commands/agy/` call `node dist/cli.js <operation>`. The quota gate reads the
`/usage` shape captured from agy 1.4.12 (`tests/fixtures/usage-1.4.12.json`)
and fails closed (`AGY_QUOTA_UNKNOWN`) on any other shape; recapture it when
the agy version floor moves. The evidence for every flag it uses is in
`docs/spikes/antigravity-cli-delegate-2026-10.md` and
`docs/spikes/antigravity-cli-adapter-probe-2026-11.md`.

## Architecture

```text
plugins/yellow-agy/
  src/
    invocation.ts   # the only place an agy spawn (file, argv, env) is built: env scrub, hooks off, WSL bridge
    profiles.ts     # --settings profiles (read-only, implement) and per-turn argv
    classify.ts     # result classification; an absent finished_reason is a normal finish
    errors.ts       # AGY_* catalog with exit codes and recovery actions
    host-exec.ts    # git and file ops where agy runs (exec-only on the WSL bridge)
    process.ts      # runs one agy turn: own POSIX (or bridge Linux) process group, deadline SIGTERM then SIGKILL
    worktree.ts     # create, pre-turn snapshot refs, reset-partial, collect, remove
    state.ts        # journal in the data dir (0700 on POSIX; on Windows, private only under the per-user %LOCALAPPDATA%): lock, durable atomic writes
    lifecycle.ts    # delegate / approve / reply / collect / abandon / status
    grants.ts       # owner grants, stored in the journal, checked and charged inside each reservation
    quota.ts        # the /usage quota gate
    tty.ts          # owner confirmation on the terminal (/dev/tty; CONIN$ on Windows, unverified)
    host-config.ts  # the host setup records: posix, windows-native or wsl-bridge, worktree root
    cli.ts          # one JSON envelope on stdout, exit 0/1/2
    plan-schema.ts  # the --json-schema a plan turn passes, and its shape check
    redact.ts       # secret-shape scan and untrusted-content fence (from yellow-jules)
  dist/             # committed compiled CJS; drift-checked in CI
  tests/            # vitest with real git in temp dirs and a fake agy; no agy binary needed
```

## Conventions

- Subscription auth only. Never suggest an API key, Vertex/ADC, or AI-credit
  overages, and never read or copy files under `~/.gemini/` other than
  `antigravity-cli/settings.json`, which setup only reads.
- The WSL bridge is exec-only: `wsl.exe [-d <distro>] -e …`, never the `--`
  form, which re-parses arguments in the distro's shell.
- Setup never runs a model turn. Quota is the owner's weekly AI Pro bucket.
- Error codes use the `AGY_*` prefix and env vars the `YELLOW_AGY_*` prefix
  (contract-v0 "Output envelope" lists them).
- Creating a grant and abandoning a task need the owner at a terminal. The
  commands print the line for the owner to run; never try to answer the code.
- A call must end inside the wrappers' 600 s Bash timeout. It runs the
  `/usage` probe (60 s + 10 s kill grace) and then the turn (print timeout +
  30 s slack + 10 s grace), so `YELLOW_AGY_PRINT_TIMEOUT_SECONDS` is 60-420
  (default 420).
