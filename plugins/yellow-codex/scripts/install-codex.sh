#!/bin/bash
set -Eeuo pipefail

# install-codex.sh — Install OpenAI Codex CLI for yellow-codex plugin
# Usage: bash install-codex.sh
#
# Codex ships as a standalone binary. This script prefers the Homebrew cask
# on macOS and otherwise runs OpenAI's official installer, which downloads
# the release archive for this OS/arch, verifies its SHA-256 digest, unpacks
# it under ~/.codex/packages, links ~/.local/bin/codex, and adds that
# directory to the shell profile. The npm package is no longer used: it
# needs Node 22+ and its Windows optional dependency has gone missing on
# npm before, so "npm install -g" is not a reliable path.
#
# Environment (all optional, passed through to the official installer):
#   CODEX_INSTALL_DIR  directory for the codex link (default ~/.local/bin)
#   CODEX_HOME         Codex home holding the unpacked releases (default ~/.codex)
#   CODEX_RELEASE      version to install (default latest)

# >>> generated: install-helpers (source: scripts/snippets/install-helpers.sh) >>>
# DO NOT EDIT — regenerate with: pnpm generate:snippets
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
# <<< generated: install-helpers <<<

readonly MIN_CODEX_VERSION="0.140.0"
readonly INSTALLER_URL="https://chatgpt.com/codex/install.sh"
readonly WINDOWS_INSTALLER_URL="https://chatgpt.com/codex/install.ps1"

installer_tmp=""
cleanup() {
  local exit_code=$?
  if [ -n "$installer_tmp" ]; then
    rm -f "$installer_tmp"
  fi
  if [ $exit_code -ne 0 ]; then
    warning "Installation failed. A partial install may remain under ${CODEX_HOME:-$HOME/.codex}/packages and ${CODEX_INSTALL_DIR:-$HOME/.local/bin}/codex."
  fi
}
trap cleanup EXIT

# >>> generated: install-version-gte (source: scripts/snippets/install-version-gte.sh) >>>
# DO NOT EDIT — regenerate with: pnpm generate:snippets
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
# <<< generated: install-version-gte <<<

# Report the version of a codex executable (default: whichever is first in
# PATH); empty when it is missing or --version fails.
codex_version() {
  "${1:-codex}" --version 2>/dev/null | grep -Eo '[0-9]+(\.[0-9]+)+' | head -n1 || true
}

# --- Check if already installed ---
# An explicit CODEX_RELEASE or CODEX_INSTALL_DIR is a request to (re)install
# that release or relocate the link, so the fast path and the Homebrew cask
# (which can honour neither) are skipped and the official installer runs.
install_override=false
if [ -n "${CODEX_RELEASE:-}" ] || [ -n "${CODEX_INSTALL_DIR:-}" ]; then
  install_override=true
  printf '[yellow-codex] Install override set (CODEX_RELEASE=%s CODEX_INSTALL_DIR=%s); running the official installer.\n' "${CODEX_RELEASE:-latest}" "${CODEX_INSTALL_DIR:-$HOME/.local/bin}"
fi
if [ "$install_override" = "false" ] && command -v codex >/dev/null 2>&1; then
  installed_version=$(codex_version)
  if [ -n "$installed_version" ] && version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
    success "codex already installed: v${installed_version}"
    exit 0
  elif [ -n "$installed_version" ]; then
    warning "codex v${installed_version} is installed but v${MIN_CODEX_VERSION}+ is required. Upgrading..."
  else
    warning "codex is installed but version could not be determined. Attempting upgrade..."
  fi
fi

# --- Detect OS/arch ---
os=$(uname -s)
arch=$(uname -m)
printf '[yellow-codex] Platform: %s/%s\n' "$os" "$arch"

case "$os" in
  MINGW*|MSYS*|CYGWIN*)
    cat >&2 <<INSTRUCTIONS
Native Windows detected. The official installer for Windows is PowerShell:
  powershell -ExecutionPolicy ByPass -c "irm ${WINDOWS_INSTALLER_URL} | iex"
It installs codex.exe under %LOCALAPPDATA%\Programs\OpenAI\Codex\bin and adds
that directory to the user PATH. Run it from PowerShell, then re-run /codex:setup.
(Inside WSL, run this script from the WSL shell instead.)
INSTRUCTIONS
    error "install-codex.sh supports macOS and Linux; use install.ps1 on native Windows."
    ;;
esac

# --- Check for brew cask on macOS ---
if [ "$install_override" = "false" ] && [ "$os" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  printf '[yellow-codex] macOS detected with Homebrew. Installing via brew cask...\n'
  if brew install --cask codex 2>&1; then
    if command -v codex >/dev/null 2>&1; then
      installed_version=$(codex_version)
      if [ -n "$installed_version" ] && version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
        success "codex v${installed_version} installed via Homebrew cask"
        exit 0
      fi
      warning "Homebrew codex v${installed_version:-unknown} is below v${MIN_CODEX_VERSION}. Falling back to the official installer..."
    else
      warning "brew cask install completed but codex not on PATH. Falling back to the official installer..."
    fi
  else
    warning "brew cask install failed — falling back to the official installer"
  fi
fi

# --- Dependency checks ---
# The official installer needs a downloader, tar, mktemp and a SHA-256 tool
# (it refuses to install an archive whose digest does not match).
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -nv -O "$2" "$1"; }
else
  error "curl or wget is required to download the Codex installer."
fi
for tool in tar mktemp; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    error "${tool} is required by the Codex installer but was not found."
  fi
done
if ! command -v sha256sum >/dev/null 2>&1 && ! command -v shasum >/dev/null 2>&1 && ! command -v openssl >/dev/null 2>&1; then
  error "sha256sum, shasum or openssl is required to verify the Codex download."
fi

# --- Install codex via the official installer ---
# Download to a file first (rather than piping straight into sh) so a
# truncated transfer fails here instead of executing half a script.
printf '[yellow-codex] Downloading the official Codex installer from %s...\n' "$INSTALLER_URL"
installer_tmp=$(mktemp "${TMPDIR:-/tmp}/codex-install.XXXXXX")
if ! fetch "$INSTALLER_URL" "$installer_tmp"; then
  error "Could not download ${INSTALLER_URL}. Check network access, or install manually with: brew install --cask codex (macOS) or the standalone binary from https://github.com/openai/codex/releases"
fi
if ! grep -q 'CODEX_INSTALL_DIR' "$installer_tmp"; then
  error "Downloaded installer does not look like the Codex install script (no CODEX_INSTALL_DIR reference). Refusing to run it."
fi

bin_dir="${CODEX_INSTALL_DIR:-$HOME/.local/bin}"
printf '[yellow-codex] Installing Codex CLI to %s (non-interactive)...\n' "$bin_dir"
if ! CODEX_NON_INTERACTIVE=true sh "$installer_tmp"; then
  cat >&2 <<'INSTRUCTIONS'
The official installer failed. Install codex manually using one of:
  curl -fsSL https://chatgpt.com/codex/install.sh | sh   (macOS/Linux)
  brew install --cask codex                              (macOS)
  Download from: https://github.com/openai/codex/releases (standalone binary)
Then re-run /codex:setup
INSTRUCTIONS
  error "Codex installer exited non-zero."
fi

# --- Verify installation ---
# Check the binary the installer placed, not whatever `codex` resolves to:
# a stale npm or Homebrew codex earlier in PATH would otherwise be measured
# instead and the incompatible version left in charge.
installed_bin="${bin_dir}/codex"
if [ ! -x "$installed_bin" ]; then
  error "codex not found at ${installed_bin} after install."
fi

installed_version=$(codex_version "$installed_bin")
if [ -z "$installed_version" ]; then
  error "codex binary found at ${installed_bin} but 'codex --version' failed. Try reinstalling."
fi

if ! version_gte "$installed_version" "$MIN_CODEX_VERSION"; then
  warning "codex v${installed_version} installed but v${MIN_CODEX_VERSION}+ is recommended."
fi

path_needs_update=false
if ! printf '%s' "$PATH" | tr ':' '\n' | grep -qxF "$bin_dir"; then
  path_needs_update=true
  export PATH="${bin_dir}:${PATH}"
fi

resolved_bin=$(command -v codex 2>/dev/null || true)
if [ -n "$resolved_bin" ] && [ "$resolved_bin" != "$installed_bin" ]; then
  warning "A different codex at ${resolved_bin} (v$(codex_version "$resolved_bin")) comes first in PATH and shadows ${installed_bin}."
  warning "Put ${bin_dir} earlier in PATH (export PATH=\"${bin_dir}:\$PATH\") or remove the old install."
fi

if [ "$path_needs_update" = "true" ]; then
  # The official installer appends bin_dir to the shell profile it detects
  # (~/.zshrc, ~/.bashrc, ~/.zprofile, ~/.bash_profile or ~/.profile).
  success "codex v${installed_version} installed to ${bin_dir} — restart your shell (or run: export PATH=\"${bin_dir}:\$PATH\") to use it"
else
  success "codex v${installed_version} installed to ${bin_dir} (already in PATH)"
fi
