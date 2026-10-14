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
