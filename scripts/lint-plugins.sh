#!/usr/bin/env bash
# lint-plugins.sh — lightweight frontmatter and convention checks for all plugins
#
# Scope: frontmatter completeness (name, description, model where applicable),
# known mistakes (memory: true → memory: <scope>), and skill reference sanity.
# Runs alongside pnpm validate:schemas; this script catches style / convention
# issues that the JSON schema cannot enforce.
#
# Exit codes:
#   0 — all checks pass
#   1 — violations found

set -euo pipefail

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$ROOT" ]; then
  printf '[lint-plugins] Error: not in a git repository\n' >&2
  exit 1
fi
cd "$ROOT" || exit 1

errors=0
warnings=0

err() {
  printf '[lint-plugins] ERROR: %s\n' "$*" >&2
  errors=$((errors + 1))
}
warn() {
  printf '[lint-plugins] WARN:  %s\n' "$*" >&2
  warnings=$((warnings + 1))
}

# Extract frontmatter (between first --- and second ---) for a given file.
frontmatter() {
  awk 'BEGIN{c=0} /^---$/{c++; if(c==2)exit; next} c==1{print}' "$1"
}

# --- Check 1: every agent has name + description + tools ---
while IFS= read -r f; do
  fm=$(frontmatter "$f")
  if ! printf '%s' "$fm" | grep -q '^name:'; then
    err "agent missing 'name:' frontmatter: $f"
  fi
  if ! printf '%s' "$fm" | grep -q '^description:'; then
    err "agent missing 'description:' frontmatter: $f"
  fi
  if ! printf '%s' "$fm" | grep -q '^tools:'; then
    err "agent missing required 'tools:' allowlist (note: commands use 'allowed-tools:' — different key): $f"
  fi
done < <(find plugins -type f -path '*/agents/*.md')

# --- Check 2: memory: true is the wrong form (should be a scope string) ---
# Scope to the frontmatter block (between first --- and second ---) so that a
# `memory: true` line appearing in markdown body (code examples, prose) does
# not trigger a false positive. Same convention as Check 1 and Check 3.
while IFS= read -r f; do
  fm=$(frontmatter "$f")
  if printf '%s' "$fm" | grep -qE '^memory:[[:space:]]*true[[:space:]]*$'; then
    warn "'memory: true' is likely a no-op — use memory: user|project|local: $f"
  fi
done < <(find plugins -type f \( -path '*/agents/*.md' -o -path '*/commands/*.md' \))

# --- Check 3: skill references in frontmatter resolve to an existing SKILL.md ---
# Collect known skill names from the repo. Scope name extraction to the
# frontmatter block (between first --- and second ---) to avoid picking up
# stray "name:" lines in skill body prose.
known_skills=""
while IFS= read -r skill_file; do
  skill_fm=$(frontmatter "$skill_file")
  skill_name=$(printf '%s\n' "$skill_fm" | awk '/^name:/{sub(/^name:[ \t]*/, ""); print; exit}')
  if [ -n "$skill_name" ]; then
    known_skills+="$skill_name"$'\n'
  fi
done < <(find plugins -type f -name SKILL.md)
known_skills=$(printf '%s' "$known_skills" | sort -u)
if [ -z "$known_skills" ]; then
  warn "no SKILL.md files discovered — skipping skill-reference check"
fi

if [ -n "$known_skills" ]; then
  while IFS= read -r f; do
    fm=$(frontmatter "$f")
    # Extract lines like "  - skill-name" under a "skills:" key.
    # State-machine assumes skills: appears before tools: (current convention).
    in_skills=0
    name=""
    bare=""
    while IFS= read -r line; do
      case "$line" in
        skills:*) in_skills=1 ;;
        "  - "*)
          if [ "$in_skills" = 1 ]; then
            name=${line#"  - "}
            # Strip possible plugin namespace prefix (yellow-core:foo → foo)
            bare=${name##*:}
            if ! printf '%s\n' "$known_skills" | grep -qxF "$bare"; then
              err "agent $f references unknown skill: $name"
            fi
          fi
          ;;
        [a-zA-Z]*) in_skills=0 ;;
      esac
    done < <(printf '%s\n' "$fm")
  done < <(find plugins -type f -path '*/agents/*.md')
fi

# --- Summary ---
printf '\n[lint-plugins] Summary: %d error(s), %d warning(s)\n' "$errors" "$warnings"
if [ "$errors" -gt 0 ]; then
  exit 1
fi
exit 0
