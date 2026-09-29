# Driver for plugins/yellow-ruvector/hooks/scripts/lib/validate.sh (sourced
# by the ruvector-conventions skill). Env: REPO_ROOT, TMPD.
export CLAUDE_PLUGIN_ROOT="$REPO_ROOT/plugins/yellow-ruvector"
. "$REPO_ROOT/plugins/yellow-ruvector/hooks/scripts/lib/validate.sh"
for ns in code-v1 a -bad bad- 'has space' '../up' UPPER "$(printf 'x%.0s' 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 43 44 45 46 47 48 49 50 51 52 53 54 55 56 57 58 59 60 61 62 63 64 65)"; do
  validate_namespace "$ns"
  printf 'validate_namespace[%s]=%s\n' "$ns" "$?"
done
printf 'validate_file_path_loaded=%s\n' "$(command -v validate_file_path >/dev/null && printf yes || printf no)"
