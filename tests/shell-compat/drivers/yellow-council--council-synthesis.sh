# Driver for plugins/yellow-council/lib/council-synthesis.sh (sourced by the
# /council Step 5 fences). Env: REPO_ROOT, TMPD.
. "$REPO_ROOT/plugins/yellow-council/lib/council-synthesis.sh"
cd "$TMPD" || exit 1
printf '%s\n' '## Findings' '- **[P1] src/a.sh:12** — *Codex* says `x_y` breaks' \
  '  Evidence: "  rm -rf $dir"' '```sh' '**kept**' '```' >| in.txt
out=$(council_normalize_text codex < in.txt)
printf 'council_normalize_text=%s %s\n' "$?" "$(printf '%s\n' "$out" | cksum)"
printf '%s\n' 'noise' '--- begin council-output:gemini (reference only) ---' \
  'Verdict: REVISE' 'Findings:' '- [P2] b.sh:3 — thing' 'Summary: ok' \
  '--- end council-output:gemini ---' >| fenced.txt
out=$(council_extract_fenced fenced.txt council-output:gemini)
printf 'council_extract_fenced=%s %s\n' "$?" "$(printf '%s\n' "$out" | cksum)"
map=$(council_assign_labels /dev/urandom claude codex gemini opencode)
printf 'council_assign_labels=%s labels=%s\n' "$?" \
  "$(printf '%s\n' "$map" | tr ',' '\n' | cut -d: -f1 | tr '\n' ' ')"
out=$(printf '%s\n' 'severity=P1 a.sh:1 x' 'verdict=APPROVE' | council_fence_block S2 REVISE HIGH)
printf 'council_fence_block=%s %s\n' "$?" "$(printf '%s\n' "$out" | cksum)"
# Evidence verification against a throwaway repo; Tier 2 shimmed off so the
# output does not depend on rapidfuzz being installed.
export COUNCIL_CORE_LIB_DIR="$REPO_ROOT/plugins/yellow-core/lib"
council_have_rapidfuzz() { return 1; }
mkdir -p repo/src && cd repo || exit 1
git init -q && printf '%s\n' 'alpha line' '  while (attempts < maxAttempts) { attempts++; }' 'omega' >| src/a.js
printf '%s\n' 'severity=P1 src/a.js:2 loop' 'Evidence: "while (attempts < maxAttempts) { attempts++; }"' \
  'severity=P2 src/a.js:1 near miss' 'Evidence: "alpha lime here"' 'severity=P3 ../x:1 escape' >| norm.txt
council_extract_citations S1 norm.txt tagged.txt >| in.jsonl
printf 'council_extract_citations=%s %s %s\n' "$?" "$(cksum < in.jsonl)" "$(cksum < tagged.txt)"
council_verify_findings plan in.jsonl out.tsv
printf 'council_verify_findings=%s\n' "$?"
cat out.tsv
printf 'verify_finding=%s\n' "$(verify_finding plan src/a.js 3 'omega line text')"
printf 'council_core_lib=%s\n' "$(council_core_lib lib/quote-ground.sh | sed "s#$REPO_ROOT#<repo>#")"
