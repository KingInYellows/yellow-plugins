---
title: SSH Daemon Command Dispatch Security Patterns
date: 2026-04-04
category: security-issues
tags: [ssh, command-injection, daemon, remote-execution, regex-validation]
components: [yellow-symphony]
---

# SSH Daemon Command Dispatch Security Patterns

Patterns discovered during multi-agent review of PR #240 (yellow-symphony SSH-based daemon management plugin planning docs).

## Problem

Plugin designs that dispatch commands over SSH to remote daemons introduce several security and correctness risks when the command dispatch layer, credential handling, and input validation are not properly constrained.

### Symptoms

- Compound `&&` commands in a single SSH call allow injection if any argument is attacker-controlled
- Planning docs use pre-pivot terminology (Claude Code responsibilities described where OpenClaw owns them)
- SSH validation commands missing identity file flag despite config storing key path
- `.local.md` config files containing SSH host/user/key path committed to git
- Unbounded regex patterns accept arbitrarily long input

## Root Cause

### 1. Compound SSH command dispatch (P1)

Sending `ssh user@host "cmd1 && cmd2 && cmd3"` treats the entire remote string as a shell expression. If any portion is derived from user input without strict validation, shell metacharacters (`;`, `|`, `$()`, backticks) enable command injection on the remote host.

**Fix:** Use separate SSH calls per command, and validate the command prefix against an allowlist regex.

> **Portability note:** `timeout` is GNU coreutils; macOS ships without it.
> In production scripts, detect `timeout` vs `gtimeout` first. These examples
> use `timeout` directly for brevity.

```bash
# Allowlist: lowercase alphanumeric, spaces, underscores, hyphens, slashes
# Max 64 chars to prevent abuse
ALLOWED_CMD_RE='^[a-z][a-z0-9 _/-]{0,63}$'

run_remote() {
  local cmd="$1"
  # Reject newlines — grep is line-by-line, so "ls\nrm -rf /" would pass
  case "$cmd" in *$'\n'*|*$'\r'*) fatal "Command contains newlines: rejected" ;; esac
  printf '%s' "$cmd" | grep -qE "$ALLOWED_CMD_RE" || {
    fatal "Command rejected by allowlist: $cmd"
  }
  timeout 30 ssh -i "$ssh_key" -o ConnectTimeout=10 "$ssh_user@$ssh_host" "$cmd"
}

# Correct: separate calls
run_remote "daemon_ctl status"
run_remote "daemon_ctl restart myservice"

# WRONG: compound chain in single call
# ssh user@host "daemon_ctl status && daemon_ctl restart myservice"
```

### 2. False transport abstraction claim (P1)

`daemon_ctl` is a shell command prefix (a CLI on the remote host), not a transport abstraction layer. Describing it as a "transport layer" misleads implementors into thinking it handles connection management, retries, or protocol negotiation. Call it what it is: a remote CLI command prefix.

### 3. Component mapping pre-pivot language (P1)

When a project pivots ownership of responsibilities (e.g., from Claude Code to OpenClaw), all planning docs must be audited. A component mapping table that still describes the old owner's responsibilities creates confusion about which system actually implements the behavior.

### 4. SSH credential config needs .gitignore (P1)

Any `.local.md` or config file that stores SSH connection details (host, user, key path) must have a `.gitignore` entry. Even if the file only contains paths (not keys themselves), the host/user combination is sensitive infrastructure information.

```gitignore
# In plugin .gitignore or root .gitignore
*.local.md
```

### 5. SSH validation missing identity file (P2)

When the plugin config stores an SSH key path, every `ssh` invocation -- including the initial validation/connectivity check -- must include `-i "$ssh_key"`. Without it, SSH falls back to the default agent/key, which may succeed in development but fail in production where only the specified key is authorized.

```bash
# Tilde expansion is required before passing to ssh -i
ssh_key="${ssh_key/#\~/$HOME}"

# Correct: validation includes -i
timeout 10 ssh -i "$ssh_key" -o ConnectTimeout=5 "$ssh_user@$ssh_host" "echo ok"

# WRONG: omits -i, uses default key
# ssh -o ConnectTimeout=5 "$ssh_user@$ssh_host" "echo ok"
```

### 6. Unbounded regex validation (P2)

A regex like `^[A-Z]+-[0-9]+$` for issue IDs has no length bound. An attacker (or buggy integration) could submit a megabyte-long string that matches the pattern, causing excessive memory use in downstream processing.

```bash
# WRONG: no length bound
ISSUE_RE='^[A-Z]+-[0-9]+$'

# Correct: bounded character classes
ISSUE_RE='^[A-Z]{1,10}-[0-9]{1,10}$'
```

**Rule:** Every user-facing regex validation should include explicit length bounds via `{min,max}` quantifiers.

### 7. TOFU SSH without host-key-changed handling (P2)

Trust-On-First-Use (TOFU) SSH accepts the host key on first connection, but if the remote VM is rebuilt (same IP, new host key), SSH rejects the connection with a scary "REMOTE HOST IDENTIFICATION HAS CHANGED" error. The plugin must detect this and provide clear remediation:

```bash
ssh_output=$(timeout 10 ssh -i "$ssh_key" -o ConnectTimeout=5 \
  -o BatchMode=yes "$ssh_user@$ssh_host" "echo ok" 2>&1) || {
  if printf '%s' "$ssh_output" | grep -q "REMOTE HOST IDENTIFICATION HAS CHANGED"; then
    printf 'Host key changed (VM may have been rebuilt).\n'
    printf 'To fix: ssh-keygen -R %s\n' "$ssh_host"
    printf 'Then re-run setup to accept the new key.\n'
    exit 1
  fi
  fatal "SSH connection failed: $ssh_output"
}
```

## Prevention

- [ ] Reject commands containing newlines before regex validation (grep is line-by-line)
- [ ] Validate all SSH command strings against an allowlist regex before dispatch
- [ ] Use separate SSH calls instead of `&&` chains
- [ ] Always pass `-i "$ssh_key"` when the config stores a key path
- [ ] Expand `~` in key paths before use: `ssh_key="${ssh_key/#\~/$HOME}"`
- [ ] Wrap SSH calls with `timeout N` to prevent hangs (`gtimeout` on macOS without coreutils)
- [ ] Add `.gitignore` entries for any file containing SSH connection details
- [ ] Length-bound all user-facing regex validations with `{min,max}`
- [ ] Handle host-key-changed scenario with detection and clear remediation steps
- [ ] Audit planning docs after ownership pivots for stale component mappings

## Related Documentation

- `docs/solutions/security-issues/shell-binary-downloader-security-patterns.md` -- overlapping shell security patterns
- `docs/solutions/code-quality/plugin-review-defensive-authoring-patterns.md` -- defensive authoring for plugin commands
- `docs/solutions/logic-errors/devin-review-prs-shell-and-api-bugs.md` -- shell and API bug patterns
