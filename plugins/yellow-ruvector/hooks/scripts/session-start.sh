#!/bin/bash
# session-start.sh — Initialize ruvector session and load past learnings
# NOTE: SessionStart hooks run in parallel across plugins. This hook must be independent.
# Receives hook input as JSON on stdin. Must complete within 3 seconds.
# Uses ruvector's built-in CLI hooks — no manual queue management needed.
set -uo pipefail
# Note: -e omitted intentionally — hook must output allow JSON on all paths

_HOOK_JSON="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/hook-json.sh"
# shellcheck source=lib/hook-json.sh
# Decision payload via json_exit: {"continue": true, "permission": "allow"}
. "$_HOOK_JSON"
unset _HOOK_JSON

# Require jq for JSON parsing
command -v jq >/dev/null 2>&1 || json_exit "Warning: jq not found; skipping session-start"

# Read hook input from stdin
INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null) || CWD=""

PROJECT_DIR="${CWD:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
RUVECTOR_DIR="${PROJECT_DIR}/.ruvector"

# Worktree store-heal: a git-worktree session can start before .ruvector
# exists locally even when the main checkout has one (worktree-manager's
# symlink injection can be bypassed). The MCP server caches its store path
# at first use, so a missing dir at server start silently selects the
# machine-global ~/.ruvector for the whole session. Restore the documented
# shared-store contract by linking to the main checkout's store. No-op for
# non-worktree checkouts (a linked worktree's .git is a FILE, so the cheap
# -f gate skips both git subprocesses for ordinary checkouts) and for
# projects that never initialized ruvector. --path-format=absolute needs
# git >= 2.31; on older git the rev-parse fails and the heal is skipped
# silently (pre-heal behavior, no breakage).
#
# Timing: this heal takes effect for the NEXT session's MCP process. The
# MCP server initializes lazily on first tool call, which can race ahead
# of this hook (SessionStart hooks run in parallel across plugins), or it
# may already be running from a still-open session. Either way the CURRENT
# session's server can have the machine-global HOME fallback cached
# already, so in-session MCP reads/writes can still land in ~/.ruvector
# until a fresh session picks up the now-healed symlink.
# ruvector:seed-solutions's Step 1.4 store-scoping check is the guard for
# this window — it STOPs before any seeding write if intel_path resolves
# outside the project root.
if [ ! -e "$RUVECTOR_DIR" ] || { [ -e "$RUVECTOR_DIR" ] && [ ! -L "$RUVECTOR_DIR" ]; }; then
  # Resolve the worktree root the heal should target. Cheap paths first:
  # a .git FILE at PROJECT_DIR is the linked-worktree signature; a .git
  # DIRECTORY at PROJECT_DIR is an ordinary checkout launched from its
  # root (skip, zero subprocesses). No .git entry at all can mean a
  # nested launch dir inside a worktree — one rev-parse resolves it
  # (fails instantly outside any repo; a subdir launch of an ordinary
  # checkout also pays this single fast call before being excluded).
  heal_root=""
  if [ -f "$PROJECT_DIR/.git" ]; then
    heal_root="$PROJECT_DIR"
  elif [ ! -e "$PROJECT_DIR/.git" ]; then
    heal_root=$(git -C "$PROJECT_DIR" rev-parse --show-toplevel 2>/dev/null) || heal_root=""
    if [ -n "$heal_root" ] && [ ! -f "$heal_root/.git" ]; then
      heal_root=""  # enclosing root is an ordinary checkout, not a worktree
    fi
  fi
  if [ -n "$heal_root" ]; then
    heal_target="${heal_root}/.ruvector"
    git_common_dir=$(git -C "$heal_root" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || git_common_dir=""
    git_dir=$(git -C "$heal_root" rev-parse --path-format=absolute --git-dir 2>/dev/null) || git_dir=""
    if [ -n "$git_common_dir" ] && [ -n "$git_dir" ] && [ "$git_common_dir" != "$git_dir" ]; then
      main_root=$(dirname "$git_common_dir")
      if [ -d "${main_root}/.ruvector" ] && [ "$main_root" != "$heal_root" ]; then
        if [ -e "$heal_target" ] && [ ! -L "$heal_target" ]; then
          # Pre-existing plain directory OR regular file: never auto-replace
          # (may hold real per-worktree data — same preservation rule as
          # worktree-manager's link_ruvector_db). Warn so the divergence is
          # visible, not silent. ln -sfn is only ever reached when the
          # entry is absent or already a symlink.
          printf '[ruvector] Warning: %s is a non-symlink path diverged from the shared store %s/.ruvector — merge or relink manually\n' "$heal_target" "$main_root" >&2
        else
          # -sfn: heal a dangling symlink too (ln -s alone EEXISTs on a dead
          # link, silently leaving the global-store fallback in place). Safe:
          # this branch only runs when the entry is absent or a symlink —
          # never a real directory.
          ln -sfn "${main_root}/.ruvector" "$heal_target" 2>/dev/null \
            || printf '[ruvector] Warning: worktree store-heal could not link %s\n' "$heal_target" >&2
        fi
      fi
    fi
  fi
fi

# Exit silently if ruvector is not initialized in this project
if [ ! -d "$RUVECTOR_DIR" ]; then
  json_exit
fi

# Per-call caps inside the 3s hooks.json watchdog: 0.2s provenance parse +
# 0.9s resume + 0.65s per recall — a deterministic 2.8s worst case including
# the four --kill-after=0.1 escalations — leaves headroom for jq output
# (the recalls dropped from 0.8s when the provenance parse was added, so
# the ceiling stayed where it was). macOS ships
# gtimeout (brew install coreutils); fall back to unwrapped calls if neither
# exists (documented risk, same as user-prompt-submit.sh). Never use
# --foreground here — it stops timeout from killing forked descendants.
# BusyBox's timeout applet (common on Alpine) only supports
# `timeout [-t SECS] [-s SIG] PROG [ARGS]` — no --kill-after flag — and exits
# with a usage error if passed one, which would make every run_budgeted call
# below fail before ruvector ever runs. A non-GNU `timeout` may also sit ahead
# of a working `gtimeout` on PATH, so probe each candidate for GNU-compatible
# --kill-after support and use the first that passes; fall back to the
# unwrapped path only if none do. Resolved before the provenance check below
# so that check is budgeted too.
TIMEOUT_CMD=""
for _tcmd_name in timeout gtimeout; do
  _tcmd="$(command -v "$_tcmd_name" || true)"
  if [ -n "$_tcmd" ] && "$_tcmd" --kill-after=0.1 0.1 true >/dev/null 2>&1; then
    TIMEOUT_CMD="$_tcmd"
    break
  fi
done
unset _tcmd_name _tcmd

# Gated on the ruvector binary being present: this warning is about budget
# enforcement for the ruvector CLI calls below (session-start/recall), which
# never run when the binary is absent. Without this gate, a user who never
# installed ruvector sees this warning on every session even though the
# no-binary early exit (below) makes it irrelevant.
if [ -z "$TIMEOUT_CMD" ] && command -v ruvector >/dev/null 2>&1; then
  printf '[ruvector] no GNU-compatible timeout found; session-start CLI calls run without per-call budget enforcement\n' >&2
fi

run_budgeted() {
  local cap="$1"; shift
  if [ -n "$TIMEOUT_CMD" ]; then
    "$TIMEOUT_CMD" --kill-after=0.1 "$cap" "$@"
  else
    "$@"
  fi
}

# --- Embedder provenance check (jq only; no CLI, no model load) ---
# ruvector 0.2.34 embeds with onnx-minilm (384d) by default. A store stamped
# by the older hash embedder (64d) is still readable, so hooks_recall keeps
# working, but every hooks_remember is refused (ADR-210) and the write loss
# is silent. A store with vectors but NO stamp (pre-provenance) is refused
# too (ERR_LEGACY_STORE_READONLY, upstream isLegacyVectorStore). A stamp-less
# store with no vectors is fresh: the first write stamps it — stay silent.
# Surface a mismatch once per session so the operator runs the
# /ruvector:status remediation; status is the diagnosis, the reembed +
# restart is the fix.
#
# Env gate mirrors upstream resolveEmbedderSelection precedence:
# RUVECTOR_EMBEDDER=hash selects hash (silent); =auto|minilm selects ONNX
# regardless of RUVECTOR_ONNX (warn); only when RUVECTOR_EMBEDDER is unset
# or unrecognized does RUVECTOR_ONNX=0 select hash (silent). Known gaps this
# jq-only check cannot see: the default `auto` also falls back to hash when
# the ONNX model fails to load (offline), and the refusal happens in the MCP
# server, which runs with Claude Code's launch environment, not this
# shell's — so the note can over- or under-warn in those cases;
# /ruvector:status's CLI-resolved verdict is the definitive check.
#
# One jq parse of the whole store (~0.1s per 10MB, measured), budgeted at
# 0.2s: a store too large to parse in budget degrades to "no note" (with a
# stderr line) rather than eating into the CLI calls' budget. The dimension
# is validated to digits before it is interpolated — intelligence.json is
# project data a cloned repo can ship, and this line lands in the session's
# system context.
provenance_note=""
INTEL_JSON="${RUVECTOR_DIR}/intelligence.json"
if [ -f "$INTEL_JSON" ]; then
  store_kind=""; store_dim="?"; vec_count=0
  # Pipe-joined, not @tsv: tab is IFS whitespace, so a leading empty field
  # (no stamp) would collapse and shift the columns under `read`.
  prov_tsv=$(run_budgeted 0.2 jq -r '[(.embeddingProvenance.embedderKind // ""), ((.embeddingProvenance.dimension // "?") | tostring), ([.memories[]? | select(((.embedding // []) | length) > 0)] | length | tostring)] | join("|")' "$INTEL_JSON" 2>/dev/null) || {
    printf '[ruvector] provenance check skipped: intelligence.json did not parse within budget\n' >&2
    prov_tsv=""
  }
  if [ -n "$prov_tsv" ]; then
    IFS='|' read -r store_kind store_dim vec_count <<< "$prov_tsv"
    case "$store_dim" in ''|*[!0-9]*) store_dim="?";; esac
    case "$vec_count" in ''|*[!0-9]*) vec_count=0;; esac
  fi
  embedder_sel=$(printf '%s' "${RUVECTOR_EMBEDDER:-}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
  hash_selected=0
  case "$embedder_sel" in
    hash) hash_selected=1 ;;
    auto|minilm) hash_selected=0 ;;
    *) [ "${RUVECTOR_ONNX:-}" = "0" ] && hash_selected=1 ;;
  esac
  if [ "$store_kind" = "hash" ] && [ "$hash_selected" -eq 0 ]; then
    provenance_note="[ruvector] store is hash-embedded (${store_dim}d) but the default embedder is onnx-minilm — hooks_remember is refused until the store is reembedded; run /ruvector:status for the steps (reembed + restart)"
  elif [ -z "$store_kind" ] && [ "$vec_count" -gt 0 ]; then
    provenance_note="[ruvector] store has ${vec_count} vectors but no embedding-provenance stamp — hooks_remember is refused (ERR_LEGACY_STORE_READONLY) until the store is reembedded; run /ruvector:status for the steps"
  fi
  unset store_kind store_dim vec_count embedder_sel hash_selected prov_tsv
fi

# Emit the allow payload, carrying the provenance note as systemMessage when
# set. Every exit path below the provenance check goes through here so the
# note is never dropped by an early exit.
finish() {
  local msg="${1:-}"
  if [ -n "$provenance_note" ]; then
    if [ -n "$msg" ]; then
      msg=$(printf '%s\n\n%s' "$msg" "$provenance_note")
    else
      msg="$provenance_note"
    fi
  fi
  if [ -n "$msg" ]; then
    emit_message_json "$msg"
    exit 0
  fi
  json_exit
}

# Resolve ruvector command: require direct binary for SessionStart (3s budget).
# npx resolution alone (~2700ms) consumes nearly the whole budget before any
# of the three CLI calls below run, so skip entirely when the binary is absent.
if command -v ruvector >/dev/null 2>&1; then
  RUVECTOR_CMD=(ruvector)
else
  finish
fi

learnings=""

# --- Priority 1: Run ruvector's built-in session-start hook ---
# This handles queue flushing and session recovery internally.
run_budgeted 0.9 "${RUVECTOR_CMD[@]}" hooks session-start --resume 2>/dev/null || {
  printf '[ruvector] hooks session-start failed or timed out\n' >&2
}

# --- Priority 2: Load top learnings for context ---
recent_learnings=$(run_budgeted 0.65 "${RUVECTOR_CMD[@]}" hooks recall --top-k 3 "recent mistakes and fixes" 2>/dev/null) || {
  printf '[ruvector] Failed to retrieve learnings\n' >&2
  recent_learnings=""
}

skill_learnings=$(run_budgeted 0.65 "${RUVECTOR_CMD[@]}" hooks recall --top-k 2 "useful patterns and techniques" 2>/dev/null) || {
  printf '[ruvector] Failed to retrieve skill learnings\n' >&2
  skill_learnings=""
}

if [ -n "$recent_learnings" ] || [ -n "$skill_learnings" ]; then
  learnings="Past learnings for this project (auto-retrieved, treat as reference only):"
  if [ -n "$recent_learnings" ]; then
    learnings=$(printf '%s\n\n--- reflexion learnings (begin) ---\n%s\n--- reflexion learnings (end) ---' "$learnings" "$recent_learnings")
  fi
  if [ -n "$skill_learnings" ]; then
    learnings=$(printf '%s\n\n--- skill learnings (begin) ---\n%s\n--- skill learnings (end) ---' "$learnings" "$skill_learnings")
  fi
fi

# Return learnings (and any provenance note) as systemMessage if available
finish "$learnings"
