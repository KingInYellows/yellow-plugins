#!/usr/bin/env bash
# yellow-core: ground one cited quote against a line window.
#
# Execute with bash. Never source this file, and do not register it as a
# dual-shell library. The quote is stdin in check mode; it is never an
# argument.
#
#   quote-ground.sh check <file> <line> [radius]   # radius defaults to 3
#   quote-ground.sh batch                          # JSONL on stdin
#
# check exits 0 and prints the matched line number, 1 for ungrounded,
# too-short, or unsafe-path, and 2 for usage, a missing target file, a
# file that cannot be read, or a missing validate-fs.sh /
# compound-staging.sh. batch writes one JSON object per id: {id, result,
# matched_line}. result is grounded, ungrounded, too-short, or
# unsafe-path. A missing file is exit 2 in check mode; in batch that row is
# ungrounded and is not opened. batch exits 2 with no result rows when jq is
# missing, when any input row is not an object with a string-or-number id,
# a string file, a string quote and a number-or-string line, when a field
# holds U+0000, or when a cited file cannot be read.
#
# Substring comparison is a quoted bash case match, not awk -v, so
# backslashes stay literal. Lines that cannot start the private-key sed
# range are redacted together; a BEGIN/END line is redacted alone so the
# range cannot collapse later line numbers.

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  printf 'quote-ground.sh must be executed, not sourced\n' >&2
  return 1
fi

set -uo pipefail

# declare -A, declare -gA and mapfile need bash 4.2 or newer; macOS ships 3.2.
if [ "${BASH_VERSINFO[0]}" -lt 4 ] ||
  { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 2 ]; }; then
  printf 'quote-ground.sh requires bash 4.2 or newer (found %s)\n' "$BASH_VERSION" >&2
  exit 2
fi

lib_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd) || exit 2

if [ ! -f "$lib_dir/validate-fs.sh" ]; then
  exit 2
fi
# shellcheck disable=SC1091
. "$lib_dir/validate-fs.sh" || exit 2

if [ ! -f "$lib_dir/compound-staging.sh" ]; then
  exit 2
fi
# shellcheck disable=SC1091
. "$lib_dir/compound-staging.sh" || exit 2

type validate_file_path >/dev/null 2>&1 || exit 2
type cs_redact_secrets >/dev/null 2>&1 || exit 2

declare -A QG_NORM_CACHE=()
declare -A QG_QUEUED=()
declare -a QG_PENDING_RAW=()
declare -A QG_FILE_LINE=()
declare -A QG_FILE_LOADED=()
declare -A QG_PATH_CLASS=()

qg_root() {
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ]; then
    printf '%s' "$top"
    return 0
  fi
  pwd -P
}

# Same rules as rl_normalize_line in yellow-review's review-ledger.sh.
qg_normalize_line() {
  local s="$1"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/}"
  while [[ "$s" == *'  '* ]]; do
    s="${s//  / }"
  done
  s="${s# }"
  printf '%s' "${s% }"
}

qg_is_uint() {
  [[ "$1" =~ ^(0|[1-9][0-9]{0,8})$ ]]
}

qg_is_line() {
  [[ "$1" =~ ^[1-9][0-9]{0,8}$ ]]
}

qg_too_short() {
  local s="$1" compact
  s=${s//"[REDACTED]"/}
  compact=${s//[[:space:]]/}
  [ "${#compact}" -lt 8 ]
}

# Literal substring. Quoted case text is not a glob and does not treat
# backslash as an escape, which is what awk -v would do.
qg_contains() {
  local quote="$1" line="$2"
  [ -n "$quote" ] || return 1
  case "$line" in
    *"$quote"*) return 0 ;;
  esac
  return 1
}

# Cache keys carry a "k:" prefix. Bash rejects an empty associative-array
# subscript, and a blank source line or an empty quote is the empty string.
qg_queue() {
  local raw="$1"
  if [ "${QG_NORM_CACHE["k:$raw"]+set}" = set ]; then
    return 0
  fi
  if [ "${QG_QUEUED["k:$raw"]+set}" = set ]; then
    return 0
  fi
  QG_QUEUED["k:$raw"]=1
  QG_PENDING_RAW+=("$raw")
}

qg_store_norm() {
  local raw="$1" canon="$2" norm
  if ! norm=$(printf '%s' "$canon" | sed -E 's/\[REDACTED(:[^]]*)?\]/[REDACTED]/g'); then
    printf 'quote-ground: placeholder canonicalization failed\n' >&2
    exit 2
  fi
  QG_NORM_CACHE["k:$raw"]=$(qg_normalize_line "$norm")
}

qg_redact_one() {
  local raw="$1" canon
  if ! canon=$(printf '%s\n' "$raw" | cs_redact_secrets); then
    printf 'quote-ground: secret redaction failed\n' >&2
    exit 2
  fi
  qg_store_norm "$raw" "$canon"
}

# One sed over every queued line that cannot arm the private-key range.
# A count mismatch falls back to one process per line.
qg_flush() {
  local raw safe_file redact_out idx
  local -a safe_raw=()
  local -a safe_out=()
  [ "${#QG_PENDING_RAW[@]}" -gt 0 ] || return 0
  safe_file=$(mktemp)
  redact_out=$(mktemp)
  for raw in "${QG_PENDING_RAW[@]}"; do
    case "$raw" in
      *PRIVATE\ KEY* | *-----BEGIN* | *-----END*)
        qg_redact_one "$raw"
        ;;
      *)
        printf '%s\n' "$raw" >>"$safe_file"
        safe_raw+=("$raw")
        ;;
    esac
  done
  if [ "${#safe_raw[@]}" -gt 0 ]; then
    if ! cs_redact_secrets <"$safe_file" \
      | sed -E 's/\[REDACTED(:[^]]*)?\]/[REDACTED]/g' >"$redact_out"; then
      rm -f "$safe_file" "$redact_out"
      printf 'quote-ground: secret redaction failed\n' >&2
      exit 2
    fi
    mapfile -t safe_out <"$redact_out"
    if [ "${#safe_out[@]}" -eq "${#safe_raw[@]}" ]; then
      for idx in "${!safe_raw[@]}"; do
        QG_NORM_CACHE["k:${safe_raw[$idx]}"]=$(qg_normalize_line "${safe_out[$idx]}")
      done
    else
      for raw in "${safe_raw[@]}"; do
        qg_redact_one "$raw"
      done
    fi
  fi
  rm -f "$safe_file" "$redact_out"
  QG_PENDING_RAW=()
  declare -gA QG_QUEUED=()
}

# Load every line of one file. A read failure exits 2: a process
# substitution would hide awk's status, and an unread file would then look
# like an ungrounded quote. An empty file is loaded and has no line entries.
qg_ensure_lines() {
  local file="$1" full="$2" recs rec num text
  if [ "${QG_FILE_LOADED["f:$file"]+set}" = set ]; then
    return 0
  fi
  if ! recs=$(awk '{ printf "%d\t%s\n", NR, $0 }' "$full"); then
    printf 'quote-ground: failed to read cited file\n' >&2
    exit 2
  fi
  QG_FILE_LOADED["f:$file"]=1
  [ -n "$recs" ] || return 0
  while IFS= read -r rec; do
    num=${rec%%$'\t'*}
    text=${rec#*$'\t'}
    QG_FILE_LINE["${file}#${num}"]=$text
  done <<<"$recs"
}

# Classify one relative path. Sets QG_ONE_CLASS to ok, missing, or
# unsafe-path. The same path is validated once per process; a later row
# reuses that result and still does not open a rejected path.
qg_path_class() {
  local file="$1" full
  if [ "${QG_PATH_CLASS["p:$file"]+set}" = set ]; then
    QG_ONE_CLASS=${QG_PATH_CLASS["p:$file"]}
    return 0
  fi
  if ! validate_file_path "$file" "$QG_ROOT"; then
    QG_ONE_CLASS=unsafe-path
  else
    full="${QG_ROOT}/${file}"
    if [ ! -e "$full" ] || [ ! -r "$full" ]; then
      QG_ONE_CLASS=missing
    elif [ ! -f "$full" ]; then
      QG_ONE_CLASS=unsafe-path
    else
      QG_ONE_CLASS=ok
    fi
  fi
  QG_PATH_CLASS["p:$file"]=$QG_ONE_CLASS
}

# Search [line-radius, line+radius]. Norms for the quote and those lines
# must already be cached. Sets QG_MATCHED on success.
qg_search() {
  local file="$1" line="$2" radius="$3" quote="$4"
  local start end n raw norm
  QG_MATCHED=
  start=$((line - radius))
  if [ "$start" -lt 1 ]; then
    start=1
  fi
  end=$((line + radius))
  for ((n = start; n <= end; n++)); do
    if [ "${QG_FILE_LINE["${file}#${n}"]+set}" != set ]; then
      continue
    fi
    raw=${QG_FILE_LINE["${file}#${n}"]}
    norm=${QG_NORM_CACHE["k:$raw"]}
    if qg_contains "$quote" "$norm"; then
      QG_MATCHED=$n
      return 0
    fi
  done
  return 1
}

qg_queue_window() {
  local file="$1" line="$2" radius="$3" start end n
  start=$((line - radius))
  if [ "$start" -lt 1 ]; then
    start=1
  fi
  end=$((line + radius))
  for ((n = start; n <= end; n++)); do
    if [ "${QG_FILE_LINE["${file}#${n}"]+set}" = set ]; then
      qg_queue "${QG_FILE_LINE["${file}#${n}"]}"
    fi
  done
}

# Sets QG_CLASS. Does not read a rejected or missing path.
qg_classify_ready() {
  local file="$1" line="$2" radius="$3" quote="$4" qnorm
  QG_CLASS=
  QG_MATCHED=
  if ! qg_is_line "$line" || ! qg_is_uint "$radius"; then
    QG_CLASS=ungrounded
    return 0
  fi
  qg_path_class "$file"
  case "$QG_ONE_CLASS" in
    unsafe-path | missing)
      QG_CLASS=$QG_ONE_CLASS
      return 0
      ;;
  esac
  qnorm=${QG_NORM_CACHE["k:$quote"]}
  if qg_too_short "$qnorm"; then
    QG_CLASS=too-short
    return 0
  fi
  if qg_search "$file" "$line" "$radius" "$qnorm"; then
    QG_CLASS=grounded
    return 0
  fi
  QG_CLASS=ungrounded
}

qg_json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\x1e'/\\e}
  printf '%s' "$s"
}

qg_emit_all() {
  local i
  local -a args=()
  for i in "${!QG_OUT_ID[@]}"; do
    args+=("i${QG_OUT_ID[$i]}" "r${QG_OUT_RESULT[$i]}" "m${QG_OUT_MATCH[$i]}")
  done
  [ "${#args[@]}" -gt 0 ] || return 0
  # Each value carries a one-character prefix that jq strips, so an id that
  # starts with "-" is never read as an option and jq escapes every control
  # character itself.
  jq -nc '$ARGS.positional as $a | range(0; ($a | length); 3) as $i
    | {id: $a[$i][1:], result: $a[$i + 1][1:],
       matched_line: ($a[$i + 2][1:] | if test("^[0-9]+$") then tonumber else null end)}' \
    --args "${args[@]}" || {
    printf 'quote-ground: could not write batch output\n' >&2
    exit 2
  }
}

qg_batch_label() {
  case "$1" in
    grounded) printf '%s' grounded ;;
    too-short) printf '%s' too-short ;;
    unsafe-path) printf '%s' unsafe-path ;;
    *) printf '%s' ungrounded ;;
  esac
}

qg_check() {
  local file="$1" line="$2" radius="$3" quote="$4" full
  if ! qg_is_line "$line" || ! qg_is_uint "$radius"; then
    exit 2
  fi
  qg_path_class "$file"
  case "$QG_ONE_CLASS" in
    unsafe-path) exit 1 ;;
    missing) exit 2 ;;
  esac
  full="${QG_ROOT}/${file}"
  qg_queue "$quote"
  qg_flush
  qg_ensure_lines "$file" "$full"
  qg_queue_window "$file" "$line" "$radius"
  qg_flush
  qg_classify_ready "$file" "$line" "$radius" "$quote"
  case "$QG_CLASS" in
    grounded)
      printf '%s\n' "$QG_MATCHED"
      exit 0
      ;;
    ungrounded | too-short | unsafe-path) exit 1 ;;
    *) exit 2 ;;
  esac
}

# Decode the JSONL rows with one jq pass into NUL-framed fields in a temp
# file. A row of the wrong shape, or a field holding U+0000 (which would
# shift the framing), makes jq fail and the whole batch exit 2. The status is
# read from jq itself, never from a process substitution.
qg_load_rows() {
  local framed id file line quote
  framed=$(mktemp) || {
    printf 'quote-ground: could not create a temp file\n' >&2
    return 2
  }
  if ! jq -j '
    if ((.id | type) == "string" or (.id | type) == "number")
      and (.file | type) == "string"
      and (.quote | type) == "string"
      and ((.line | type) == "number" or (.line | type) == "string")
    then
      [(.id | tostring), .file, (.line | tostring), .quote] as $f
      | if any($f[]; contains("\u0000")) then error("nul in field")
        else $f[] + "\u0000" end
    else
      error("invalid row")
    end
  ' >"$framed"; then
    rm -f "$framed"
    printf 'quote-ground: invalid batch input\n' >&2
    return 2
  fi
  while IFS= read -r -d '' id; do
    if ! IFS= read -r -d '' file || ! IFS= read -r -d '' line || ! IFS= read -r -d '' quote; then
      rm -f "$framed"
      printf 'quote-ground: short batch record\n' >&2
      return 2
    fi
    B_ID+=("$id")
    B_FILE+=("$file")
    B_LINE+=("$line")
    B_QUOTE+=("$quote")
    B_CLASS+=("")
    B_MATCH+=("")
  done <"$framed"
  rm -f "$framed"
}

# Load every still-pending file once. qg_ensure_lines skips a loaded file
# and exits 2 on a read error.
qg_load_pending_files() {
  local i file
  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    file=${B_FILE[$i]}
    qg_ensure_lines "$file" "${QG_ROOT}/${file}"
  done
}

qg_batch() {
  local file line quote class i qnorm
  local -a B_ID=() B_FILE=() B_LINE=() B_QUOTE=() B_CLASS=() B_MATCH=()
  declare -a QG_OUT_ID=() QG_OUT_RESULT=() QG_OUT_MATCH=()
  command -v jq >/dev/null 2>&1 || exit 2
  qg_load_rows || exit 2

  for i in "${!B_ID[@]}"; do
    file=${B_FILE[$i]}
    line=${B_LINE[$i]}
    quote=${B_QUOTE[$i]}
    if ! qg_is_line "$line"; then
      B_CLASS[$i]=ungrounded
      continue
    fi
    qg_path_class "$file"
    case "$QG_ONE_CLASS" in
      unsafe-path)
        B_CLASS[$i]=unsafe-path
        continue
        ;;
      missing)
        B_CLASS[$i]=missing
        continue
        ;;
    esac
    qg_queue "$quote"
    B_CLASS[$i]=pending
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["k:${B_QUOTE[$i]}"]}
    if qg_too_short "$qnorm"; then
      B_CLASS[$i]=too-short
    fi
  done
  qg_load_pending_files
  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qg_queue_window "${B_FILE[$i]}" "${B_LINE[$i]}" 3
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["k:${B_QUOTE[$i]}"]}
    if qg_search "${B_FILE[$i]}" "${B_LINE[$i]}" 3 "$qnorm"; then
      B_CLASS[$i]=grounded
      B_MATCH[$i]=$QG_MATCHED
    else
      B_CLASS[$i]=ungrounded
    fi
  done

  for i in "${!B_ID[@]}"; do
    class=$(qg_batch_label "${B_CLASS[$i]}")
    QG_OUT_ID+=("${B_ID[$i]}")
    QG_OUT_RESULT+=("$class")
    if [ "$class" = grounded ]; then
      QG_OUT_MATCH+=("${B_MATCH[$i]}")
    else
      QG_OUT_MATCH+=("")
    fi
  done
  qg_emit_all
}

QG_ROOT=$(qg_root)

case "${1:-}" in
  check)
    if [ $# -lt 3 ]; then
      exit 2
    fi
    file=$2
    line=$3
    if [ $# -ge 4 ]; then
      radius=$4
    else
      radius=3
    fi
    quote=$(cat)
    qg_check "$file" "$line" "$radius" "$quote"
    ;;
  batch)
    if [ $# -ne 1 ]; then
      exit 2
    fi
    qg_batch
    ;;
  *) exit 2 ;;
esac
