#!/usr/bin/env bash

set -Eeuo pipefail

fatal() { echo "FATAL: $*" >&2; exit 1; }

# Set up paths first
bin_name="codacy-cli-v2"

# Determine OS-specific paths
os_name=$(uname)
arch=$(uname -m)

case "$arch" in
"x86_64")
  arch="amd64"
  ;;
"x86")
  arch="386"
  ;;
"aarch64"|"arm64")
  arch="arm64"
  ;;
esac

if [ -z "${CODACY_CLI_V2_TMP_FOLDER:-}" ]; then
    if [ "$(uname)" = "Linux" ]; then
        CODACY_CLI_V2_TMP_FOLDER="$HOME/.cache/codacy/codacy-cli-v2"
    elif [ "$(uname)" = "Darwin" ]; then
        CODACY_CLI_V2_TMP_FOLDER="$HOME/Library/Caches/Codacy/codacy-cli-v2"
    else
        CODACY_CLI_V2_TMP_FOLDER=".codacy-cli-v2"
    fi
fi

version_file="$CODACY_CLI_V2_TMP_FOLDER/version.yaml"


get_version_from_yaml() {
    if [ -f "$version_file" ]; then
        local version
        version=$(grep -o 'version: *"[^"]*"' "$version_file" | cut -d'"' -f2)
        if [ -n "$version" ]; then
            echo "$version"
            return 0
        fi
    fi
    return 1
}

get_latest_version() {
    local response
    if [ -n "${GH_TOKEN:-}" ]; then
        response=$(curl -fsSL --connect-timeout 10 --max-time 30 --retry 3 --retry-delay 1 --retry-all-errors --header "Authorization: Bearer $GH_TOKEN" "https://api.github.com/repos/codacy/codacy-cli-v2/releases/latest") || fatal "Failed to reach GitHub API"
    else
        response=$(curl -fsSL --connect-timeout 10 --max-time 30 --retry 3 --retry-delay 1 --retry-all-errors "https://api.github.com/repos/codacy/codacy-cli-v2/releases/latest") || fatal "Failed to reach GitHub API"
    fi

    local version
    version=$(echo "$response" | grep -m 1 tag_name | cut -d'"' -f4)
    echo "$version"
}

validate_version() {
    local ver="$1"
    case "$ver" in
        v[0-9]*.[0-9]*.[0-9]*|[0-9]*.[0-9]*.[0-9]*) ;;
        *) fatal "Invalid Codacy CLI version format: $ver" ;;
    esac
}

download_file() {
    local url="$1"

    echo "Downloading from URL: ${url}"
    if command -v curl > /dev/null 2>&1; then
        curl -f -# -LS --connect-timeout 10 --max-time 120 --retry 3 --retry-delay 1 --retry-all-errors "$url" -O
    elif command -v wget > /dev/null 2>&1; then
        wget --timeout=30 --tries=3 "$url"
    else
        fatal "Error: Could not find curl or wget, please install one."
    fi
}

download() {
    local url="$1"
    local output_folder="$2"

    ( cd "$output_folder" && download_file "$url" )
}

download_cli() {
    # OS name lower case
    suffix=$(echo "$os_name" | tr '[:upper:]' '[:lower:]')

    local bin_folder="$1"
    local bin_path="$2"
    local version="$3"

    if [ ! -f "$bin_path" ]; then
        echo "📥 Downloading CLI version $version..."

        remote_file="codacy-cli-v2_${version}_${suffix}_${arch}.tar.gz"
        url="https://github.com/codacy/codacy-cli-v2/releases/download/${version}/${remote_file}"

        download "$url" "$bin_folder"
        # NOTE: codacy-cli-v2 releases do not publish checksums or signatures.
        # Integrity relies on HTTPS + GitHub's CDN. Track upstream for checksum support.
        tar xzfv "${bin_folder}/${remote_file}" -C "${bin_folder}"
    fi
}

# Warn if CODACY_CLI_V2_VERSION is set and update is requested
if [ -n "${CODACY_CLI_V2_VERSION:-}" ] && [ "${1:-}" = "update" ]; then
    echo "⚠️  Warning: Performing update with forced version $CODACY_CLI_V2_VERSION"
    echo "    Unset CODACY_CLI_V2_VERSION to use the latest version"
fi

# Ensure version.yaml exists and is up to date
if [ ! -f "$version_file" ] || [ "${1:-}" = "update" ]; then
    echo "ℹ️  Fetching latest version..."
    version=$(get_latest_version)
    [ -n "$version" ] || fatal "Could not determine latest Codacy CLI version from GitHub API"
    mkdir -p "$CODACY_CLI_V2_TMP_FOLDER"
    echo "version: \"$version\"" > "$version_file"
fi

# Set the version to use
if [ -n "${CODACY_CLI_V2_VERSION:-}" ]; then
    version="$CODACY_CLI_V2_VERSION"
else
    version=$(get_version_from_yaml) || fatal "Could not read version from $version_file"
fi

validate_version "$version"

# Set up version-specific paths
bin_folder="${CODACY_CLI_V2_TMP_FOLDER}/${version}"

mkdir -p "$bin_folder"
bin_path="$bin_folder"/"$bin_name"

# Download the tool if not already installed
download_cli "$bin_folder" "$bin_path" "$version"
chmod +x "$bin_path"

if [ "$#" -eq 1 ] && { [ "$1" = "download" ] || [ "$1" = "update" ]; }; then
    echo "Codacy cli v2 download succeeded"
else
    "$bin_path" "$@"
fi