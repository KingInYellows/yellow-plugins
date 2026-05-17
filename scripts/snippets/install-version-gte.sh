# POSIX-compatible semver comparison — shared, byte-identically, by
# install-codex.sh and install-semgrep.sh (debt findings 014/015).
# Canonical source: scripts/snippets/install-version-gte.sh — edit there, then
# run `pnpm generate:snippets`. CI (`pnpm validate:snippets`) fails on drift.
# Compare two semver strings. Returns 0 if $1 >= $2, 1 otherwise.
# POSIX-compatible: no bash arrays, herestrings, or (( )) arithmetic.
version_gte() {
  local left="$1" right="$2"
  local left_major left_minor left_patch
  local right_major right_minor right_patch

  IFS='.' read -r left_major left_minor left_patch <<EOF
$left
EOF
  IFS='.' read -r right_major right_minor right_patch <<EOF
$right
EOF

  # Strip non-numeric suffixes (e.g., "3-beta" -> "3")
  left_major="${left_major%%[^0-9]*}"; left_major="${left_major:-0}"
  left_minor="${left_minor%%[^0-9]*}"; left_minor="${left_minor:-0}"
  left_patch="${left_patch%%[^0-9]*}"; left_patch="${left_patch:-0}"
  right_major="${right_major%%[^0-9]*}"; right_major="${right_major:-0}"
  right_minor="${right_minor%%[^0-9]*}"; right_minor="${right_minor:-0}"
  right_patch="${right_patch%%[^0-9]*}"; right_patch="${right_patch:-0}"

  if [ "$left_major" -gt "$right_major" ]; then return 0; fi
  if [ "$left_major" -lt "$right_major" ]; then return 1; fi
  if [ "$left_minor" -gt "$right_minor" ]; then return 0; fi
  if [ "$left_minor" -lt "$right_minor" ]; then return 1; fi
  if [ "$left_patch" -gt "$right_patch" ]; then return 0; fi
  if [ "$left_patch" -lt "$right_patch" ]; then return 1; fi
  return 0  # equal
}
