#!/usr/bin/env bash
# yellow-core: ground one cited quote against a line window.
#
# Execute with bash 4.4 or newer. Never source this file, and do not register
# it as a dual-shell library. The quote is stdin in check mode; it is never an
# argument.
#
#   quote-ground.sh check <file> <line> [radius]   # radius defaults to 3
#   quote-ground.sh batch                          # JSONL on stdin
#
# check exits 0 and prints the matched line number, 1 for ungrounded,
# too-short, or unsafe-path, and 2 for usage, a missing target file, a file
# that cannot be read, a redaction failure, or a missing validate-fs.sh /
# compound-staging.sh. It validates its arguments before it reads stdin.
#
# batch reads one JSON object per line ({id, file, line, quote}) and writes
# one object per input row, in input order: {id, result, matched_line}. result
# is grounded, ungrounded, too-short, or unsafe-path; matched_line is a number
# only for grounded and null otherwise. A numeric id stays a number and a
# string id stays a string. batch always uses radius 3. A missing file is
# exit 2 in check mode; in batch that row is ungrounded and is not opened. A
# row whose file, line or quote has the wrong type, or holds U+0000, is
# ungrounded and does not affect its siblings. A cited file with a NUL byte in
# the lines up to its last cited window is never matched: its rows are
# ungrounded (check exits 1), because bash would silently drop the byte. batch
# exits 2 with no result rows when jq is missing, when a line is blank or not
# JSON, when a row has no usable id (a string or number without U+0000), when a cited
# file cannot be read, or when redaction fails.
#
# Redaction runs per line before matching, and every [REDACTED] or
# [REDACTED:<type>] token is canonicalized to [REDACTED] on both sides. A
# placeholder therefore matches whatever secret the line held, so a quote can
# ground even when the text it hid differs from the source; a quote with
# fewer than 8 characters outside placeholders is too-short and never grounds.
#
# Nothing here writes a temp file: unredacted source lines and quotes stay in
# process memory and pipes only. Substring comparison is a quoted bash case
# match, not awk -v, so backslashes stay literal. Lines that cannot start the
# private-key sed range are redacted together; a BEGIN/END line is redacted
# alone so the range cannot collapse later line numbers. Lines inside a
# private-key block (BEGIN through END) are tracked while the file loads and
# count as [REDACTED] without a redaction pass. Only the cited
# windows of each file are loaded, and the window loops stop at the last
# loaded line, so a large radius or line number costs no more than a small one.

if [ "${BASH_SOURCE[0]}" != "$0" ]; then
  printf 'quote-ground.sh must be executed, not sourced\n' >&2
  return 1
fi

# No errexit on purpose: failures are handled where they happen and each exit
# status is part of the contract above.
set -uo pipefail

# declare -A, mapfile and empty-array expansion under set -u need bash 4.4 or
# newer; macOS ships 3.2.
if [ "${BASH_VERSINFO[0]}" -lt 4 ] ||
  { [ "${BASH_VERSINFO[0]}" -eq 4 ] && [ "${BASH_VERSINFO[1]}" -lt 4 ]; }; then
  printf 'quote-ground.sh requires bash 4.4 or newer (found %s)\n' "$BASH_VERSION" >&2
  exit 2
fi

lib_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd) || exit 2

# shellcheck disable=SC1091
. "$lib_dir/validate-fs.sh" 2>/dev/null || exit 2
# shellcheck disable=SC1091
. "$lib_dir/compound-staging.sh" 2>/dev/null || exit 2

type validate_file_path >/dev/null 2>&1 || exit 2
type cs_redact_secrets >/dev/null 2>&1 || exit 2

readonly QG_DEFAULT_RADIUS=3
readonly QG_MIN_CHARS=8
readonly QG_END_MARK='QG-END-OF-LINES-7f3a91'

# Cache keys carry a prefix. Bash rejects an empty associative-array
# subscript, and a blank source line, an empty quote or an empty path is the
# empty string.
declare -A QG_NORM_CACHE=()   # k:<raw line or quote> -> redacted, normalized text
declare -A QG_QUEUED=()       # k:<raw> -> 1 while waiting for qg_flush
declare -a QG_PENDING_RAW=()
declare -A QG_FILE_LINE=()    # <file>#<n> -> raw line
declare -A QG_FILE_KEY=()     # <file>#<n> -> 1 for a line inside a private-key block
declare -A QG_FILE_LOADED=()  # f:<file> -> 1
declare -A QG_FILE_COUNT=()   # f:<file> -> last loaded line number
declare -A QG_FILE_LO=()      # f:<file> -> first line any row needs
declare -A QG_FILE_HI=()      # f:<file> -> last line any row needs
declare -A QG_PATH_CLASS=()   # p:<file> -> ok | missing | unreadable | unsafe-path

# One row per finding, shared by check (one row) and batch.
declare -a B_ID=() B_FILE=() B_LINE=() B_QUOTE=() B_RADIUS=() B_CLASS=() B_MATCH=()

qg_root() {
  local top
  if top=$(git rev-parse --show-toplevel 2>/dev/null) && [ -n "$top" ]; then
    printf '%s' "$top"
    return 0
  fi
  pwd -P
}

# Same rules as rl_normalize_line in yellow-review's review-ledger.sh. Sets
# QG_NORM_OUT instead of printing so callers do not fork per line.
qg_normalize_line() {
  local s="$1"
  s="${s//$'\t'/ }"
  s="${s//$'\r'/}"
  while [[ "$s" == *'  '* ]]; do
    s="${s//  / }"
  done
  s="${s# }"
  QG_NORM_OUT="${s% }"
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
  [ "${#compact}" -lt "$QG_MIN_CHARS" ]
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

# The one placeholder canonicalization: [REDACTED:<type>] becomes [REDACTED].
qg_canon_placeholders() {
  sed -E 's/\[REDACTED(:[^]]*)?\]/[REDACTED]/g'
}

qg_fail_redaction() {
  printf 'quote-ground: secret redaction failed\n' >&2
  exit 2
}

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

qg_redact_one() {
  local raw="$1" canon
  # The trailing x keeps the command substitution from trimming newlines that
  # belong to the text, so a quote ending in LF stays different from its line.
  if ! canon=$(printf '%s\n' "$raw" | cs_redact_secrets | qg_canon_placeholders \
    || exit 1; printf x); then
    qg_fail_redaction
  fi
  canon=${canon%x}
  canon=${canon%$'\n'}
  qg_normalize_line "$canon"
  QG_NORM_CACHE["k:$raw"]=$QG_NORM_OUT
}

# One redaction pass over every queued line that cannot arm the private-key
# range, fed from memory through a pipe. The end mark proves the output was
# not cut short or merged: a count or mark mismatch (a multi-line quote, say)
# falls back to one pass per line.
qg_flush() {
  local raw idx out last
  local -a safe_raw=() safe_out=()
  [ "${#QG_PENDING_RAW[@]}" -gt 0 ] || return 0
  for raw in "${QG_PENDING_RAW[@]}"; do
    case "$raw" in
      *PRIVATE\ KEY* | *-----BEGIN* | *-----END*)
        qg_redact_one "$raw"
        ;;
      *)
        safe_raw+=("$raw")
        ;;
    esac
  done
  if [ "${#safe_raw[@]}" -gt 0 ]; then
    if ! out=$(printf '%s\n' "${safe_raw[@]}" "$QG_END_MARK" \
      | cs_redact_secrets | qg_canon_placeholders); then
      qg_fail_redaction
    fi
    mapfile -t safe_out < <(printf '%s\n' "$out")
    last=${#safe_raw[@]}
    if [ "${#safe_out[@]}" -eq $((last + 1)) ] && [ "${safe_out[$last]}" = "$QG_END_MARK" ]; then
      for idx in "${!safe_raw[@]}"; do
        qg_normalize_line "${safe_out[$idx]}"
        QG_NORM_CACHE["k:${safe_raw[$idx]}"]=$QG_NORM_OUT
      done
    else
      for raw in "${safe_raw[@]}"; do
        qg_redact_one "$raw"
      done
    fi
  fi
  QG_PENDING_RAW=()
  QG_QUEUED=()
}

# Load lines lo..hi of one file. A read failure exits 2: a process
# substitution would hide awk's status, and an unread file would then look
# like an ungrounded quote. QG_FILE_COUNT records the last line loaded, which
# is where the window loops stop. awk also tracks the private-key range from
# line 1, as cs_redact_secrets' sed range does, and flags every line from
# BEGIN through END. A line holding both markers is a block on its own and
# closes at once, deliberately unlike sed, which would run to a later END or
# EOF, so the rows after it keep their numbers and stay matchable.
# Those lines are never matched as text: qg_search treats them as [REDACTED],
# so a key body row cannot ground and the block keeps its line numbers.
qg_ensure_lines() {
  local file="$1" full="$2" lo="$3" hi="$4" recs rec num flag text nuls
  if [ "${QG_FILE_LOADED["f:$file"]+set}" = set ]; then
    return 0
  fi
  # Bash drops NUL bytes from a command substitution, which would join the text
  # either side of one and ground a quote the file does not hold. A file with a
  # NUL in the lines up to hi loads no lines, so its rows are ungrounded.
  if ! nuls=$(head -n "$hi" -- "$full" | LC_ALL=C tr -dc '\0' | wc -c); then
    printf 'quote-ground: failed to read cited file\n' >&2
    exit 2
  fi
  if [ $((nuls)) -gt 0 ]; then
    QG_FILE_LOADED["f:$file"]=1
    QG_FILE_COUNT["f:$file"]=0
    return 0
  fi
  if ! recs=$(awk -v lo="$lo" -v hi="$hi" '
    {
      flag = 0
      if (inkey) {
        flag = 1
        if ($0 ~ /-----END.*PRIVATE KEY-----/) inkey = 0
      } else if ($0 ~ /-----BEGIN.*PRIVATE KEY-----/) {
        flag = 1
        if ($0 !~ /-----END.*PRIVATE KEY-----/) inkey = 1
      }
    }
    NR >= lo { printf "%d\t%d\t%s\n", NR, flag, $0 }
    NR >= hi { exit }' "$full"); then
    printf 'quote-ground: failed to read cited file\n' >&2
    exit 2
  fi
  QG_FILE_LOADED["f:$file"]=1
  QG_FILE_COUNT["f:$file"]=0
  [ -n "$recs" ] || return 0
  while IFS= read -r rec; do
    num=${rec%%$'\t'*}
    text=${rec#*$'\t'}
    flag=${text%%$'\t'*}
    text=${text#*$'\t'}
    QG_FILE_COUNT["f:$file"]=$num
    QG_FILE_LINE["${file}#${num}"]=$text
    if [ "$flag" = 1 ]; then
      QG_FILE_KEY["${file}#${num}"]=1
    fi
  done <<<"$recs"
}

qg_ancestor_blocked() {
  local d="${QG_ROOT}/$1"
  case "$1" in *..* | /*) return 1 ;; esac
  d=${d%/*}
  while [ "${#d}" -gt "${#QG_ROOT}" ]; do
    if [ -d "$d" ] && [ ! -x "$d" ]; then return 0; fi
    d=${d%/*}
  done
  return 1
}

# Classify one relative path. Sets QG_ONE_CLASS to ok, missing, unreadable, or
# unsafe-path. The same path is validated once per process; a later row
# reuses that result and still does not open a rejected path.
qg_path_class() {
  local file="$1" full
  if [ "${QG_PATH_CLASS["p:$file"]+set}" = set ]; then
    QG_ONE_CLASS=${QG_PATH_CLASS["p:$file"]}
    return 0
  fi
  # Allowlist (ASCII, C locale): letters, digits, space and . _ / + @ = , ~ ( ) [ ] -
  # Anything else (shell metacharacters, quotes, control characters, non-ASCII)
  # and option-shaped segments are refused before the path reaches
  # validate_file_path or a file test.
  local LC_ALL=C
  local path_re='^[][A-Za-z0-9 ._/+@=,~()-]+$'
  if [[ ! "$file" =~ $path_re || "$file" == -* || "$file" == */-* ]]; then
    QG_ONE_CLASS=unsafe-path
  elif ! validate_file_path "$file" "$QG_ROOT"; then
    # A directory without search permission also fails validation.
    if qg_ancestor_blocked "$file"; then
      QG_ONE_CLASS=unreadable
    else
      QG_ONE_CLASS=unsafe-path
    fi
  else
    full="${QG_ROOT}/${file}"
    if [ ! -e "$full" ]; then
      QG_ONE_CLASS=missing
    elif [ ! -f "$full" ]; then
      QG_ONE_CLASS=unsafe-path
    elif [ ! -r "$full" ]; then
      QG_ONE_CLASS=unreadable
    else
      QG_ONE_CLASS=ok
    fi
  fi
  QG_PATH_CLASS["p:$file"]=$QG_ONE_CLASS
}

# Sets QG_WIN_START and QG_WIN_END for [line-radius, line+radius], start
# floored at 1. qg_clamp_window then stops the end at the last loaded line.
qg_bounds() {
  QG_WIN_START=$(($1 - $2))
  if [ "$QG_WIN_START" -lt 1 ]; then
    QG_WIN_START=1
  fi
  QG_WIN_END=$(($1 + $2))
}

qg_clamp_window() {
  local last=${QG_FILE_COUNT["f:$1"]:-0}
  if [ "$QG_WIN_END" -gt "$last" ]; then
    QG_WIN_END=$last
  fi
}

# Search one row's window. Norms for the quote and those lines must already
# be cached. Sets QG_MATCHED on success.
qg_search() {
  local file="$1" line="$2" radius="$3" quote="$4" n raw norm
  QG_MATCHED=
  qg_bounds "$line" "$radius"
  qg_clamp_window "$file"
  for ((n = QG_WIN_START; n <= QG_WIN_END; n++)); do
    if [ "${QG_FILE_LINE["${file}#${n}"]+set}" != set ]; then
      continue
    fi
    if [ "${QG_FILE_KEY["${file}#${n}"]+set}" = set ]; then
      norm='[REDACTED]'
    else
      raw=${QG_FILE_LINE["${file}#${n}"]}
      norm=${QG_NORM_CACHE["k:$raw"]}
    fi
    if qg_contains "$quote" "$norm"; then
      QG_MATCHED=$n
      return 0
    fi
  done
  return 1
}

qg_queue_window() {
  local file="$1" line="$2" radius="$3" n
  qg_bounds "$line" "$radius"
  qg_clamp_window "$file"
  for ((n = QG_WIN_START; n <= QG_WIN_END; n++)); do
    if [ "${QG_FILE_LINE["${file}#${n}"]+set}" = set ] \
      && [ "${QG_FILE_KEY["${file}#${n}"]+set}" != set ]; then
      qg_queue "${QG_FILE_LINE["${file}#${n}"]}"
    fi
  done
}

# Classify every row in B_*. Sets B_CLASS to grounded, ungrounded, too-short,
# unsafe-path, or missing, and B_MATCH for grounded rows. A rejected or
# missing path is never opened.
qg_ground_rows() {
  local i key file qnorm
  for i in "${!B_ID[@]}"; do
    if ! qg_is_line "${B_LINE[$i]}" || ! qg_is_uint "${B_RADIUS[$i]}"; then
      B_CLASS[i]=ungrounded
      continue
    fi
    qg_path_class "${B_FILE[$i]}"
    case "$QG_ONE_CLASS" in
      unsafe-path | missing)
        B_CLASS[i]=$QG_ONE_CLASS
        continue
        ;;
      unreadable)
        printf 'quote-ground: failed to read cited file\n' >&2
        exit 2
        ;;
    esac
    qg_queue "${B_QUOTE[$i]}"
    B_CLASS[i]=pending
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["k:${B_QUOTE[$i]}"]}
    if qg_too_short "$qnorm"; then
      B_CLASS[i]=too-short
      continue
    fi
    # Load only the span of lines some row of this file needs.
    qg_bounds "${B_LINE[$i]}" "${B_RADIUS[$i]}"
    key="f:${B_FILE[$i]}"
    if [ "${QG_FILE_LO["$key"]+set}" != set ] || [ "$QG_WIN_START" -lt "${QG_FILE_LO["$key"]}" ]; then
      QG_FILE_LO["$key"]=$QG_WIN_START
    fi
    if [ "${QG_FILE_HI["$key"]+set}" != set ] || [ "$QG_WIN_END" -gt "${QG_FILE_HI["$key"]}" ]; then
      QG_FILE_HI["$key"]=$QG_WIN_END
    fi
  done
  for key in "${!QG_FILE_LO[@]}"; do
    file=${key#f:}
    qg_ensure_lines "$file" "${QG_ROOT}/${file}" "${QG_FILE_LO["$key"]}" "${QG_FILE_HI["$key"]}"
  done
  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qg_queue_window "${B_FILE[$i]}" "${B_LINE[$i]}" "${B_RADIUS[$i]}"
  done
  qg_flush

  for i in "${!B_ID[@]}"; do
    [ "${B_CLASS[$i]}" = pending ] || continue
    qnorm=${QG_NORM_CACHE["k:${B_QUOTE[$i]}"]}
    if qg_search "${B_FILE[$i]}" "${B_LINE[$i]}" "${B_RADIUS[$i]}" "$qnorm"; then
      B_CLASS[i]=grounded
      B_MATCH[i]=$QG_MATCHED
    else
      B_CLASS[i]=ungrounded
    fi
  done
}

# check is a one-row batch with the radius it was given.
qg_check() {
  local file="$1" line="$2" radius="$3" quote="$4"
  B_ID=(check)
  B_FILE=("$file")
  B_LINE=("$line")
  B_QUOTE=("$quote")
  B_RADIUS=("$radius")
  B_CLASS=("")
  B_MATCH=("")
  qg_ground_rows
  case "${B_CLASS[0]}" in
    grounded)
      printf '%s\n' "${B_MATCH[0]}"
      exit 0
      ;;
    ungrounded | too-short | unsafe-path) exit 1 ;;
    *) exit 2 ;;
  esac
}

# Read the JSONL rows through one jq pass. jq prints the row count and then
# four NUL-terminated fields per row only after every row parsed, so a jq
# failure leaves the count unread and this function fails; the read never
# depends on a process substitution's exit status. jq reads raw lines (-R) and
# parses each one, so a blank or whitespace-only line fails the batch like any
# other non-JSON line; the newline that ends the last row is not a line. Each
# line must also be strict JSON: with its strings removed, only structure,
# true, false, null and RFC 8259 numbers may remain, because fromjson alone
# accepts Infinity, NaN, 01 and 1. and would change an id. A row
# that is not JSON, or has no usable id, fails the whole batch. A row with a usable id and a bad
# file, line or quote (wrong type, or U+0000 that would shift the framing)
# becomes line 0, which classifies as ungrounded. The id carries a type tag:
# n for a JSON number, s for a string.
qg_load_rows() {
  local n i id file line quote
  {
    if ! IFS= read -r -d '' n || [[ ! "$n" =~ ^[0-9]+$ ]]; then
      printf 'quote-ground: invalid batch input\n' >&2
      return 2
    fi
    for ((i = 0; i < n; i++)); do
      if ! IFS= read -r -d '' id || ! IFS= read -r -d '' file \
        || ! IFS= read -r -d '' line || ! IFS= read -r -d '' quote; then
        printf 'quote-ground: short batch record\n' >&2
        return 2
      fi
      B_ID+=("$id")
      B_FILE+=("$file")
      B_LINE+=("$line")
      B_QUOTE+=("$quote")
      B_RADIUS+=("$QG_DEFAULT_RADIUS")
      B_CLASS+=("")
      B_MATCH+=("")
    done
  } < <(jq -nRj '
    def strict:
      gsub("\"(?:[^\"\\\\]|\\\\.)*\""; "\"\"")
      | test("^(?:[\\[\\]{}:,\" \\t\\r]|(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)(?![0-9A-Za-z.+-]))*$");
    def parse:
      if test("^[ \t\r]*$") then error("blank record")
      elif strict then fromjson
      else error("not strict JSON") end;
    def hasnul: type == "string" and contains("\u0000");
    def tag: if type == "number" then "n" + tostring else "s" + . end;
    def row:
      if type != "object" then error("row is not an object")
      elif ((.id | type) != "string" and (.id | type) != "number") or (.id | hasnul)
        then error("row has no usable id")
      elif ((.file | type) == "string") and ((.quote | type) == "string")
        and ((.line | type) == "number" or (.line | type) == "string")
        and (([.file, .quote, (.line | tostring)] | any(hasnul)) | not)
        then [(.id | tag), .file, (.line | tostring), .quote]
      else [(.id | tag), "", "0", ""]
      end;
    [inputs | parse | row] as $rows
    | ($rows | length | tostring) + "\u0000", ($rows[][] + "\u0000")
  ')
}

# One jq call writes every result object, so jq escapes every control
# character. The fields reach jq over stdin, three lines per row, never as
# arguments, so a long id cannot exceed ARG_MAX. A backslash and a newline in
# the id are escaped as \\ and \n so one row stays three lines, and jq undoes
# that. Each value carries a one-character prefix that jq strips, so an id
# that starts with "-" is never misread; the id also keeps its type tag, so a
# numeric id is emitted as a number and the string "42" stays a string.
qg_emit_all() {
  local i result match id
  local bs='\'
  [ "${#B_ID[@]}" -gt 0 ] || return 0
  for i in "${!B_ID[@]}"; do
    result=${B_CLASS[$i]}
    if [ "$result" = missing ]; then
      result=ungrounded
    fi
    match=
    if [ "$result" = grounded ]; then
      match=${B_MATCH[$i]}
    fi
    id=${B_ID[$i]}
    id=${id//"$bs"/"$bs$bs"}
    id=${id//$'\n'/"${bs}n"}
    printf '%s\n%s\n%s\n' "i${id}" "r${result}" "m${match}"
  done | jq -nRc '
    def unesc: gsub("\\\\(?<c>[\\\\n])"; if .c == "n" then "\n" else "\\" end);
    [inputs] as $a | range(0; ($a | length); 3) as $i
    | {id: ($a[$i][1:] | unesc | if .[0:1] == "n" then (.[1:] | tonumber) else .[1:] end),
       result: $a[$i + 1][1:],
       matched_line: ($a[$i + 2][1:] | if test("^[0-9]+$") then tonumber else null end)}' || {
    printf 'quote-ground: could not write batch output\n' >&2
    exit 2
  }
}

qg_batch() {
  command -v jq >/dev/null 2>&1 || exit 2
  qg_load_rows || exit 2
  qg_ground_rows
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
    radius=$QG_DEFAULT_RADIUS
    if [ $# -ge 4 ]; then
      radius=$4
    fi
    if ! qg_is_line "$line" || ! qg_is_uint "$radius"; then
      exit 2
    fi
    qg_path_class "$file"
    case "$QG_ONE_CLASS" in
      unsafe-path) exit 1 ;;
      missing | unreadable) exit 2 ;;
    esac
    # read -d '' returns 0 only when it meets a NUL; a command substitution
    # would drop the byte and join the text either side of it.
    if IFS= read -r -d '' quote; then
      exit 1
    fi
    while [[ "$quote" == *$'\n' ]]; do quote=${quote%$'\n'}; done
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
