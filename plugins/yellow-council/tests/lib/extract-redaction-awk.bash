#!/usr/bin/env bash
# Extract the live credential-redaction awk program from the markdown files
# that ship it.
#
# The awk program is authored inline in three places (see REDACTION_SOURCES
# below). Tests MUST run the extracted program rather than a copy pasted into
# the test tree: a copy drifts silently the moment one of the sources is
# edited, and a redaction bug that only exists in the shipped file but not in
# the tested copy is exactly the failure this suite is here to prevent.
#
# Two source shapes exist:
#   - agents/review/*.md  — a raw `awk '` … `' "$SOMETHING_FILE" > …` command
#   - skills/**/SKILL.md  — the same program inside a ```awk fenced block

# Repo-relative paths of every file carrying a copy of the program. Adding a
# fourth copy without adding it here means it is never tested — the sync test
# in redaction.bats is what makes that omission visible.
REDACTION_SOURCES=(
  "plugins/yellow-council/agents/review/gemini-reviewer.md"
  "plugins/yellow-council/agents/review/opencode-reviewer.md"
  "plugins/yellow-council/skills/council-patterns/SKILL.md"
)

# extract_redaction_awk <file> — print the awk program on stdout.
extract_redaction_awk() {
  local file="$1"
  case "$file" in
    *SKILL.md)
      awk '/^```awk$/ { f = 1; next } f && /^```$/ { exit } f' "$file"
      ;;
    *)
      # Body runs from the line after a bare `awk '` opener up to the line
      # that closes the quote and redirects to the redacted file.
      awk "/^awk '\$/ { f = 1; next } f && /^' \"\\\$[A-Z_]*FILE\" >/ { exit } f" "$file"
      ;;
  esac
}

# repo_root — absolute path to the repository root, from this file's location.
repo_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd
}
