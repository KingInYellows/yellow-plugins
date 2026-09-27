#!/usr/bin/env bash
# remove-legacy-hooks.sh — list, and on request remove, hook entries left in a
# Claude Code settings.json by a past `ruvector hooks init`. They run the
# global ruvector binary (post-edit, post-command, pre-edit, pre-command,
# session-start, session-end) and write edit/command memories that stamp a
# fresh store hash (ADR-210). Only those hook entries are touched; other
# hooks, including git-ai and this plugin's own, are kept.
#
# Usage: remove-legacy-hooks.sh <settings.json>|--user|--project [--apply]
#   <settings.json> must be $HOME/.claude/settings.json or the project's
#   <git toplevel or cwd>/.claude/settings.json (the same allowlist as
#   repair-cursor-pretooluse.sh). The project file arrives with a clone, so
#   it must resolve to the real .claude/settings.json inside the project (a
#   symlinked file or .claude dir is refused); a symlinked user file is
#   followed to its regular-file target.
#   Without --apply: print one "<event>: <command>" line per legacy entry
#   (flattened to one line; the caller fences it as reference-only data).
#   With --apply: also copy the file to a new <file>.bak-XXXXXX (mktemp, so
#   never a pre-planted path) and rewrite the resolved file in place.
# Exit: 0 = entries found (listed or removed), 1 = none, 2 = error.
set -uo pipefail

f="${1:-}"
apply="${2:-}"
command -v jq >/dev/null 2>&1 || { printf 'remove-legacy-hooks: jq is required\n' >&2; exit 2; }
case "$apply" in ''|--apply) ;; *) printf 'usage: remove-legacy-hooks.sh <settings.json>|--user|--project [--apply]\n' >&2; exit 2 ;; esac

resolve_path() {
  realpath -- "$1" 2>/dev/null \
    || node -p 'require("fs").realpathSync(process.argv[1])' "$1" 2>/dev/null
}
root=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
user_settings="${HOME:-/__unset__}/.claude/settings.json"
project_settings="${root}/.claude/settings.json"
# --user / --project select the allowlisted file by name, so callers (the
# /ruvector:setup command) never pass a project-controlled path through the
# model or a shell command line.
# A selected file that does not exist simply has no legacy entries (exit 1);
# an explicit path that does not exist is a caller error (exit 2).
case "$f" in
  --user) f="$user_settings"; [ -f "$f" ] || exit 1 ;;
  --project) f="$project_settings"; [ -f "$f" ] || exit 1 ;;
esac
# Paths can come from the project (a checkout path, a symlink target): every
# path printed here is one line, control characters as spaces and dash runs
# shortened, so none can forge a fence or instruction line in the caller.
disp() { printf '%s' "$1" | LC_ALL=C tr '\000-\037\177' ' ' | sed -E 's/-{3,}/--/g'; }
[ -n "$f" ] && [ -f "$f" ] || { printf 'remove-legacy-hooks: no settings file %s\n' "$(disp "$f")" >&2; exit 2; }
if [ "$f" = "$project_settings" ]; then
  # Checked first: when HOME is the project the two strings are equal, and a
  # cloned .claude symlink must still be refused rather than followed.
  resolved=$(resolve_path "$f") || resolved=""
  resolved_root=$(resolve_path "$root") || resolved_root=""
  if [ -z "$resolved" ] || [ -z "$resolved_root" ] || [ "$resolved" != "${resolved_root}/.claude/settings.json" ]; then
    printf 'remove-legacy-hooks: refusing project settings that resolve outside the project: %s\n' "$(disp "$f")" >&2
    exit 2
  fi
  target="$resolved"
elif [ "$f" = "$user_settings" ]; then
  target=$(resolve_path "$f") || target=""
else
  printf 'remove-legacy-hooks: refusing a settings path outside the allowlist: %s\n' "$(disp "$f")" >&2
  exit 2
fi
[ -n "$target" ] && [ -f "$target" ] && [ ! -L "$target" ] \
  || { printf 'remove-legacy-hooks: not a regular file: %s\n' "$(disp "$f")" >&2; exit 2; }
f="$target"

# Only an actual ruvector invocation: the `ruvector` executable (bare, by
# path, or via npx, optionally @version) in command position (start of the
# command or right after ; & | ( or a newline, optionally behind shell
# keywords and prefixes such as then, do, if, !, {, exec, and after
# VAR=value assignments — never as an argument), followed by
# `hooks <legacy-subcommand>`. `my-ruvector hooks …` or a quoted string that
# merely mentions it is not a match.
re='(^|[;&|\n(])[[:space:]]*((then|do|else|elif|if|while|until|time|exec|command|!|\{)[[:space:]]+)*([A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|]*[[:space:]]+)*(npx +(-y +|--yes +)?)?([^[:space:];&|"'"'"']*/)?ruvector(@[^[:space:]]*)? +hooks +(post-edit|post-command|pre-edit|pre-command|session-start|session-end)([[:space:];&|)}]|$)'

list=$(jq -r --arg re "$re" '
  # Quoted text is an argument, not a command: drop it before matching, so
  # an echo of a single- or double-quoted "x; ruvector hooks post-edit" is
  # not a ruvector invocation (\u0027 is a single quote). A quoted single
  # word in command position ("/usr/local/bin/ruvector" hooks …) IS the
  # executable: unquote it first. A backslash-escaped character (\; \# …) is
  # a literal, never a separator or comment: neutralize it. A shell comment
  # (# at a word start, quotes already gone) runs nothing: drop it to the
  # end of its line. A heredoc body (<<WORD … WORD, any valid delimiter
  # word, quoted or not) is input to the command before it, never commands:
  # drop it first, before newlines count as separators.
  def unquoted:
    # Several heredocs on one command (cat <<A <<B) take their bodies in
    # order; rather than parse them all, such a command is data (fail
    # closed: never listed, never removed).
    if ([scan("(?<!<)<<(?!<)")] | length) > 1 then "" else . end
    # <<- strips leading tabs from the terminator line; plain << requires
    # it unindented (an indented one is still body text to the shell). The
    # rest of the header line (cat <<EOF; next-command) is kept: it runs.
    | gsub("(?<!<)<<-[[:space:]]*[\"\u0027]?(?<t>[^[:space:]\"\u0027;&|<>()]+)[\"\u0027]?(?<rest>[^\\n]*)\\n((.|\\n)*?\\n)??\\t*\\k<t>(?=\\n|$)"; .rest)
    | gsub("(?<!<)<<(?![<-])[[:space:]]*[\"\u0027]?(?<t>[^[:space:]\"\u0027;&|<>()]+)[\"\u0027]?(?<rest>[^\\n]*)\\n((.|\\n)*?\\n)??\\k<t>(?=\\n|$)"; .rest)
    # A heredoc left unparsed (no terminator line) fails closed: the whole
    # command is treated as data, never as a legacy invocation.
    | if test("(?<!<)<<(?!<)-?[[:space:]]*[\"\u0027]?[^[:space:]\"\u0027;&|<>()]") and test("\\n") then "" else . end
    | gsub("(?<p>(^|[;&|\\n(])[[:space:]]*((then|do|else|elif|if|while|until|time|exec|command|!|\\{)[[:space:]]+)*([A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|\"\u0027]*[[:space:]]+)*(npx +(-y +|--yes +)?)?)(\"(?<d>[^\"[:space:];&|$`\\\\]*)\"|\u0027(?<s>[^\u0027[:space:];&|]*)\u0027)"; "\(.p)\(.d // "")\(.s // "")")
    | gsub("\u0027[^\u0027]*\u0027"; "")
    # A double-quoted span is text, except command substitutions inside it,
    # which run: keep each $(...) / `...` body as its own command.
    | gsub("\"(?<b>([^\"\\\\]|\\\\.)*)\""; .b | [scan("\\$\\(([^()]*)\\)|`([^`]*)`") | map(select(. != null)) | .[0]] | map("; " + . + ";") | join(""))
    | gsub("\\\\(.|\n)"; "_") | gsub("(?<![^[:space:];&|])#[^\n]*"; "");
  (.hooks // {}) | if type == "object" then to_entries[] else empty end
  | .key as $e | (.value | if type == "array" then .[] else empty end)
  | (.hooks | if type == "array" then .[] else empty end)
  | select((.command // "" | tostring | unquoted) | test($re))
  # Commands come from a settings file (a cloned project ships one): print
  # each on one line, control characters as spaces, dash runs shortened, so
  # the listing can never forge a fence line in the caller.
  | "\($e): \(.command | tostring | gsub("[[:cntrl:]]"; " ") | gsub("-{3,}"; "--"))"' "$f" 2>/dev/null) || { printf 'remove-legacy-hooks: %s is not valid JSON\n' "$(disp "$f")" >&2; exit 2; }
[ -n "$list" ] || exit 1
printf '%s\n' "$list"
[ "$apply" = --apply ] || exit 0

tmp=$(mktemp "${TMPDIR:-/tmp}/rv-settings.XXXXXX") || exit 2
trap 'rm -f "$tmp"' EXIT
jq --arg re "$re" '
  def unquoted:
    # Several heredocs on one command (cat <<A <<B) take their bodies in
    # order; rather than parse them all, such a command is data (fail
    # closed: never listed, never removed).
    if ([scan("(?<!<)<<(?!<)")] | length) > 1 then "" else . end
    # <<- strips leading tabs from the terminator line; plain << requires
    # it unindented (an indented one is still body text to the shell). The
    # rest of the header line (cat <<EOF; next-command) is kept: it runs.
    | gsub("(?<!<)<<-[[:space:]]*[\"\u0027]?(?<t>[^[:space:]\"\u0027;&|<>()]+)[\"\u0027]?(?<rest>[^\\n]*)\\n((.|\\n)*?\\n)??\\t*\\k<t>(?=\\n|$)"; .rest)
    | gsub("(?<!<)<<(?![<-])[[:space:]]*[\"\u0027]?(?<t>[^[:space:]\"\u0027;&|<>()]+)[\"\u0027]?(?<rest>[^\\n]*)\\n((.|\\n)*?\\n)??\\k<t>(?=\\n|$)"; .rest)
    # A heredoc left unparsed (no terminator line) fails closed: the whole
    # command is treated as data, never as a legacy invocation.
    | if test("(?<!<)<<(?!<)-?[[:space:]]*[\"\u0027]?[^[:space:]\"\u0027;&|<>()]") and test("\\n") then "" else . end
    | gsub("(?<p>(^|[;&|\\n(])[[:space:]]*((then|do|else|elif|if|while|until|time|exec|command|!|\\{)[[:space:]]+)*([A-Za-z_][A-Za-z0-9_]*=[^[:space:];&|\"\u0027]*[[:space:]]+)*(npx +(-y +|--yes +)?)?)(\"(?<d>[^\"[:space:];&|$`\\\\]*)\"|\u0027(?<s>[^\u0027[:space:];&|]*)\u0027)"; "\(.p)\(.d // "")\(.s // "")")
    | gsub("\u0027[^\u0027]*\u0027"; "")
    # A double-quoted span is text, except command substitutions inside it,
    # which run: keep each $(...) / `...` body as its own command.
    | gsub("\"(?<b>([^\"\\\\]|\\\\.)*)\""; .b | [scan("\\$\\(([^()]*)\\)|`([^`]*)`") | map(select(. != null)) | .[0]] | map("; " + . + ";") | join(""))
    | gsub("\\\\(.|\n)"; "_") | gsub("(?<![^[:space:];&|])#[^\n]*"; "");
  if (.hooks | type) == "object" then
    .hooks |= (with_entries(.value |= (if type == "array" then
        map(if (.hooks | type) == "array"
            then .hooks |= map(select((.command // "" | tostring | unquoted) | test($re) | not))
            else . end)
        | map(select((.hooks | type) != "array" or (.hooks | length) > 0))
      else . end))
      | with_entries(select((.value | type) != "array" or (.value | length) > 0)))
  else . end' "$f" > "$tmp" || exit 2
[ -s "$tmp" ] || exit 2
backup=$(mktemp "${f}.bak-XXXXXX") || exit 2
cat -- "$f" > "$backup" || exit 2
cat "$tmp" > "$f" || { printf 'remove-legacy-hooks: could not rewrite %s (backup kept at %s)\n' "$(disp "$f")" "$(disp "$backup")" >&2; exit 2; }
# Only the backup's own name (settings.json.bak-XXXXXX, safe characters):
# it sits next to the settings file.
printf 'removed; backup %s kept next to the settings file\n' "$(disp "${backup##*/}")"
exit 0
