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
# too-short, or unsafe-path, and 2 for usage, a missing target file, or
# a missing validate-fs.sh / compound-staging.sh. batch writes one JSON
# object per id: {id, result, matched_line}. result is grounded,
# ungrounded, too-short, or unsafe-path. A missing file is exit 2 in
# check mode; in batch that row is ungrounded and is not opened.
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

qg_queue() {
  local raw="$1"
  if [ "${QG_NORM_CACHE["$raw"]+set}" = set ]; then
    return 0
  fi
  if [ "${QG_QUEUED["$raw"]+set}" = set ]; then
    return 0
  fi
  QG_QUEUED["$raw"]=1
  QG_PENDING_RAW+=("$raw")
}

qg_store_norm() {
  local raw="$1" canon="$2"
  canon=$(printf '%s' "$canon" | sed -E 's/\[REDACTED(:[^]]*)?\]/[REDACTED]/g')
  QG_NORM_CACHE["$raw"]=$(qg_normalize_line "$canon")
}

qg_redact_one() {
  local raw="$1" canon
  canon=$(printf '%s\n' "$raw" | cs_redact_secrets || true)
  qg_store_norm "$raw" "$canon"
}

# One sed over every queued line that cannot arm the private-key range.
# A count mismatch falls back to one process per line.
qg_flush() {
  local raw canon safe_file idx
  local -a safe_raw=()
  local -a safe_out=()
  [ "${#QG_PENDING_RAW[@]}" -gt 0 ] || return 0
  safe_file=$(mktemp)
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
    mapfile -t safe_out < <(cs_redact_secrets <"$safe_file" | sed -E 's/\[REDACTED(:[^]]*)?\]/[REDACTED]/g' || true)
    if [ "${#safe_out[@]}" -eq "${#safe_raw[@]}" ]; then
      for idx in "${!safe_raw[@]}"; do
        QG_NORM_CACHE["${safe_raw[$idx]}"]=$(qg_normalize_line "${safe_out[$idx]}")
      done
    else
      for raw in "${safe_raw[@]}"; do
        qg_redact_one "$raw"
      done
    fi
  fi
  rm -f "$safe_file"
  QG_PENDING_RAW=()
  declare -gA QG_QUEUED=()
}

qg_ensure_lines() {
  local file="$1" full="$2" rec num text
  if [ "${QG_FILE_LOADED["$file"]+set}" = set ]; then
    return 0
  fi
  QG_FILE_LOADED["$file"]=1
  while IFS= read -r rec; do
    num=${rec%%$'\t'*}
    text=${rec#*$'\t'}
    QG_FILE_LINE["${file}#${num}"]=$text
  done < <(awk '{ printf "%d\t%s\n", NR, $0 }' "$full")
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
    norm=${QG_NORM_CACHE["$raw"]}
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
  if ! validate_file_path "$file" "$QG_ROOT"; then
    QG_CLASS=unsafe-path
    return 0
  fi
  if [ ! -e "${QG_ROOT}/${file}" ] || [ ! -r "${QG_ROOT}/${file}" ]; then
    QG_CLASS=missing
    return 0
  fi
  if [ ! -f "${QG_ROOT}/${file}" ]; then
    QG_CLASS=unsafe-path
    return 0
  fi
  qnorm=${QG_NORM_CACHE["$quote"]}
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
  local i tmp
  tmp=$(mktemp)
  for i in "${!QG_OUT_ID[@]}"; do
    printf '%s\x1e%s\x1e%s\n' \
      "$(qg_json_escape "${QG_OUT_ID[$i]}")" \
      "$(qg_json_escape "${QG_OUT_RESULT[$i]}")" \
      "$(qg_json_escape "${QG_OUT_MATCH[$i]}")" >>"$tmp"
  done
  awk '
    function unescape(s) {
      gsub(/\\\\/, "\x01", s)
      gsub(/\\n/, "\n", s)
      gsub(/\\r/, "\r", s)
      gsub(/\\e/, "\x1e", s)
      gsub(/\x01/, "\\", s)
      return s
    }
    function jesc(s) {
      gsub(/\\/, "\\\\", s)
      gsub(/"/, "\\\"", s)
      gsub(/\t/, "\\t", s)
      gsub(/\r/, "\\r", s)
      gsub(/\n/, "\\n", s)
      return s
    }
    BEGIN { FS = "\x1e" }
    {
      id = jesc(unescape($1))
      result = jesc(unescape($2))
      matched = unescape($3)
      if (matched ~ /^[0-9]+$/)
        printf "{\"id\":\"%s\",\"result\":\"%s\",\"matched_line\":%s}\n", id, result, matched
      else
        printf "{\"id\":\"%s\",\"result\":\"%s\",\"matched_line\":null}\n", id, result
    }
  ' "$tmp"
  rm -f "$tmp"
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
  if ! validate_file_path "$file" "$QG_ROOT"; then
    exit 1
  fi
  full="${QG_ROOT}/${file}"
  if [ ! -e "$full" ] || [ ! -r "$full" ]; then
    exit 2
  fi
  if [ ! -f "$full" ]; then
    exit 1
  fi
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

qg_load_rows() {
  local decoded="$1" id file line quote
  while IFS= read -r -d '' id || [ -n "$id" ]; do
    IFS= read -r -d '' file || return 2
    IFS= read -r -d '' line || return 2
    IFS= read -r -d '' quote || return 2
    B_ID+=("$id")
    B_FILE+=("$file")
    B_LINE+=("$line")
    B_QUOTE+=("$quote")
    B_CLASS+=("")
    B_MATCH+=("")
  done < <(awk '
    function jdec(s,    i, n, c, out, hex, code) {
      n = length(s)
      if (n < 2 || substr(s, 1, 1) != "\"") return ""
      out = ""
      i = 2
      while (i < n) {
        c = substr(s, i, 1)
        if (c == "\\") {
          i++
          if (i >= n) break
          c = substr(s, i, 1)
          if (c == "n") out = out "\n"
          else if (c == "r") out = out "\r"
          else if (c == "t") out = out "\t"
          else if (c == "\"" || c == "\\" || c == "/") out = out c
          else if (c == "u") {
            hex = substr(s, i + 1, 4)
            code = strtonum("0x" hex)
            if (code < 128) out = out sprintf("%c", code)
            else if (code < 2048)
              out = out sprintf("%c%c", 192 + int(code / 64), 128 + (code % 64))
            else
              out = out sprintf("%c%c%c", 224 + int(code / 4096), 128 + int((code % 4096) / 64), 128 + (code % 64))
            i += 4
          } else out = out c
        } else out = out c
        i++
      }
      return out
    }
    BEGIN { FS = "\t" }
    {
      printf "%s\0%s\0%s\0%s\0", jdec($1), jdec($2), jdec($3), jdec($4)
    }
  ' "$decoded")
}

qg_batch() {
  local decoded id file line quote full class i qnorm
  local -a B_ID=() B_FILE=() B_LINE=() B_QUOTE=() B_CLASS=() B_MATCH=()
  declare -a QG_OUT_ID=() QG_OUT_RESULT=() QG_OUT_MATCH=()
  command -v jq >/dev/null 2>&1 || exit 2
  decoded=$(mktemp)
  jq -rc '
    if ((.id | type) == "string" or (.id | type) == "number")
      and (.file | type) == "string"
      and (.quote | type) == "string"
      and ((.line | type) == "number" or (.line | type) == "string")
    then
      [(.id | tostring | @json), (.file | @json), (.line | tostring | @json), (.quote | @json)] | join("\t")
    else
      "INVALID"
    end
  ' >"$decoded" || {
    rm -f "$decoded"
    exit 2
  }
  if grep -qx 'INVALID' "$decoded"; then
    rm -f "$decoded"
    exit 2
  fi
  qg_load_rows "$decoded" || {
    rm -f "$decoded"
    exit 2
  }
  rm -f "$decoded"

  for i in "${!B_ID[@]}"; do
    file=${B_FILE[$i]}
    line=${B_LINE[$i]}
    quote=${B_QUOTE[$i]}
    if ! qg_is_line "$line"; then
      B_CLASS[$i]=ungrounded
      continue
    fi
    if ! validate_file_path "$file" "$QG_ROOT"; then
      B_CLASS[$i]=unsafe-path
      continue
    fi
    full="${QG_ROOT}/${file}"
    if [ ! -e "$full" ] || [ ! -r "$full" ]; then
      B_CLASS[$i]=missing
      continue
    fi
    if [ ! -f "$full" ]; then
      B_CLASS[$i]=unsafe-path
      continue
    fi
    qg_queue "$quote"
    B_CLASS[$i]=pending
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["${B_QUOTE[$i]}"]}
    if qg_too_short "$qnorm"; then
      B_CLASS[$i]=too-short
      continue
    fi
    qg_ensure_lines "${B_FILE[$i]}" "${QG_ROOT}/${B_FILE[$i]}"
    qg_queue_window "${B_FILE[$i]}" "${B_LINE[$i]}" 3
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["${B_QUOTE[$i]}"]}
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
