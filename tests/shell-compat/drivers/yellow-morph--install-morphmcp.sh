# Driver for plugins/yellow-morph/lib/install-morphmcp.sh (sourced by
# /morph:setup). Never calls the real npm: the install case uses a PATH
# shim that prints its environment. Env: REPO_ROOT, TMPD.
# The CLAUDE_PLUGIN_DATA=/etc override is scoped to its subshell on purpose.
# shellcheck disable=SC2030,SC2031
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
# An empty pid is an owner between its exclusive create and its write: a
# waiter that sees it once does not reclaim it, and only one that still sees
# it a second later does.
mkdir "$CLAUDE_PLUGIN_DATA/.install.lock"
: >| "$CLAUDE_PLUGIN_DATA/.install.lock/pid"
yellow_morph_acquire_install_lock 1 2>/dev/null
printf 'empty_pid_once=%s held=%s\n' "$?" "$([ -d "$CLAUDE_PLUGIN_DATA/.install.lock" ] && printf yes || printf no)"
yellow_morph_acquire_install_lock 3 2>/dev/null
printf 'empty_pid_stale=%s\n' "$?"
yellow_morph_release_install_lock
# A lock whose pid write fails (here: a 0-block file size limit) is given up,
# not held with an empty pid that a waiter would reclaim.
( ulimit -f 0 2>/dev/null; trap '' XFSZ; yellow_morph_acquire_install_lock 1 2>/dev/null; printf 'pid_write_fails=%s left=%s\n' "$?" "$([ -e "$CLAUDE_PLUGIN_DATA/.install.lock" ] && printf yes || printf no)" )
# The npm ci environment keeps proxy, CA and npm config variables, drops
# secrets, and ignores a NAME=value line that is only part of another
# variable's multi-line value.
mkdir -p "$TMPD/shim"
printf '#!/bin/sh\nenv | LC_ALL=C sort\n' >| "$TMPD/shim/npm"
chmod +x "$TMPD/shim/npm"
: >| "$TMPD/root/package.json"
( PATH="$TMPD/shim:$PATH" HTTPS_PROXY=http://proxy.test:3128 \
  NODE_EXTRA_CA_CERTS=/ca/bundle.crt npm_config_cafile=/ca/npm.crt \
  NPM_CONFIG_USERCONFIG=/cfg/npmrc NO_PROXY= MORPH_API_KEY=secret \
  GITHUB_TOKEN=secret MULTI="$(printf 'a\nNPM_CONFIG_FAKE=leak')"
  export PATH HTTPS_PROXY NODE_EXTRA_CA_CERTS npm_config_cafile \
    NPM_CONFIG_USERCONFIG NO_PROXY MORPH_API_KEY GITHUB_TOKEN MULTI
  yellow_morph_do_install >| "$TMPD/npm-env"
  printf 'do_install=%s\n' "$?"
  grep -E '^(HTTPS_PROXY|NODE_EXTRA_CA_CERTS|npm_config_cafile|NPM_CONFIG_USERCONFIG|NO_PROXY|MORPH_API_KEY|GITHUB_TOKEN|MULTI|NPM_CONFIG_FAKE)=' "$TMPD/npm-env" )
