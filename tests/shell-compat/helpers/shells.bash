# shells.bash — shell profiles for the bash/zsh compatibility suite.
#
# Claude Code's Bash tool runs markdown shell blocks under the user's login
# shell and replays a snapshot of their options. The suite runs code under:
#   bash          bash with no rc files
#   zsh           zsh -f (default options; -f skips ~/.zshrc so a
#                 contributor's config cannot change the result)
#   zsh-snapshot  zsh -f plus options common in interactive snapshots:
#                 noclobber, extendedglob, rcquotes, nocaseglob
# bats itself needs bash, so these tests launch the shells as children.

REPO_ROOT="$(cd "$BATS_TEST_DIRNAME/../.." && pwd)"
PROFILES=(bash zsh zsh-snapshot)

# Locally a missing tool skips the test; in CI (CI=true) it fails, so a
# required job cannot pass by skipping everything.
skip_or_fail() {
  if [ "${CI:-}" = true ]; then
    printf '%s (required in CI)\n' "$1" >&2
    return 1
  fi
  skip "$1"
}

require_zsh() {
  command -v zsh >/dev/null 2>&1 || skip_or_fail "zsh not installed"
}

# Sets PROFILE_CMD to the argv that runs a script file under profile $1.
profile_cmd() {
  case "$1" in
    bash) PROFILE_CMD=(bash --norc --noprofile) ;;
    zsh) PROFILE_CMD=(zsh -f) ;;
    zsh-snapshot) PROFILE_CMD=(zsh -f -o noclobber -o extendedglob -o rcquotes -o nocaseglob) ;;
    *) printf 'unknown profile: %s\n' "$1" >&2; return 1 ;;
  esac
}
