# Color constants + error/warning/success helpers — shared, byte-identically,
# across the plugin install scripts (debt findings 036/037).
# Canonical source: scripts/snippets/install-helpers.sh — edit there, then run
# `pnpm generate:snippets`. CI (`pnpm validate:snippets`) fails on drift.
readonly RED='\033[0;31m'
readonly GREEN='\033[0;32m'
readonly YELLOW='\033[0;33m'
readonly NC='\033[0m'

error() {
  printf '%bError: %s%b\n' "$RED" "$1" "$NC" >&2
  exit 1
}

warning() {
  printf '%bWarning: %s%b\n' "$YELLOW" "$1" "$NC" >&2
}

success() {
  printf '%b%s%b\n' "$GREEN" "$1" "$NC"
}
