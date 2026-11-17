# Driver for plugins/yellow-morph/lib/install-morphmcp.sh (sourced by
# /morph:setup). Never calls the npm install. Env: REPO_ROOT, TMPD.
. "$REPO_ROOT/plugins/yellow-morph/lib/install-morphmcp.sh"
mkdir -p "$TMPD/root" "$TMPD/data"
: >| "$TMPD/root/package-lock.json"
export CLAUDE_PLUGIN_ROOT="$TMPD/root" CLAUDE_PLUGIN_DATA="$TMPD/data"
yellow_morph_validate_paths
printf 'validate_ok=%s\n' "$?"
( CLAUDE_PLUGIN_DATA=/etc; yellow_morph_validate_paths 2>/dev/null; printf 'validate_etc=%s\n' "$?" )
yellow_morph_needs_install
printf 'needs_install=%s\n' "$?"
yellow_morph_acquire_install_lock 1
printf 'lock=%s pid_file=%s\n' "$?" "$([ -s "$CLAUDE_PLUGIN_DATA/.install.lock/pid" ] && printf yes || printf no)"
yellow_morph_acquire_install_lock 1 2>/dev/null
printf 'lock_again=%s\n' "$?"
yellow_morph_release_install_lock
printf 'released=%s\n' "$([ -d "$CLAUDE_PLUGIN_DATA/.install.lock" ] && printf no || printf yes)"
# uutils-style mkdir: a second caller told it created the held lock directory
# still loses on the exclusive pid create.
yellow_morph_acquire_install_lock 1
mkdir() { command mkdir "$@" 2>/dev/null; return 0; }
yellow_morph_acquire_install_lock 1 2>/dev/null
printf 'uutils_lock_again=%s\n' "$?"
unset -f mkdir
yellow_morph_release_install_lock
