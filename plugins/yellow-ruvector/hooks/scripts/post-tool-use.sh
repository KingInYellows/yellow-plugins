#!/bin/bash
# post-tool-use.sh — PostToolUse / PostToolUseFailure: prints allow JSON only.
#
# It no longer calls `ruvector hooks post-edit` / `hooks post-command`: in
# ruvector 0.3.3 each call stores a near-empty hash-embedded memory, and on a
# fresh store the first one stamps it hash/64d, after which every
# hooks_remember from the (ONNX) MCP server is refused (ADR-210). Co-edit
# recording without memory writes replaces it in the next change of this
# series.
set -uo pipefail

_HOOK_JSON="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/lib/hook-json.sh"
# shellcheck source=lib/hook-json.sh
. "$_HOOK_JSON"
unset _HOOK_JSON

# Drain stdin so the host never blocks on a full pipe.
cat >/dev/null
json_exit
