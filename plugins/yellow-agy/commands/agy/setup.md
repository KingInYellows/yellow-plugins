---
name: agy:setup
# prettier-ignore
description: "Check that the Antigravity CLI (agy) is installed, new enough, signed in on the Google AI Pro subscription with no API-key or Vertex variables, and has overages off. Use after installing yellow-agy or when a delegate refuses with an AGY_* setup code."
argument-hint: ''
allowed-tools:
  - Bash
---

# Set Up yellow-agy

yellow-agy runs the unmodified `agy` binary on this machine under the owner's
own Google AI Pro sign-in. It never uses an API key, Vertex AI or AI-credit
overages. This command only reads: it never runs a model turn, never touches
agy's credential files, and writes nothing.

agy can live on `PATH` (Linux, macOS, inside WSL) or only inside a WSL distro on
Windows. Set `YELLOW_AGY_WSL_DISTRO` to pick a distro; otherwise the default
distro is used.

## Workflow

### Step 1: Check Prerequisites

Run a single Bash call:

```bash
_agy_floor=1.4.11
_agy_vars='GEMINI_API_KEY GOOGLE_API_KEY GOOGLE_GENAI_USE_VERTEXAI GOOGLE_CLOUD_PROJECT GOOGLE_APPLICATION_CREDENTIALS AGY_ADC_AUTH'
_agy_vars_re='^(GEMINI_API_KEY|GOOGLE_API_KEY|GOOGLE_GENAI_USE_VERTEXAI|GOOGLE_CLOUD_PROJECT|GOOGLE_APPLICATION_CREDENTIALS|AGY_ADC_AUTH)='
_agy_distro=${YELLOW_AGY_WSL_DISTRO:-}
# Exec-only bridge: -e never runs the distro's shell, so nothing is re-parsed.
_agy_wsl() {
  if [ -n "$_agy_distro" ]; then
    wsl.exe -d "$_agy_distro" -e "$@"
  else
    wsl.exe -e "$@"
  fi
}

printf '=== agy location ===\n'
_agy_mode=none
if command -v agy >/dev/null 2>&1; then
  _agy_mode=native
  printf 'host:      native (%s)\n' "$(command -v agy)"
elif command -v wsl.exe >/dev/null 2>&1; then
  _agy_path=$(_agy_wsl sh -c 'command -v agy' 2>/dev/null | tr -d '\r')
  if [ -n "$_agy_path" ]; then
    _agy_mode=wsl
    printf 'host:      WSL bridge (%s in %s)\n' "$_agy_path" "${_agy_distro:-default distro}"
  else
    printf 'host:      NOT FOUND (no agy on PATH or in %s)\n' "${_agy_distro:-the default WSL distro}"
  fi
else
  printf 'host:      NOT FOUND (no agy on PATH and no wsl.exe)\n'
fi

printf '\n=== agy version ===\n'
_agy_ver=''
case "$_agy_mode" in
  native) _agy_ver=$(agy --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1) ;;
  wsl)    _agy_ver=$(_agy_wsl agy --version 2>&1 | tr -d '\r' | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1) ;;
esac
if [ "$_agy_mode" = none ]; then
  printf 'version:   SKIPPED\n'
elif [ -z "$_agy_ver" ]; then
  printf 'version:   UNPARSEABLE\n'
else
  _agy_low=$(printf '%s\n%s\n' "$_agy_ver" "$_agy_floor" | sort -V | head -n 1)
  if [ "$_agy_low" = "$_agy_floor" ]; then
    printf 'version:   %s (ok, floor %s)\n' "$_agy_ver" "$_agy_floor"
  else
    printf 'version:   %s TOO OLD (floor %s)\n' "$_agy_ver" "$_agy_floor"
  fi
fi

printf '\n=== Non-subscription auth variables (names only) ===\n'
_agy_hits=''
for _v in $(printf '%s\n' "$_agy_vars"); do
  if [ -n "$(printenv "$_v" 2>/dev/null)" ]; then
    _agy_hits="$_agy_hits $_v"
  fi
done
_agy_hits=${_agy_hits# }
printf 'caller:    %s\n' "${_agy_hits:-none}"
if [ "$_agy_mode" = wsl ]; then
  _agy_wsl_hits=$(_agy_wsl env 2>/dev/null | tr -d '\r' | grep -E "$_agy_vars_re" | cut -d= -f1 | tr '\n' ' ')
  printf 'in WSL:    %s\n' "${_agy_wsl_hits:-none}"
fi

printf '\n=== Global settings (useG1Credits, permissions) ===\n'
_agy_cfg=''
case "$_agy_mode" in
  native) [ -f "$HOME/.gemini/antigravity-cli/settings.json" ] && _agy_cfg=$(cat "$HOME/.gemini/antigravity-cli/settings.json" 2>/dev/null) ;;
  wsl)    _agy_cfg=$(_agy_wsl sh -c 'cat "$HOME/.gemini/antigravity-cli/settings.json"' 2>/dev/null) ;;
esac
if [ "$_agy_mode" = none ]; then
  printf 'settings:  SKIPPED\n'
elif [ -z "$_agy_cfg" ]; then
  printf 'useG1Credits: NO SETTINGS FILE\n'
elif command -v node >/dev/null 2>&1; then
  printf '%s' "$_agy_cfg" | node -e '
    let raw = "";
    process.stdin.on("data", (c) => (raw += c));
    process.stdin.on("end", () => {
      let cfg;
      try { cfg = JSON.parse(raw); } catch { process.stdout.write("useG1Credits: UNPARSEABLE\n"); return; }
      const v = cfg && cfg.useG1Credits;
      process.stdout.write(v === false ? "useG1Credits: false (ok)\n" : v === undefined ? "useG1Credits: NOT SET\n" : "useG1Credits: ON\n");
      const tp = cfg && cfg.toolPermission;
      process.stdout.write(tp === "always-proceed" ? "toolPermission: always-proceed LOOSE\n" : "toolPermission: " + (tp === undefined ? "not set" : String(tp)) + " (ok)\n");
      const nw = cfg && cfg.allowNonWorkspaceAccess;
      process.stdout.write(nw === true ? "allowNonWorkspaceAccess: true LOOSE\n" : "allowNonWorkspaceAccess: " + (nw === undefined ? "not set" : String(nw)) + " (ok)\n");
    });
  '
else
  printf 'useG1Credits: UNKNOWN (node not found)\n'
fi
unset _agy_floor _agy_distro _agy_vars _agy_vars_re _agy_mode _agy_path _agy_ver _agy_low _agy_hits _agy_wsl_hits _agy_cfg _v
unset -f _agy_wsl
```

### Step 2: Interpret Results

Report each finding with its code, and stop at the first one that blocks:

1. **`host: NOT FOUND`** (`AGY_NOT_INSTALLED`): agy is not installed where
   yellow-agy can reach it. Install the Antigravity CLI, then sign in by running
   `agy` once in a terminal with the Google account that holds the AI Pro plan.
   On Windows with agy in a non-default distro, set `YELLOW_AGY_WSL_DISTRO`.
2. **`TOO OLD` or `UNPARSEABLE`** (`AGY_VERSION`): yellow-agy needs agy 1.4.11
   or later, the version its contract was tested on. Update agy.
3. **Any variable listed under `caller` or `in WSL`** (`AGY_AUTH_MODE`): these
   switch agy to API-key or Vertex billing. Name the variables (never their
   values) and ask the owner to remove them from their shell profile, or from
   the distro's environment for the `in WSL` row. Delegates refuse while any is
   set.
4. **`useG1Credits` not `false (ok)`** (`AGY_OVERAGES`): overages are on or not
   pinned off. Ask the owner to set `"useG1Credits": false` in
   `~/.gemini/antigravity-cli/settings.json` (inside WSL on the bridge) by hand.
   Every delegate run also forces it off, but setup requires it.
5. **Any `LOOSE` row** (`AGY_SETTINGS`): `toolPermission: always-proceed` runs
   commands without prompting, and `allowNonWorkspaceAccess: true` lets agy edit
   outside the worktree. Ask the owner to change them in the same file by hand.
   Delegate runs pin both, but setup requires the global values to be no looser
   until the adapter confirms how per-run settings merge.
6. **Ready:** report these facts:
   - agy has no machine-readable auth mode, so confirm once with the owner that
     `agy` is signed in with their Google AI Pro account, and that running
     `/credits` inside `agy` shows 0 AI credits.
   - This release is a scaffold: setup checks only. The delegate commands
     (`delegate`, `approve`, `status`, `collect`) arrive with the adapter;
     `docs/yellow-agy/contract-v0.md` in the yellow-plugins repo is the contract
     they follow.
