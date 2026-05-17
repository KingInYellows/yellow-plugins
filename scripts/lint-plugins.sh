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

# Note: -e omitted intentionally — checks accumulate errors and report a
# summary at the end. With -e, any non-match grep would abort the entire
# loop before subsequent files are checked.
set -uo pipefail

command -v git >/dev/null 2>&1 || {
  printf '[lint-plugins] Error: git not found in PATH\n' >&2
  exit 1
}
ROOT="$(git rev-parse --show-toplevel 2>&1)" || {
  printf '[lint-plugins] Error: %s\n' "$ROOT" >&2
  exit 1
}
cd "$ROOT" || exit 1

errors=0
warnings=0

# When run inside GitHub Actions, also emit native ::warning::/::error::
# annotations so findings surface in the PR UI instead of being buried in raw
# job logs. Annotations go to stdout (where GitHub parses them); the human-
# readable [lint-plugins] line continues to go to stderr unchanged.
#
# GitHub's workflow-command parser requires %, CR, and LF in the message
# body to be URL-encoded, otherwise the annotation is truncated or malformed.
# File paths get the same treatment for safety.
ga_escape() {
  printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/\r/%0D/g' | awk 'BEGIN{ORS=""} {if(NR>1) printf "%%0A"; print}'
}

emit_annotation() {
  # $1=level (warning|error), $2=message
  local level="$1" msg="$2" file escaped_file escaped_msg
  [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
  # grep -o returns 1 with no match; under set -e that would abort the script.
  # Tolerate misses and let $file stay empty so we fall through to the
  # unanchored annotation form below.
  file=$(printf '%s' "$msg" | grep -oE 'plugins/[A-Za-z0-9._/-]+\.md' | head -1 || true)
  escaped_msg=$(ga_escape "$msg")
  if [ -n "$file" ]; then
    escaped_file=$(ga_escape "$file")
    printf '::%s file=%s::%s\n' "$level" "$escaped_file" "$escaped_msg"
  else
    printf '::%s::%s\n' "$level" "$escaped_msg"
  fi
}

err() {
  printf '[lint-plugins] ERROR: %s\n' "$*" >&2
  emit_annotation error "$*"
  errors=$((errors + 1))
}
warn() {
  printf '[lint-plugins] WARN:  %s\n' "$*" >&2
  emit_annotation warning "$*"
  warnings=$((warnings + 1))
}

# Extract frontmatter (between first --- and second ---) for a given file.
# `\r?` tolerates CRLF endings on files newly authored from WSL2 — the repo
# normalizes to LF on commit but a fresh file may slip through pre-commit.
frontmatter() {
  awk 'BEGIN{c=0} /^---\r?$/{c++; if(c==2)exit; next} c==1{print}' "$1"
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

# Check that every skill referenced in an agent's frontmatter `skills:` list
# resolves to a known SKILL.md name. Reports misses via err() (increments the
# global error counter). $1 = newline-separated known skill names.
check_skill_references() {
  local known_skills="$1"
  local f fm in_skills name bare line inline_body _item _bare
  local -a _items
  while IFS= read -r f; do
    fm=$(frontmatter "$f")
    # Extract lines like "  - skill-name" under a "skills:" key.
    # State machine: in_skills=1 between "skills:" and the next top-level key.
    # Resets in_skills on any line starting with [a-zA-Z] (a new top-level key).
    in_skills=0
    name=""
    bare=""
    # Match list items under skills: tolerating 2 or 4 space indent (the two
    # YAML styles used across this repo). Matching ANY leading whitespace
    # would break the in_skills state machine because top-level keys are
    # column-zero, but list items are indented — so we explicitly enumerate
    # the accepted prefixes.
    while IFS= read -r line; do
      case "$line" in
        skills:*)
          in_skills=1
          # Inline flow-sequence form: `skills: [foo, bar]` on a single line.
          # The block-sequence state machine below never sees these items, so
          # extract them here. Detect by the presence of a `[` after `skills:`.
          inline_body=$(printf '%s' "$line" | sed -E 's/^skills:[[:space:]]*\[//; s/\][[:space:]]*$//')
          if [ "$inline_body" != "$line" ]; then
            IFS=',' read -ra _items <<< "$inline_body"
            for _item in "${_items[@]}"; do
              _bare=$(printf '%s' "$_item" | sed -E 's/^[[:space:]]+|[[:space:]]+$//g')
              _bare=${_bare##*:}
              if [ -n "$_bare" ] && ! printf '%s\n' "$known_skills" | grep -qxF "$_bare"; then
                err "agent $f references unknown skill (inline): $_bare"
              fi
            done
            in_skills=0
          fi
          ;;
        "  - "*|"    - "*)
          if [ "$in_skills" = 1 ]; then
            name=$(printf '%s' "$line" | sed -E 's/^[[:space:]]+- //')
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
}

if [ -n "$known_skills" ]; then
  check_skill_references "$known_skills"
fi

# --- Summary ---
printf '\n[lint-plugins] Summary: %d error(s), %d warning(s)\n' "$errors" "$warnings"
if [ "$errors" -gt 0 ]; then
  exit 1
fi
exit 0
