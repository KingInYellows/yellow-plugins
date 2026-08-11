#!/usr/bin/env bash
#
# exercise-flow-namespace-gate.sh
#
# Proves that scripts/validate-flow-namespace.js actually fires. A gate that
# ships unexercised emits no CI signal — the exact failure mode documented in
# docs/solutions/integration-issues/codex-distribution-pipeline-silent-gaps.md,
# which went unnoticed for months.
#
# Every probe writes into the real repository and is reverted before exit, so
# a failed run leaves nothing behind except (possibly) the probe file, which
# the gate itself would then flag on the next run.
#
# NOTE ON THE BANNED LITERAL: the probe strings are assembled by concatenation
# (`${OLD}:work` where OLD='workflow'+'s') rather than written out, so this
# file does not itself contain the pattern the gate bans and needs no
# permanent allowlist entry. Same idiom scripts/validate-solutions.js uses to
# stay out of scripts/lint-error-codes.js's way.
#
# Usage: bash scripts/exercise-flow-namespace-gate.sh
# Exit:  0 = every probe behaved as expected, 1 = at least one did not.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

GATE=scripts/validate-flow-namespace.js
ALLOW=scripts/flow-namespace-allowlist.json
PROBE=docs/testing/__flow-ns-gate-probe.md
OLD="workflow"'s' # assembled, see NOTE above
NS='ERROR-'"NAMESPACE" # assembled like validate-flow-namespace.js's own NS — never a literal catalog code

# -e alone is not enough: it is FALSE for a dangling symlink, so a symlink
# planted at this path would slip past the guard and `>` would follow it,
# writing (and later deleting) an arbitrary file outside the repo. -L catches
# every symlink, dangling or not.
if [ -e "$PROBE" ] || [ -L "$PROBE" ]; then
  printf '[flow-namespace-gate] Error: probe file %s already exists.\n' "$PROBE" >&2
  printf '[flow-namespace-gate] Move or delete it before running this script.\n' >&2
  exit 1
fi
PROBE_CREATED=0

BAK=$(mktemp) || exit 1
if ! cp "$ALLOW" "$BAK"; then
  printf 'ERROR: failed to back up %s to %s\n' "$ALLOW" "$BAK" >&2
  rm -f "$BAK"
  exit 1
fi

pass=0
fail=0

restoreAllowlist() { # copies $BAK back over $ALLOW, reporting failure
  if [ -f "$BAK" ] && cp "$BAK" "$ALLOW"; then
    return 0
  fi
  printf 'ERROR: failed to restore %s from %s\n' "$ALLOW" "$BAK" >&2
  return 1
}

cleanup() {
  if [ "$PROBE_CREATED" -eq 1 ]; then
    rm -f "$PROBE"
  fi
  restoreAllowlist
  rm -f "$BAK"
}
trap cleanup EXIT

writeProbe() { # fmt [args...] — printf's to $PROBE, marking it ours for cleanup's trap
  fmt="$1"
  shift
  printf "$fmt" "$@" >"$PROBE" && PROBE_CREATED=1
}

runGate() { # outfile — runs the gate, capturing combined stdout+stderr, returns its exit code
  node "$GATE" >"$1" 2>&1
  return $?
}

check() { # name want_exit got_exit [want_code outfile]
  name="$1"
  want_exit="$2"
  got_exit="$3"
  want_code="${4:-}"
  outfile="${5:-}"
  if [ "$got_exit" -ne "$want_exit" ]; then
    printf '  FAIL  %s (want exit %s, got %s)\n' "$name" "$want_exit" "$got_exit"
    if [ -n "$outfile" ] && [ -f "$outfile" ]; then
      printf '        --- captured output ---\n'
      sed 's/^/        /' "$outfile"
    fi
    fail=$((fail + 1))
    return
  fi
  if [ -n "$want_code" ] && ! grep -q -- "$want_code" "$outfile"; then
    printf '  FAIL  %s (exit %s ok, but %s not found in output)\n' "$name" "$got_exit" "$want_code"
    printf '        --- captured output ---\n'
    sed 's/^/        /' "$outfile"
    fail=$((fail + 1))
    return
  fi
  printf '  PASS  %s (exit %s)\n' "$name" "$got_exit"
  pass=$((pass + 1))
}

echo "=== A. clean tree exits 0 ==="
node "$GATE" >/dev/null 2>&1
check "clean tree" 0 $?

echo
echo "=== B. ERROR-NAMESPACE-001: each banned shape in a NON-allowlisted file ==="
for shape in "/${OLD}:work" "skill: \"${OLD}:work\"" "yellow-core:${OLD}:work"; do
  writeProbe '# gate probe\n\n%s\n' "$shape"
  OUT=$(mktemp) || exit 1
  runGate "$OUT"
  check "shape [$shape]" 1 $? "${NS}-001" "$OUT"
  rm -f "$OUT"
  rm -f "$PROBE"
done

echo
echo "=== C. singular 'workflow:' agent namespace must NOT trip the gate ==="
writeProbe '# gate probe\n\nyellow-core:workflow:knowledge-compounder\nworkflow:work\n'
node "$GATE" >/dev/null 2>&1
check "singular workflow: ignored" 0 $?
rm -f "$PROBE"

echo
echo "=== D. non-command suffixes must NOT trip the gate ==="
writeProbe '# gate probe\n\n%s:worker  %s:planetary\n' "$OLD" "$OLD"
node "$GATE" >/dev/null 2>&1
check "workflows:worker / :planetary ignored" 0 $?
rm -f "$PROBE"

echo
echo "=== E. COLLECTIVE_FORMS: glob and placeholder namespace forms trip; double-asterisk bold and single-asterisk italic around the ordinary word stay clean ==="
writeProbe '# gate probe\n\n`%s:*` glob\n' "$OLD"
node "$GATE" >/dev/null 2>&1
check "backtick-prefixed glob form" 1 $?
rm -f "$PROBE"

writeProbe '# gate probe\n\n/%s:* glob\n' "$OLD"
node "$GATE" >/dev/null 2>&1
check "slash-prefixed glob form" 1 $?
rm -f "$PROBE"

writeProbe '# gate probe\n\n%s:<cmd> placeholder\n' "$OLD"
node "$GATE" >/dev/null 2>&1
check "collective placeholder form" 1 $?
rm -f "$PROBE"

writeProbe '# gate probe\n\n**Template-driven %s:**\n' "$OLD"
node "$GATE" >/dev/null 2>&1
check "markdown bold double-asterisk ignored" 0 $?
rm -f "$PROBE"

# Regression probe: italic closes with a single `*`, the same character the
# bare glob uses, right after the ordinary word "workflows:" — this is what
# validate-flow-namespace.js's keepMatch() must NOT flag. See its docstring.
writeProbe '# gate probe\n\n*Template-driven %s:*\n' "$OLD"
node "$GATE" >/dev/null 2>&1
check "markdown italic single-asterisk (ordinary word) ignored" 0 $?
rm -f "$PROBE"

echo
echo "=== F. ERROR-NAMESPACE-002: allowlist count drift (fingerprint mismatch) ==="
node -e '
const fs = require("fs"), p = process.argv[1];
const a = JSON.parse(fs.readFileSync(p, "utf8"));
const k = Object.keys(a)[0];
if (!k) { console.error("allowlist empty — count-drift probe not applicable"); process.exit(2); }
const cmd = Object.keys(a[k])[0];
a[k][cmd] += 1;
fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
' "$ALLOW"
if [ $? -eq 2 ]; then
  echo "  SKIP  count drift (allowlist is empty — terminal state reached)"
else
  OUT=$(mktemp) || exit 1
  runGate "$OUT"
  check "count drift" 1 $? "${NS}-002" "$OUT"
  rm -f "$OUT"
fi
restoreAllowlist || exit 1

echo
echo "=== G. ERROR-NAMESPACE-002: same-total command substitution must trip the gate ==="
# Recorded fingerprint says 2 of one command + 1 of another (total 3). The
# probe file actually has 1 + 2 (also total 3) — a total-only allowlist would
# see the totals match and miss this; per-command fingerprint comparison must
# still catch the drift.
node -e '
const fs = require("fs"), p = process.argv[1], probe = process.argv[2];
const a = JSON.parse(fs.readFileSync(p, "utf8"));
a[probe] = { "work": 2, "plan": 1 };
fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
' "$ALLOW" "$PROBE"
writeProbe '# gate probe\n\n%s:work\n%s:plan\n%s:plan\n' "$OLD" "$OLD" "$OLD"
OUT=$(mktemp) || exit 1
runGate "$OUT"
check "same-total command substitution" 1 $? "${NS}-002" "$OUT"
rm -f "$OUT"
rm -f "$PROBE"
restoreAllowlist || exit 1

echo
echo "=== H. ERROR-NAMESPACE-002: allowlisted file that is now clean ==="
node -e '
const fs = require("fs"), p = process.argv[1];
const a = JSON.parse(fs.readFileSync(p, "utf8"));
a["README.md"] = { "work": 3 };
fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
' "$ALLOW"
OUT=$(mktemp) || exit 1
runGate "$OUT"
check "stale allowlist entry (file is clean)" 1 $? "${NS}-002" "$OUT"
rm -f "$OUT"
restoreAllowlist || exit 1

echo
echo "=== I. ERROR-NAMESPACE-003: allowlisted path missing from disk ==="
node -e '
const fs = require("fs"), p = process.argv[1];
const a = JSON.parse(fs.readFileSync(p, "utf8"));
a["docs/__deleted-by-a-later-sweep.md"] = { "work": 2 };
fs.writeFileSync(p, JSON.stringify(a, null, 2) + "\n");
' "$ALLOW"
OUT=$(mktemp) || exit 1
runGate "$OUT"
check "missing allowlist path" 1 $? "${NS}-003" "$OUT"
rm -f "$OUT"
restoreAllowlist || exit 1

echo
echo "=== J. tree restored, gate green again ==="
node "$GATE" >/dev/null 2>&1
check "restored" 0 $?

echo
printf 'RESULT: %s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
