#!/bin/bash
# config.sh — Parse .claude/yellow-ruvector.local.md opt-in config
# Uses Node.js for YAML parsing (guaranteed available — ruvector requires it).
# Sources into hook scripts: . "$SCRIPT_DIR/lib/config.sh"
# shellcheck disable=SC2034

# Caller must set PROJECT_DIR and RUVECTOR_DIR before sourcing.
RUVECTOR_CONFIG_FILE="${PROJECT_DIR}/.claude/yellow-ruvector.local.md"
RUVECTOR_CONFIG_CACHE="${RUVECTOR_DIR}/hook-config-cache.json"

load_config() {
  # Fast path: use cached config if fresher than source
  if [ -f "$RUVECTOR_CONFIG_CACHE" ] && [ -f "$RUVECTOR_CONFIG_FILE" ]; then
    if [ "$RUVECTOR_CONFIG_CACHE" -nt "$RUVECTOR_CONFIG_FILE" ]; then
      CONFIG_JSON=$(cat "$RUVECTOR_CONFIG_CACHE")
      return 0
    fi
  fi

  # No config file = all features enabled (default behavior)
  if [ ! -f "$RUVECTOR_CONFIG_FILE" ]; then
    CONFIG_JSON='{}'
    return 0
  fi

  # Slow path: parse YAML frontmatter with Node.js
  CONFIG_JSON=$(node -e "
    const fs = require('fs');
    try {
      const content = fs.readFileSync(process.argv[1], 'utf8');
      const match = content.match(/^---\\n([\\s\\S]*?)\\n---/);
      if (!match) { console.log('{}'); process.exit(0); }
      const lines = match[1].split('\\n');
      const result = {};
      const stack = [result];
      const indents = [0];
      for (const line of lines) {
        if (!line.trim() || line.trim().startsWith('#')) continue;
        const indent = line.search(/\\S/);
        const m = line.trim().match(/^([\\w_]+):\\s*(.*)/);
        if (!m) continue;
        const [, key, val] = m;
        while (indents.length > 1 && indent <= indents[indents.length - 1]) {
          stack.pop(); indents.pop();
        }
        const parent = stack[stack.length - 1];
        if (val === '' || val === undefined) {
          parent[key] = {};
          stack.push(parent[key]);
          indents.push(indent);
        } else if (val === 'true') {
          parent[key] = true;
        } else if (val === 'false') {
          parent[key] = false;
        } else if (/^\\d+$/.test(val)) {
          parent[key] = parseInt(val, 10);
        } else {
          parent[key] = val.replace(/^['\"]|['\"]$/g, '');
        }
      }
      console.log(JSON.stringify(result));
    } catch (e) {
      console.error('[ruvector] Config parse warning:', e.message);
      console.log('{}');
    }
  " "$RUVECTOR_CONFIG_FILE" 2>/dev/null) || CONFIG_JSON='{}'

  # Cache the parsed config
  printf '%s' "$CONFIG_JSON" > "$RUVECTOR_CONFIG_CACHE" 2>/dev/null || true
}

# Check if a feature is enabled (defaults to true if absent)
is_enabled() {
  local path="$1"
  printf '%s' "${CONFIG_JSON:-{}}" | jq -r "$path // true" 2>/dev/null
}
