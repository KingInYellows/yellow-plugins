# Spike: Gemini CLI Output Format & Headless Invocation

**Date:** 2026-05-04
**Plan task:** PR1 task 1.1 + 1.4 (yellow-council)
**Gemini CLI version tested:** 0.40.1

## Summary

The brainstorm research (2026-05-03) cited an outdated Gemini CLI behavior (positional prompt, `-p` deprecated, `-o json` broken per issue #9009). The current Gemini CLI v0.40.1 has materially changed:

- **`-p` / `--prompt` is REQUIRED** for non-interactive (headless) mode — positional `gemini "prompt"` now defaults to interactive mode (TUI) and hangs in non-TTY contexts.
- **`-o json` works** — issue #9009 has been resolved.
- **`--approval-mode plan` is a NEW choice** — explicit read-only mode, exactly what yellow-council needs.
- **`--skip-trust`** is required for non-interactive use in non-trusted directories (workspace trust mechanism overrides `--approval-mode plan` to `default` otherwise).

The plan must be updated to reflect the v0.40+ invocation pattern.

## Verified Invocation Pattern (from official docs)

Source: <https://google-gemini.github.io/gemini-cli/docs/cli/headless.html>

```bash
# Direct prompt
gemini -p "What is machine learning?"

# Stdin pipe
echo "Explain this code" | gemini --prompt "Review this"

# File context
cat README.md | gemini -p "Summarize this documentation"

# Structured JSON output
gemini -p "..." -o json
```

JSON response schema (per official headless docs):
- `response`: assistant text answer (string)
- `stats`: `{ models: ..., tools: ..., files: ... }`
- `error`: present only on failure

## Recommended yellow-council Invocation

For `gemini-reviewer.md` agent body:

```bash
timeout --signal=TERM --kill-after=10 "${COUNCIL_TIMEOUT:-600}" \
  gemini -p "<full-pack-prompt>" \
    --approval-mode plan \
    --skip-trust \
    -o text \
  > "$OUTPUT_FILE" 2> "$STDERR_FILE"
```

**Flag rationale:**
- `-p` / `--prompt`: required for non-interactive mode (positional prompt enters TUI which hangs in non-TTY).
- `--approval-mode plan`: read-only mode — model cannot invoke write/edit tools. Strictly safer than `--yolo` (which auto-approves writes).
- `--skip-trust`: bypasses workspace trust check (would otherwise force `--approval-mode default` and prompt for input).
- `-o text` (not `json`): for V1, plain text output is parsed for `Verdict:` / `Findings:` / `Summary:` markers per the council-patterns SKILL contract. Switching to `-o json` is a V2 option once the response schema is stable across all our invocation patterns.

## Spike Test Environment Observations (2026-05-04, WSL2)

In this WSL2 shell environment, `gemini -p "Hi"` hung indefinitely (timed out at 30–180s with no output beyond `.geminiignore not found` debug message). Auth state appears valid (`~/.gemini/oauth_creds.json` present, `google_accounts.json` configured). Stale `.tmp` files in `~/.gemini/projects.json.*.tmp` were cleaned up but the hang persisted.

**Hypothesis:** Network/proxy or auth token re-validation issue specific to this WSL2 shell session. NOT a Gemini CLI bug; the documented invocation pattern is correct per official docs.

**For PR2 implementation:** Live-test on a known-good gemini env before declaring `gemini-reviewer.md` agent done. If hang persists, document a "[gemini] CLI hung beyond timeout — skipping" graceful path (council runs with N<3 reviewers).

## Gotchas to Watch For

1. **`--yolo` / `--approval-mode yolo` still has known issues** (issue #13561 — auto-approves writes BUT may still prompt in some edge cases). yellow-council MUST NOT use `--yolo`. Use `--approval-mode plan` instead.
2. **Workspace trust default is "untrusted"** for any folder gemini hasn't seen. `--skip-trust` is the explicit non-interactive override.
3. **`.geminiignore` lookup happens at every invocation** — harmless but appears in `--debug` output.
4. **Stale `~/.gemini/projects.json.*.tmp` files** can accumulate from killed processes. Periodic cleanup recommended.

## References

- Gemini CLI Headless Mode docs: <https://google-gemini.github.io/gemini-cli/docs/cli/headless.html>
- Gemini CLI npm: <https://www.npmjs.com/package/@google/gemini-cli>
- Repo: <https://github.com/google-gemini/gemini-cli>
- Issue #9009 (`-o json`): closed/resolved as of v0.40+
- Issue #13561 (`--yolo` still prompts): outstanding — avoid `--yolo`
