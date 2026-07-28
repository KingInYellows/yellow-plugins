# Deterministic property-test generator for redact_secrets() quoted-value
# handling, used by redaction.bats.
#
# Three consecutive rounds of hand-enumerated fixtures each fixed the
# previous round's leak and introduced a new one (escaped quotes -> excluded
# the escape chars from the value class -> sentinel byte from an earlier
# rule's marker excluded from the same class -> leaked the marker's trailing
# suffix). Enumerated cases only ever encode the LAST bug found. This
# generator instead builds randomized quoted-credential lines from
# combinable pieces — quote style, escaped delimiters, an embedded token
# already recognized by an earlier, more specific rule (the exact
# sentinel-interaction shape), and trailing content — and checks the
# invariant that actually matters: no byte of what went INSIDE the quotes
# survives redaction, regardless of which combination of pieces produced it.
#
# Seeded via bash's $RANDOM (`RANDOM=<seed>` reseeds the deterministic PRNG),
# so a failure is reproducible by re-running with the same seed and
# iteration count logged in the failure message.

_fuzz_charset='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

# fuzz_random_string LEN -> stdout (alnum only, no quotes/backslashes)
fuzz_random_string() {
  local len="$1" out="" i
  for ((i = 0; i < len; i++)); do
    out+="${_fuzz_charset:$((RANDOM % ${#_fuzz_charset})):1}"
  done
  printf '%s' "$out"
}

# fuzz_random_upper LEN -> stdout (upper+digit only, for AKIA-shaped chunks)
fuzz_random_upper() {
  local len="$1" charset='ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789' out="" i
  for ((i = 0; i < len; i++)); do
    out+="${charset:$((RANDOM % ${#charset})):1}"
  done
  printf '%s' "$out"
}

# Prints one chunk shaped to match an EARLIER, more specific redact_secrets
# rule (github/AWS/docker/npm/pypi/JWT/Bearer) so the generated line
# exercises the exact sentinel-interaction path: that rule substitutes part
# of the quoted value with its own `\x01REDACTED:<label>]` marker before any
# quoted-value rule ever runs.
fuzz_token_shaped_chunk() {
  case $((RANDOM % 8)) in
    0) printf 'ghp_%s' "$(fuzz_random_string 40)" ;;
    1) printf 'AKIA%s' "$(fuzz_random_upper 16)" ;;
    2) printf 'dckr_pat_%s' "$(fuzz_random_string 36)" ;;
    3) printf 'npm_%s' "$(fuzz_random_string 36)" ;;
    4) printf 'pypi-%s' "$(fuzz_random_string 36)" ;;
    5) printf 'github_pat_%s' "$(fuzz_random_string 25)" ;;
    6) printf 'Bearer %s' "$(fuzz_random_string 24)" ;;
    7) printf 'eyJ%s.eyJ%s.%s' "$(fuzz_random_string 15)" "$(fuzz_random_string 15)" "$(fuzz_random_string 20)" ;;
  esac
}

# Generates one randomized case into globals:
#   FUZZ_LINE           - the full line to feed redact_secrets
#   FUZZ_SECRET_CHUNKS  - array of substrings that must NOT survive in the output
#   FUZZ_SAFE_MARKER    - non-empty when trailing prose OUTSIDE the quotes was
#                         added; that marker MUST survive verbatim (over-redaction guard)
fuzz_generate_case() {
  local -a keys=(password passwd pwd secret token api_key apikey credential private_key)
  local -a forms=(assign_eq assign_colon export_eq flag_long flag_short)
  local key="${keys[$((RANDOM % ${#keys[@]}))]}"
  local key_upper
  key_upper="$(printf '%s' "$key" | tr '[:lower:]' '[:upper:]')"
  local form="${forms[$((RANDOM % ${#forms[@]}))]}"
  local quote esc_delim
  if ((RANDOM % 2 == 0)); then
    quote='"'
    esc_delim=$(printf '\\"')
  else
    quote="'"
    esc_delim=$(printf "\\\\'")
  fi
  local esc_backslash
  esc_backslash=$(printf '\\\\')

  FUZZ_SECRET_CHUNKS=()
  local value="" chunk

  # Leading chunk (always present).
  chunk="$(fuzz_random_string $((6 + RANDOM % 10)))"
  value="$chunk"
  FUZZ_SECRET_CHUNKS+=("$chunk")

  # Escaped delimiter mid-value (~40%): must be consumed as part of the
  # value, never mistaken for the closing quote.
  if ((RANDOM % 5 < 2)); then
    value+=" ${esc_delim}"
  fi

  # Escaped backslash mid-value (~30%).
  if ((RANDOM % 10 < 3)); then
    value+=" ${esc_backslash}"
  fi

  # Embedded token-shaped chunk (~60%): exercises the sentinel-interaction
  # path directly — an earlier rule pre-substitutes this before the
  # quoted-value rule runs.
  if ((RANDOM % 5 < 3)); then
    chunk="$(fuzz_token_shaped_chunk)"
    value+=" ${chunk}"
    FUZZ_SECRET_CHUNKS+=("$chunk")
  fi

  # Trailing chunk AFTER the (possibly embedded-token) content but still
  # INSIDE the quotes — the exact reported-bug shape (a real secret's
  # trailing suffix left exposed after an earlier rule's marker).
  chunk="$(fuzz_random_string $((6 + RANDOM % 10)))"
  value+=" ${chunk}"
  FUZZ_SECRET_CHUNKS+=("$chunk")

  local prefix
  case "$form" in
    assign_eq) prefix="${key_upper}=" ;;
    assign_colon) prefix="${key}: " ;;
    export_eq) prefix="export ${key_upper}=" ;;
    flag_long) prefix="--${key} " ;;
    flag_short) prefix="-p " ;;
  esac

  FUZZ_LINE="${prefix}${quote}${value}${quote}"

  # Trailing prose OUTSIDE the quotes (~50%): must survive untouched.
  FUZZ_SAFE_MARKER=""
  if ((RANDOM % 2 == 0)); then
    FUZZ_SAFE_MARKER="safeprose$(fuzz_random_string 8)"
    FUZZ_LINE+=" and then normal text ${FUZZ_SAFE_MARKER} here"
  fi
}
