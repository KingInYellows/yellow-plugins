---
name: mcp-health-probe
description: "Canonical three-state MCP server health classification (OFFLINE / DEGRADED / HEALTHY) for `/<plugin>:status` commands. Use when authoring a status command that needs to distinguish 'MCP never started' from 'MCP running but upstream API degraded'."
user-invokable: false
---

# MCP Health Probe

## What It Does

Defines the canonical three-state MCP health classification (OFFLINE /
DEGRADED / HEALTHY) used by `/<plugin>:status` commands so the user can
distinguish "the MCP server didn't start" from "the MCP started but the
upstream API is failing." Extracted from yellow-morph's `/morph:status`
and generalized for any plugin with an MCP + upstream HTTP API.

## When to Use

Load when authoring a `/<plugin>:status` command for a plugin whose MCP
server depends on an upstream HTTP API (Morph, Semgrep, Perplexity, etc.).
The skill defines the state machine, the classification table, and the
canonical reference implementation so each status command behaves
consistently.

## Usage

Three-state classification pattern for `/<plugin>:status` commands that
expose an MCP server. The subsections below cover the three states, the
detection pattern, the classification table, the rationale, a reference
implementation, and the anti-patterns to avoid.

### States

- **OFFLINE** — The MCP server did not start or crashed. None of its tools
  are visible to the agent via `ToolSearch`. No API probe is run in this
  state (there is no point — the server isn't there).
- **DEGRADED** — The MCP tools are visible (server started), but the
  upstream HTTP API returns a non-200 response to a minimal health probe.
  Tools are callable but will fail at invocation time until the upstream
  recovers or the credential is fixed.
- **HEALTHY** — MCP tools are visible AND the API probe returned 200 (or
  was skipped because the credential isn't readable from the shell — see
  "Skipped probe" below).

### Pattern

```text
Step 1: Tool visibility check (authoritative OFFLINE detection)
  Call ToolSearch with query "+<plugin> <distinctive-tool-name>".
  If the expected MCP tool is not returned: state = OFFLINE. Skip to
  Step 4.

Step 2: Credential source probe (non-authoritative)
  Report whether the credential is set via shell env vs userConfig vs
  neither. Useful UX but not part of the HEALTHY/DEGRADED decision —
  MCP visibility in Step 1 is the authoritative signal that a credential
  is configured and accepted.

Step 3: Upstream API probe (HEALTHY / DEGRADED)
  If the credential is readable from the shell (shell env var path):
    curl -s -o /dev/null -w '%{http_code}' \
      --connect-timeout 5 --max-time 8 \
      -H "Authorization: Bearer ${<PLUGIN>_TOKEN}" \
      <minimal health endpoint>
    200 → HEALTHY
    401/403 → DEGRADED (credential invalid or revoked)
    429 → DEGRADED (rate limit)
    other non-200 / curl exit != 0 → DEGRADED (network or upstream fault)

  If the credential lives only in userConfig and is not readable from
  the shell: skip the API probe. The MCP server authenticated at startup;
  if the credential were bad the tools would be absent (OFFLINE). Treat
  "skipped" as HEALTHY for classification purposes.

Step 4: Report with next steps
  Print a short state banner plus a "What to do" block tailored to the
  state. Examples:
    OFFLINE:   point at /<plugin>:setup; suggest disable+enable plugin
               cycle to fire the userConfig prompt; reference
               known Claude Code quirks (issue #39827).
    DEGRADED:  401 → re-enter token; 429 → wait / upgrade plan; other →
               check upstream status page.
    HEALTHY:   nothing to do. Optionally surface rate-limit / credit
               remaining if the upstream exposes it.
```

### Classification table

| MCP tools | API probe                | Startup validates credential? | State              |
| --------- | ------------------------ | ----------------------------- | ------------------ |
| not loaded| (not run)                | n/a                           | OFFLINE            |
| loaded    | 200                      | n/a                           | HEALTHY            |
| loaded    | skipped (userConfig-only)| yes (e.g., perplexity)        | HEALTHY            |
| loaded    | skipped (userConfig-only)| no  (e.g., exa, tavily)       | PRESENT (untested) |
| loaded    | 401 / 403 / 429 / error  | n/a                           | DEGRADED           |

The "Startup validates credential?" column captures whether the MCP server
hard-fails at startup when the credential is missing or invalid (so tool
visibility is itself a credential-validation signal). MCPs that defer
validation to first tool invocation (exa @ 3.1.8, tavily @ 0.2.17 at the
time of writing) should report `PRESENT (untested)` rather than HEALTHY
when the API probe is skipped — the credential is stored but unverified.

### Why this shape

- **ToolSearch is the authoritative liveness signal.** Checking for a shell
  env var or grepping `~/.claude/settings.json` for a userConfig key both
  report "config is present" but not "MCP actually started." Only
  `ToolSearch` sees whether tools are registered with the current session.
- **Separate "reachable" from "authenticated."** Upstream API probes
  conflate the two — a 401 means reachable but bad credential. Keeping
  the states distinct tells the user whether to check their network or
  their token.
- **Skip-probe is HEALTHY, not DEGRADED — but only when MCP startup
  validates the credential.** This rule applies to MCP servers that
  reject a missing or invalid credential at startup, so tool visibility
  implies a valid credential (e.g., perplexity hard-fails at startup).
  For MCP servers that start without credential validation and only
  fail at tool invocation (e.g., exa, tavily), tool visibility does
  NOT imply authentication; treat skip-probe as `PRESENT (untested)`
  rather than HEALTHY. Document the per-MCP behavior inline in the
  status command.

### Reference implementation

`plugins/yellow-morph/commands/morph/status.md` is the canonical
implementation. Other `:status` commands adopting this pattern should
match its structure (steps, states, reporting format) so users see a
consistent surface across plugins.

### Anti-patterns

- **Do not** treat "shell env var set" as HEALTHY without checking MCP
  tool visibility. The MCP may have crashed at startup despite the env
  var being present.
- **Do not** run the API probe before the tool-visibility check. If the
  server is OFFLINE, the probe wastes network time and may burn a rate-
  limited API call.
- **Do not** omit the "What to do" block — a state without an action is
  a dead-end for the user. Every state should have at least one concrete
  next step.
- **Do not** invent a fourth state ("INITIALIZING", "UNKNOWN"). The
  three-state surface is deliberately simple; if a probe is ambiguous,
  report DEGRADED with the ambiguity in the "What to do" block.
