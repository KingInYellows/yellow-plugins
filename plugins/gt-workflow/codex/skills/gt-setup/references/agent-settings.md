### Phase 2: Configure Graphite Settings for AI Agents

#### Step 4: Show Planned Changes

Before applying any settings, read current values and show what will change. Run
a single Bash call:

```bash
printf '=== Current Graphite User Settings ===\n'
gt user branch-prefix 2>/dev/null || printf 'branch-prefix: (not set / command unavailable)\n'
gt user branch-date 2>/dev/null || printf 'branch-date: (command unavailable)\n'
gt user restack-date 2>/dev/null || printf 'restack-date: (command unavailable)\n'
gt user submit-body 2>/dev/null || printf 'submit-body: (command unavailable)\n'
gt user pager 2>/dev/null || printf 'pager: (command unavailable)\n'
```

Present a summary table showing current vs recommended AI-agent values for each
setting. Then proceed to the interactive prompts below.

#### Step 5: Branch Prefix Prompt

(`AskUserQuestion` is a Claude Code tool — on Codex, ask each question as a
numbered-option list in your reply and wait for the user's answer before
proceeding; this applies to every AskUserQuestion mention in this skill.)

Use `AskUserQuestion` to ask: "What branch prefix should AI agents use?"

Options:

- `"agent/" (Recommended)` — flat namespace for agent-created branches
- `"Skip"` — keep the current branch-prefix setting unchanged

The "Other" button allows free-text input for a custom prefix.

**If the user provides a custom prefix via "Other", validate it:**

- Must start with a lowercase letter or digit (`[a-z0-9]`)
- Allowed subsequent characters: lowercase letters, digits, `/`, `_`, `-` only
- Reject if it contains `..`, `~`, spaces, or any character outside
  `[a-z0-9/_-]`
- Normalize: append trailing `/` if missing
- Max length: 20 characters (checked **after** normalization, so the effective
  input limit is 19 characters when a trailing `/` is appended)
- If validation fails, explain the constraint and re-prompt with AskUserQuestion

Store the chosen prefix (or empty string if skipped) for use in Step 7 and
Phase 3.

#### Step 6: Pager Prompt

Use `AskUserQuestion` to ask: "Disable the Graphite CLI pager? AI agents hang
when pager is enabled."

Options:

- `"Disable pager (Recommended for AI agents)"` — will run
  `gt user pager --disable`
- `"Keep current pager setting"` — no change

If user chooses "Keep", note this in the summary. If user chooses "Disable",
include reversal instructions in the final report: "To re-enable:
`gt user pager --enable`"

#### Step 7: Apply Settings

Apply settings via `gt user` commands. Run each in a separate Bash call to
isolate failures. Track the result of each command.

**Settings to apply (in this order):**

1. `gt user branch-date --disable` (if not already disabled)
2. `gt user restack-date --use-author-date` (if not already set)
3. `gt user submit-body --include-commit-messages` (if not already set)
4. Branch prefix (if user provided one in Step 5): run Substitute the validated
   prefix as a literal value in single quotes, e.g.,
   `gt user branch-prefix --set 'agent/'` — never use shell variable
   interpolation for user-supplied text
5. `gt user pager --disable` (only if user chose to disable in Step 6)

**Failure handling:** If any command fails:

- Record the error output
- Continue applying remaining settings (do not stop on first failure)
- After all commands, show a summary with status for each:
  - "Applied" — command succeeded
  - "Already set" — current value matches target, no change needed
  - "Failed" — command failed (show error)
  - "Skipped" — user chose not to change this setting

If any commands failed, note the failures in the summary and proceed to Phase 3.
The user can re-run `gt-setup` to retry.

#### Step 8: Settings Summary

Show the final state of all 5 settings:

```text
Graphite Settings Configuration
────────────────────────────────
branch-date:     disabled (Applied)
restack-date:    use-author-date (Applied)
submit-body:     include-commit-messages (Applied)
branch-prefix:   agent/ (Applied)
pager:           disabled (Applied) — to re-enable: gt user pager --enable
```
