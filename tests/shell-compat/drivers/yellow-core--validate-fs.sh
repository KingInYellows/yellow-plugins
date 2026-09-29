# Driver for plugins/yellow-core/lib/validate-fs.sh (sourced by
# yellow-ruvector's validate.sh and the debugging skill). Env: REPO_ROOT, TMPD.
. "$REPO_ROOT/plugins/yellow-core/lib/validate-fs.sh"
mkdir -p "$TMPD/proj/src"
cd "$TMPD/proj" || exit 1
for p in src/a.ts ../etc/passwd /etc/passwd 'src/a b.ts' ''; do
  validate_file_path "$p" "$TMPD/proj" >/dev/null 2>&1
  printf 'validate_file_path[%s]=%s\n' "$p" "$?"
done
canonicalize_project_dir "$TMPD/proj/src/.." >/dev/null 2>&1
printf 'canonicalize_rc=%s\n' "$?"
