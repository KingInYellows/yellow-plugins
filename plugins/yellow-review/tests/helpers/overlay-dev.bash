# shellcheck shell=bash
# Simulate the overlayfs split where a directory's st_dev and a regular
# file's st_dev differ, on any filesystem. Directory devices are the real
# device with a 9 prefix; every other file type keeps the real device.

# overlay_dev_shims <dir>: write executable find and stat shims into <dir>.
overlay_dev_shims() {
  local dir="$1" real=/usr/bin/find
  [ -n "$dir" ] || return 1
  # The shims rewrite GNU find -printf and GNU stat -c output.
  [ -x "$real" ] || real=/bin/find
  "$real" / -maxdepth 0 -printf '' 2>/dev/null || skip "the overlay simulation needs a find with -printf"
  mkdir -p "$dir"
  cat >| "$dir/find" <<'EOF'
#!/bin/bash
# A directory's %D prints as 9<real>; every other type prints the real device.
set -o pipefail
real=/usr/bin/find
[ -x "$real" ] || real=/bin/find
if [ "${OVERLAY_FIND_NO_PRINTF:-}" = 1 ]; then
  for a in "$@"; do
    if [ "$a" = -printf ]; then
      printf '%s\n' 'find: -printf is not supported' >&2
      exit 1
    fi
  done
fi
need=0
args=()
p='%D'
for a in "$@"; do
  case "$a" in
    *%D*)
      # Find interprets the octal escapes and emits RS, %y, device, US.
      a=${a//"$p"/'\036%y%D\037'}
      need=1
      ;;
  esac
  args+=("$a")
done
if [ "$need" -eq 0 ]; then
  exec "$real" "$@"
fi
"$real" "${args[@]}" | LC_ALL=C sed -e 's/\x1ed\([0-9]*\)\x1f/9\1/g' -e 's/\x1e.\([0-9]*\)\x1f/\1/g'
EOF
  cat >| "$dir/stat" <<'EOF'
#!/bin/bash
# A directory's %d is the real device prefixed with 9. Other types are unchanged.
real=/usr/bin/stat
[ -x "$real" ] || real=/bin/stat
orig=("$@")
fmt=
have_c=0
opts=()
ops=()
while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      while [ "$#" -gt 0 ]; do
        ops+=("$1")
        shift
      done
      ;;
    -c)
      have_c=1
      shift
      if [ "$#" -eq 0 ]; then
        printf '%s\n' 'stat: option requires an argument -- c' >&2
        exit 1
      fi
      fmt=$1
      shift
      ;;
    -*)
      opts+=("$1")
      shift
      ;;
    *)
      ops+=("$1")
      shift
      ;;
  esac
done
if [ "$have_c" -eq 0 ]; then
  exec "$real" "${orig[@]}"
fi
rc=0
i=0
while [ "$i" -lt "${#ops[@]}" ]; do
  op=${ops[$i]}
  use=$fmt
  if [ -d "$op" ]; then
    p='%d'
    use=${use//"$p"/"9%d"}
  fi
  if [ "${#opts[@]}" -gt 0 ]; then
    "$real" "${opts[@]}" -c "$use" -- "$op" || rc=1
  else
    "$real" -c "$use" -- "$op" || rc=1
  fi
  i=$((i + 1))
done
exit "$rc"
EOF
  chmod +x "$dir/find" "$dir/stat"
}

# overlay_dev_use <dir>: yr_helper resolves find and stat to the shims.
# Every other name keeps the fixed-location lookup, never PATH.
overlay_dev_use() {
  OVERLAY_DEV_DIR=$1
  yr_helper() {
    local name="$1" cand
    case "$name" in
      find) printf '%s\n' "$OVERLAY_DEV_DIR/find"; return 0 ;;
      stat) printf '%s\n' "$OVERLAY_DEV_DIR/stat"; return 0 ;;
    esac
    for cand in "/usr/bin/$name" "/bin/$name" "/run/current-system/sw/bin/$name"; do
      if [ -f "$cand" ] && [ -x "$cand" ]; then
        printf '%s\n' "$cand"
        return 0
      fi
    done
    return 1
  }
}

# overlay_dev_sanity <dir>: succeed only when a directory and a regular file
# report different devices through the find shim.
overlay_dev_sanity() {
  local dir="$1" tmp dd fd
  tmp="$dir/sanity"
  rm -rf "$tmp"
  mkdir -p "$tmp" || return 1
  : >| "$tmp/f" || { rm -rf "$tmp"; return 1; }
  dd=$("$dir/find" "$tmp" -maxdepth 0 -printf '%D') || { rm -rf "$tmp"; return 1; }
  fd=$("$dir/find" "$tmp/f" -maxdepth 0 -printf '%D') || { rm -rf "$tmp"; return 1; }
  rm -rf "$tmp"
  [ -n "$dd" ] && [ -n "$fd" ] && [ "$dd" != "$fd" ]
}
