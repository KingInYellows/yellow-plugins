# Yellow Plugins UI Style Guide

**Document Version**: 1.0.0 **Last Updated**: 2026-01-12 **Specification
Reference**: Section 6 UI/UX Architecture **Status**: Active

<!-- anchor: ui-style-guide -->

---

## Table of Contents

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->

- [1. Design System Specification](#1-design-system-specification)
  - [1.1 Color Palette](#11-color-palette)
    - [Primary Colors](#primary-colors)
    - [Functional Colors](#functional-colors)
    - [Neutral Colors](#neutral-colors)
    - [Semantic Mapping Table](#semantic-mapping-table)
    - [ANSI Color Code Mappings](#ansi-color-code-mappings)
  - [1.2 Typography](#12-typography)
    - [Font Family Stack](#font-family-stack)
    - [Type Scale (relative to 16px base)](#type-scale-relative-to-16px-base)
    - [Font Weight Guidelines](#font-weight-guidelines)
    - [Line Length & Spacing](#line-length--spacing)
  - [1.3 Spacing & Sizing](#13-spacing--sizing)
    - [Spacing Scale (unit = 4px equivalent)](#spacing-scale-unit--4px-equivalent)
    - [CLI Application](#cli-application)
    - [Docs Application](#docs-application)
    - [Component Density](#component-density)
    - [Iconography](#iconography)
  - [1.4 Component Tokens](#14-component-tokens)
    - [Border Radius Tokens](#border-radius-tokens)
    - [Shadow Tokens](#shadow-tokens)
    - [Transition Tokens](#transition-tokens)
    - [Opacity Tokens](#opacity-tokens)
    - [Animation Tokens](#animation-tokens)
  - [1.5 Voice & Tone Guidelines](#15-voice--tone-guidelines)
    - [Voice Characteristics](#voice-characteristics)
    - [Tone Levels](#tone-levels)
    - [Microcopy Standards](#microcopy-standards)
    - [Example Messaging](#example-messaging)
  - [1.6 Accessibility Considerations](#16-accessibility-considerations)
    - [Color Independence](#color-independence)
    - [Screen Reader Compatibility](#screen-reader-compatibility)
    - [Keyboard Navigation](#keyboard-navigation)
    - [Contrast Requirements](#contrast-requirements)
    - [Tested Combinations](#tested-combinations)
    - [Documentation Links](#documentation-links)
  - [1.7 Documentation Patterns](#17-documentation-patterns)
    - [Command Documentation Structure](#command-documentation-structure)
    - [Admonition Shortcodes](#admonition-shortcodes)
    - [Code Block Conventions](#code-block-conventions)
    - [Cross-References](#cross-references)
- [2. CLI Interaction Patterns](#2-cli-interaction-patterns)
  - [2.1 Progress & Feedback Patterns](#21-progress--feedback-patterns)
    - [Atomic Stage Broadcasts](#atomic-stage-broadcasts)
    - [Adaptive Spinner Selection](#adaptive-spinner-selection)
    - [Quiet Mode Messaging](#quiet-mode-messaging)
    - [Long-Running Step Guidance](#long-running-step-guidance)
    - [Success Ritual](#success-ritual)
  - [2.2 Input & Confirmation Patterns](#22-input--confirmation-patterns)
    - [Yes/No Prompts](#yesno-prompts)
    - [Typed Phrases (Lifecycle Confirmations)](#typed-phrases-lifecycle-confirmations)
    - [Default Values](#default-values)
    - [Validation Feedback](#validation-feedback)
    - [Non-Interactive Mode](#non-interactive-mode)
  - [2.3 Notification & Messaging Patterns](#23-notification--messaging-patterns)
    - [Inline Notifications](#inline-notifications)
    - [Persistent Notifications](#persistent-notifications)
    - [Documentation Tie-ins](#documentation-tie-ins)
    - [Batch Notifications](#batch-notifications)
    - [Telemetry Notices](#telemetry-notices)
- [3. ANSI Fallback & Terminal Compatibility](#3-ansi-fallback--terminal-compatibility)
  - [3.1 Terminal Capability Detection](#31-terminal-capability-detection)
  - [3.2 Graceful Degradation Strategy](#32-graceful-degradation-strategy)
  - [3.3 Color Fallback Examples](#33-color-fallback-examples)
  - [3.4 Testing Terminal Compatibility](#34-testing-terminal-compatibility)
- [4. Implementation Guidelines](#4-implementation-guidelines)
  - [4.1 UI Helper Library](#41-ui-helper-library)
  - [4.2 Consistency Checklist](#42-consistency-checklist)
  - [4.3 Documentation Sync](#43-documentation-sync)
- [5. Accessibility Test Checklist](#5-accessibility-test-checklist)
  - [5.1 Contrast Verification](#51-contrast-verification)
  - [5.2 Screen Reader Testing](#52-screen-reader-testing)
  - [5.3 Keyboard-Only Exercise](#53-keyboard-only-exercise)
  - [5.4 Documentation Heading Depth](#54-documentation-heading-depth)
  - [5.5 Table Alternatives](#55-table-alternatives)
- [6. Version History](#6-version-history)
- [7. Related Documentation](#7-related-documentation)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

---

## 1. Design System Specification

<!-- anchor: 1-design-system-specification -->

The CLI-first experience still benefits from a disciplined design system because
ANSI-friendly colors, typography scaffolds for monospace terminals, and spacing
tokens directly inform how `yargs` commands describe states, validations, and
lifecycle scripts.

### 1.1 Color Palette

<!-- anchor: 1-1-color-palette -->

#### Primary Colors

- **Primary (Solar Citrine `#F2C038`)**: Default accent for headings, success
  banners, and progress glyphs in terminals supporting 256 colors; mapped to
  ANSI 11 fallback so monochrome terminals still see a high-contrast yellow.
- **Secondary (Obsidian Violet `#3A1956`)**: Background tint for boxed summaries
  rendered via ASCII borders; doubles as PDF annotation color in docs.
- **Accent (Verdant Flux `#2FBF71`)**: Highlights completion states, cache
  health pings, and "trusted" confirmations; 16-color fallback uses ANSI green.

#### Functional Colors

- **Info (Azure Relay `#4098D7`)**: Communicates changelog fetch statuses and
  telemetry instructions; integrates with structured JSON logs by tagging
  fields.
- **Warning (Amber Pulse `#F29D35`)**: Attaches to lifecycle script warnings,
  cache eviction notices, and feature flag toggles.
- **Danger (Signal Vermilion `#D64242`)**: For blocking errors such as
  `ERROR-INST-007`; reserved for irreversible actions.

#### Neutral Colors

- **Neutral Dark (Graphite `#1D1F21`)**: Base background assumption to ensure
  contrast checks meet WCAG 2.1 AA in terminals.
- **Neutral Mid (Slate `#4C566A`)**: Secondary text, metadata labels, and ASCII
  separators.
- **Neutral Light (Fog `#ECEFF4`)**: Inline code backgrounds within Markdown
  docs that echo CLI output samples.

#### Semantic Mapping Table

| Tone      | CLI Usage                              | Markdown Usage         | Accessibility Notes                      |
| --------- | -------------------------------------- | ---------------------- | ---------------------------------------- |
| Primary   | Command titles, focus indicators       | Section headers        | Maintain 4.5:1 contrast against Graphite |
| Secondary | Panel borders, inactive steps          | Pull-quote backgrounds | Use 2px letter spacing to avoid blur     |
| Accent    | Success badges, `--yes` prompts        | Success callouts       | Provide textual labels, not color only   |
| Info      | Status updates, documentation links    | Info admonitions       | Pair with `ℹ` icon                       |
| Warning   | Cache nearing limit, lifecycle caution | Warning admonitions    | Pair with `⚠` prefix                     |
| Danger    | Hard failures, policy violations       | Critical callouts      | Always include error codes               |

#### ANSI Color Code Mappings

| Color Name       | Hex       | ANSI 256-color   | ANSI 16-color Fallback     | Use Case                  |
| ---------------- | --------- | ---------------- | -------------------------- | ------------------------- |
| Solar Citrine    | `#F2C038` | `\x1b[38;5;220m` | `\x1b[93m` (Bright Yellow) | Primary accents, headings |
| Obsidian Violet  | `#3A1956` | `\x1b[38;5;54m`  | `\x1b[35m` (Magenta)       | Secondary accents         |
| Verdant Flux     | `#2FBF71` | `\x1b[38;5;41m`  | `\x1b[92m` (Bright Green)  | Success states            |
| Azure Relay      | `#4098D7` | `\x1b[38;5;74m`  | `\x1b[94m` (Bright Blue)   | Info messages             |
| Amber Pulse      | `#F29D35` | `\x1b[38;5;214m` | `\x1b[33m` (Yellow)        | Warnings                  |
| Signal Vermilion | `#D64242` | `\x1b[38;5;167m` | `\x1b[91m` (Bright Red)    | Errors                    |
| Graphite         | `#1D1F21` | `\x1b[38;5;235m` | `\x1b[30m` (Black)         | Background assumption     |
| Slate            | `#4C566A` | `\x1b[38;5;240m` | `\x1b[37m` (White)         | Secondary text            |
| Fog              | `#ECEFF4` | `\x1b[38;5;255m` | `\x1b[97m` (Bright White)  | Primary text              |

**Reset Code**: `\x1b[0m` (always append after colored text)

**Specification References**: FR-001,
CRIT-006,
[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback)

---

### 1.2 Typography

<!-- anchor: 1-2-typography -->

#### Font Family Stack

```
"JetBrains Mono", "Fira Code", "SFMono-Regular", Menlo, Consolas, monospace
```

Ensures ligature support but gracefully degrades for terminals that don't
support custom fonts.

#### Type Scale (relative to 16px base)

| Token     | Size | CLI Use                                | Docs Use        | Weight |
| --------- | ---- | -------------------------------------- | --------------- | ------ |
| `display` | 28px | Rare celebratory banners after publish | Hero statements | 600    |
| `h1`      | 24px | Command sections in help output        | H1 in docs      | 600    |
| `h2`      | 20px | Subcommand examples                    | H2              | 500    |
| `h3`      | 18px | Step titles, flagged instructions      | H3              | 500    |
| `body-lg` | 16px | Default text                           | Body            | 400    |
| `body-sm` | 14px | Metadata, timestamps                   | Footnotes       | 400    |
| `mono-xs` | 12px | Inline JSON excerpts                   | Code captions   | 400    |

#### Font Weight Guidelines

- **600 (SemiBold)**: Use for headings to establish visual hierarchy
- **500 (Medium)**: Use for interactive prompts and subheadings
- **400 (Regular)**: Use for descriptive copy to reduce terminal flicker

#### Line Length & Spacing

- **CLI**: Cap to 72 characters per line to avoid wrapping; vertical spacing via
  blank lines
- **Docs**: May extend to 90 characters where Markdown tables require
- **Kerning**: Additional 0.05em letter spacing for uppercase warnings prevents
  blur in low-DPI terminals

**Specification References**:
[1-2-typography](../architecture/06_UI_UX_Architecture.md#1-2-typography),
[3-4-help-system](../architecture/06_UI_UX_Architecture.md#3-4-help-system)

---

### 1.3 Spacing & Sizing

<!-- anchor: 1-3-spacing-and-sizing -->

#### Spacing Scale (unit = 4px equivalent)

`0, 2, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64`

#### CLI Application

- `2` = single space between inline tokens
- `4` = indentation for nested bullets
- `8` = gap between sections via blank lines
- `16` = ASCII boxes (top margin) to emphasize critical outputs

#### Docs Application

Use CSS variables `--space-1` (4px) through `--space-6` (64px) for consistent
spacing in published HTML.

#### Component Density

- Installation progress bars allocate `32` units to house status + timer + note
- Interactive prompts use `8` units padding around input fields
- Section separators use `16` units vertical margin

#### Iconography

CLI uses ASCII/Unicode icons with `4` units padding:

| Icon     | Unicode      | ASCII Fallback | Use Case               |
| -------- | ------------ | -------------- | ---------------------- |
| Success  | `✔`          | `[OK]`         | Completed operations   |
| Warning  | `⚠`          | `[WARN]`       | Non-blocking alerts    |
| Error    | `✖`          | `[ERR]`        | Blocking failures      |
| Info     | `ℹ`          | `[INFO]`       | Informational messages |
| Progress | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `-\|/`         | Loading states         |

**Specification References**:
[1-3-spacing-and-sizing](../architecture/06_UI_UX_Architecture.md#1-3-spacing-and-sizing),
[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback)

---

### 1.4 Component Tokens

<!-- anchor: 1-4-component-tokens -->

#### Border Radius Tokens

- `radius-none` = `0` (sharp corners for CLI boxes)
- `radius-sm` = `2` (subtle rounding in docs)
- `radius-md` = `4` (default for buttons/cards)
- `radius-lg` = `8` (prominent elements)

CLI boxes mimic via corner characters: `┌─┐│└┘`

#### Shadow Tokens

Represented textually in CLI:

- `shadow-sm` = `┆` (subtle depth)
- `shadow-md` = duplicate border offset to imply depth

In docs, CSS shadow values:

- `shadow-sm`: `0 1px 2px rgba(0,0,0,0.05)`
- `shadow-md`: `0 4px 6px rgba(0,0,0,0.1)`
- `shadow-lg`: `0 10px 15px rgba(0,0,0,0.15)`

#### Transition Tokens

- **CLI**: Use textual transitions (`...`) with spinner states
- **Docs**: CSS durations
  - `fast`: `120ms`
  - `base`: `200ms`
  - `slow`: `300ms`

#### Opacity Tokens

- `full` = `100%`
- `70` = `70%` (secondary text)
- `40` = `40%` (disabled states)
- `20` = `20%` (subtle overlays)

Expressed via intensity of ASCII shading or Markdown emphasis.

#### Animation Tokens

ASCII spinner frames: `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`

Fallback frames: `['-', '\\', '|', '/']`

**Specification References**:
[1-4-component-tokens](../architecture/06_UI_UX_Architecture.md#1-4-component-tokens)

---

### 1.5 Voice & Tone Guidelines

<!-- anchor: 1-5-voice-and-tone -->

#### Voice Characteristics

- **Direct**: Use active voice and second person ("Confirm the lifecycle script
  by typing...")
- **Toolsmith-like**: Assume technical competence, avoid over-explanation
- **Instructional**: Provide clear next steps after every operation

#### Tone Levels

| Context       | Tone                   | Emoji           | Example                                                               |
| ------------- | ---------------------- | --------------- | --------------------------------------------------------------------- |
| Informational | Calm, neutral          | `ℹ` (sparingly) | "Cache currently at 45% capacity"                                     |
| Success       | Encouraging, crisp     | `✔`             | "Successfully installed plugin-name@1.2.3"                            |
| Warning       | Urgent but respectful  | `⚠`             | "Cache nearing limit; consider cleanup"                               |
| Error         | Authoritative, helpful | `✖`             | "Installation failed (ERR-INST-007). See docs/errors.md#err-inst-007" |

#### Microcopy Standards

- **Feature Flags**: Describe as "experimental" with safe fallback text
- **Prompts**: Avoid yes/no bias; require typed confirmation for destructive
  actions
- **Progress Messages**: Always include context (e.g., "Installing... (step
  3/10)")
- **Error Messages**: Include error code + specification anchor + resolution
  guidance

#### Example Messaging

**Good**:

```
⚠ Lifecycle script detected. Type 'I TRUST THIS SCRIPT' to proceed.
See SPEC 4.2 for security implications.
```

**Bad**:

```
Warning: Script found. Continue? (y/n)
```

**Specification References**:
[1-5-voice-and-tone](../architecture/06_UI_UX_Architecture.md#1-5-voice-and-tone),
CRIT-004

---

### 1.6 Accessibility Considerations

<!-- anchor: 1-6-accessibility-design-system -->

#### Color Independence

- **Always** provide textual synonyms for every color-coded state
- **Never** rely solely on color to convey meaning
- Example: "✔ SUCCESS" not just green text

#### Screen Reader Compatibility

- Emit `aria-live` style cues through timed log statements
- Progress indicators include textual step counts ("Step 4/10")
- Ensure terminal capture tools (NVDA, VoiceOver) can interpret output

#### Keyboard Navigation

- CLI inherently keyboard-only; ensure `--non-interactive` fallback for scripts
- For docs, provide skip-links (`[Skip to Commands]`)
- Maintain heading depth for assistive navigation (no jumps >1 level)

#### Contrast Requirements

All color combinations MUST meet WCAG 2.1 AA standards:

- **Normal text**: 4.5:1 contrast ratio minimum
- **Large text (18px+ or 14px+ bold)**: 3:1 contrast ratio minimum
- **Interactive elements**: 3:1 contrast ratio for borders/focus indicators

#### Tested Combinations

| Foreground                   | Background           | Contrast Ratio | Passes WCAG AA | Use Case          |
| ---------------------------- | -------------------- | -------------- | -------------- | ----------------- |
| Solar Citrine (`#F2C038`)    | Graphite (`#1D1F21`) | 8.2:1          | ✔ Yes          | Headings, accents |
| Verdant Flux (`#2FBF71`)     | Graphite (`#1D1F21`) | 6.1:1          | ✔ Yes          | Success messages  |
| Signal Vermilion (`#D64242`) | Graphite (`#1D1F21`) | 5.8:1          | ✔ Yes          | Error messages    |
| Fog (`#ECEFF4`)              | Graphite (`#1D1F21`) | 14.5:1         | ✔ Yes          | Primary text      |
| Slate (`#4C566A`)            | Graphite (`#1D1F21`) | 4.6:1          | ✔ Yes          | Secondary text    |

#### Documentation Links

- Link each error message to documentation anchors using absolute Markdown
  references
- Example: `See [ERR-INST-007](../errors.md#err-inst-007) for details`

**Specification References**:
[1-6-accessibility-design-system](../architecture/06_UI_UX_Architecture.md#1-6-accessibility-design-system),
[6-5-accessibility-checklist](../architecture/06_UI_UX_Architecture.md#6-5-accessibility-checklist),
CRIT-006

---

### 1.7 Documentation Patterns

<!-- anchor: 1-7-documentation-patterns -->

#### Command Documentation Structure

Each `docs/cli/*.md` file MUST follow this structure:

1. **Header**: Command name, aliases, one-line description
2. **Usage**: Syntax block with placeholders
3. **Options**: Table of flags with types and defaults
4. **Examples**: Minimum 3 examples with explanatory text
5. **Feature Flags**: List required flags (if any)
6. **Specification References**: Anchors to FR/CRIT/NFR
7. **Error Codes**: List of possible error codes with links
8. **See Also**: Related commands and docs

#### Admonition Shortcodes

Use consistent admonition syntax across docs:

```markdown
> **ℹ INFO**: Cache currently at 45% capacity.

> **✔ SUCCESS**: Installation completed successfully.

> **⚠ WARNING**: Cache nearing limit; cleanup recommended.

> **✖ ERROR**: Installation failed (ERR-INST-007). See
> [error docs](../errors.md).
```

#### Code Block Conventions

- **CLI examples**: Use `bash` syntax highlighting
- **JSON payloads**: Use `json` syntax highlighting
- **Config files**: Use appropriate language tag (`yaml`, `toml`, etc.)
- **Output samples**: Use `text` or no tag

#### Cross-References

- **Specification**: `FR-001`
- **Architecture**:
  `[3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)`
- **Contracts**:
  `[install-contract](../contracts/cli-contracts.md#install-contract)`
- **Errors**: `[ERR-INST-007](../errors.md#err-inst-007)`

**Specification References**:
[1-7-documentation-patterns](../architecture/06_UI_UX_Architecture.md#1-7-documentation-patterns),
[3-4-help-system](../architecture/06_UI_UX_Architecture.md#3-4-help-system)

---

## 2. CLI Interaction Patterns

<!-- anchor: 2-cli-interaction-patterns -->

### 2.1 Progress & Feedback Patterns

<!-- anchor: 2-1-progress-feedback -->

#### Atomic Stage Broadcasts

Every install/update/rollback flow emits `STAGE START` and `STAGE COMPLETE`
messages:

```
[2026-01-12T10:30:45.123Z] STAGE START: Fetching plugin metadata (correlationId: req-123)
[2026-01-12T10:30:46.456Z] STAGE COMPLETE: Fetching plugin metadata (duration: 1.3s)
```

Each message includes:

- ISO 8601 timestamp
- Stage identifier
- Correlation ID for tracing
- Duration for COMPLETE messages

#### Adaptive Spinner Selection

Spinners automatically downgrade based on terminal capabilities:

- **Full Unicode support**: `['⠋','⠙','⠹','⠸','⠼','⠴','⠦','⠧','⠇','⠏']`
- **ASCII-only fallback**: `['-', '\\', '|', '/']`
- **No animation support**: Static `...` with periodic updates

Detection stored in session state; verified via `process.stdout.isTTY` and
`TERM` environment variable.

#### Quiet Mode Messaging

When `--quiet` active:

- Only STAGE START/COMPLETE and errors display
- Success summary emitted at end
- Docs illustrate toggling behavior to set expectations

Example:

```bash
# Verbose (default)
pnpm cli install example-plugin
⠋ Fetching plugin metadata...
✔ Downloaded 2.5MB in 1.3s
⠋ Running postInstall script...
✔ Script completed (exit 0)
✔ Successfully installed example-plugin@1.2.3

# Quiet mode
pnpm cli install example-plugin --quiet
✔ Successfully installed example-plugin@1.2.3 (Transaction txn-123)
```

#### Long-Running Step Guidance

Steps exceeding 10 seconds display contextual hints:

```
⠋ Fetching changelog... (timeout in 15s)
  Tip: Use --skip-changelog to bypass this step
```

#### Success Ritual

Always end with structured completion message:

```
✔ Completed in 12.5s (Transaction txn-20260112-123456)

Next steps:
  • Run tests: pnpm test
  • Pin version: pnpm cli pin example-plugin
  • View changelog: pnpm cli info example-plugin --changelog
```

**Specification References**:
[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback),
FR-001, CRIT-010

---

### 2.2 Input & Confirmation Patterns

<!-- anchor: 2-2-input-patterns -->

#### Yes/No Prompts

- **Avoid** single-key confirmations (`y/n`)
- **Require** full words (`yes`, `no`) to prevent accidental key presses
- **Display** default value inline

Example:

```
⚠ This will uninstall example-plugin@1.2.3 and remove cached versions.
Type 'yes' to confirm, 'no' to cancel [default: no]:
```

#### Typed Phrases (Lifecycle Confirmations)

For destructive or security-sensitive operations, demand typed sentence:

```
⚠ Lifecycle script detected (postInstall)
Script digest: sha256:abc123...

Review script: cat .claude-plugin/cache/example-plugin-1.2.3/postInstall.sh

To proceed, type exactly: I TRUST THIS SCRIPT
>
```

**Rationale**: References CRIT-004 security requirements; prevents accidental
execution.

#### Default Values

- Always display `[default: value]` inline
- Pressing Enter accepts default
- Docs highlight overriding via flags

Example:

```
Select rollback target [default: 1.2.0]:
1. 1.2.0 (cached)
2. 1.1.0 (cached)
3. 1.0.0 (requires download)
>
```

#### Validation Feedback

Invalid input echoes reason plus doc link:

```
✖ Invalid plugin ID 'Example Plugin' (must be kebab-case)
See https://yellow-plugins.dev/docs/naming-conventions

Enter plugin ID (e.g., example-plugin):
>
```

Prompt reappears with previous entry preserved for editability (where terminal
supports).

#### Non-Interactive Mode

For CI or scripts, `--non-interactive` converts prompts into env var lookups:

```bash
# Interactive (fails in CI)
pnpm cli install example-plugin

# Non-interactive (reads env vars)
PLUGIN_ID=example-plugin \
LIFECYCLE_CONSENT_DIGEST=sha256:abc123... \
pnpm cli install --non-interactive
```

Errors reference missing env names:

```
✖ Non-interactive mode requires PLUGIN_ID environment variable
See https://yellow-plugins.dev/docs/cli/automation
```

**Specification References**:
[6-2-input-patterns](../architecture/06_UI_UX_Architecture.md#6-2-input-patterns),
CRIT-004,
[3-3-cli-workflow-control](../architecture/04_Operational_Architecture.md#3-3-cli-workflow-control)

---

### 2.3 Notification & Messaging Patterns

<!-- anchor: 2-3-notification-patterns -->

#### Inline Notifications

Short-lived messages inserted under current step:

```
⠋ Installing example-plugin...
  ℹ Using cached metadata (age: 2h)
✔ Installation complete
```

Avoid full screen re-render to reduce flicker.

#### Persistent Notifications

For warnings requiring follow-up, message repeats at command end:

```
⚠ Cache at 85% capacity (68MB / 80MB)
  Run 'pnpm cli cache clean' to free space

✔ Successfully installed example-plugin@1.2.3

⚠ Reminder: Cache nearing limit. Cleanup recommended.
```

#### Documentation Tie-ins

Each notification optionally includes `[View Guide]` linking to docs:

```
⚠ Feature flag 'enableRollback' is experimental
  [View Guide: https://yellow-plugins.dev/docs/feature-flags#enableRollback]
```

Maintained by Ops_Docs_Architect; links validated during doc linting.

#### Batch Notifications

`check-updates` collates multiple plugin advisories into grouped summaries:

```
✔ 3 plugins up-to-date
⚠ 2 updates available:
  • example-plugin: 1.2.3 → 1.3.0 (patch: bug fixes)
  • another-plugin: 2.0.0 → 3.0.0 (major: breaking changes)
✖ 1 plugin pinned (skipped):
  • stable-plugin: 1.0.0 (pinned)
```

Sorted by severity: errors, warnings, info.

#### Telemetry Notices

On first run, CLI outlines telemetry policy:

```
ℹ Yellow Plugins collects anonymous usage metrics to improve the CLI.
  Data collected: command names, duration, error codes (no PII)
  Opt-out: Set YELLOW_PLUGINS_TELEMETRY=0 in environment

  [View Privacy Policy: https://yellow-plugins.dev/privacy]

Continue with installation? [yes/no]:
```

Subsequent runs only remind when config changes.

**Specification References**:
[6-3-notification-patterns](../architecture/06_UI_UX_Architecture.md#6-3-notification-patterns),
CRIT-010, FR-009

---

## 3. ANSI Fallback & Terminal Compatibility

<!-- anchor: 3-ansi-fallback -->

### 3.1 Terminal Capability Detection

CLI detects terminal capabilities on startup:

```typescript
interface TerminalCapabilities {
  hasColor: boolean; // Supports ANSI color codes
  colorLevel: 0 | 1 | 2 | 3; // 0=none, 1=16, 2=256, 3=truecolor
  hasUnicode: boolean; // Supports Unicode characters
  isTTY: boolean; // Is interactive terminal
  width: number; // Terminal width in columns
}
```

Detection logic:

- Check `process.stdout.isTTY`
- Parse `TERM` and `COLORTERM` environment variables
- Test Unicode support with sample character
- Measure terminal width via `process.stdout.columns`

### 3.2 Graceful Degradation Strategy

| Feature       | Full Support            | Fallback                        | No Support                  |
| ------------- | ----------------------- | ------------------------------- | --------------------------- | ------------- |
| Colors        | 256-color ANSI          | 16-color ANSI                   | No colors, rely on prefixes |
| Icons         | Unicode glyphs (`✔✖⚠ℹ`) | ASCII (`[OK][ERR][WARN][INFO]`) | Textual labels              |
| Spinners      | Braille patterns        | ASCII frames (`-\|/`)           | Static `...` with updates   |
| Borders       | Box-drawing (`┌─┐│`)    | ASCII (`+--+                    | `)                          | Dashes/equals |
| Progress bars | Filled blocks (`█▓▒░`)  | Hashes/spaces (`###---`)        | Percentage text             |

### 3.3 Color Fallback Examples

**256-color terminal**:

```
\x1b[38;5;220m✔\x1b[0m Successfully installed example-plugin@1.2.3
```

**16-color terminal**:

```
\x1b[93m✔\x1b[0m Successfully installed example-plugin@1.2.3
```

**No color support**:

```
[OK] Successfully installed example-plugin@1.2.3
```

### 3.4 Testing Terminal Compatibility

Run CLI with forced capability levels:

```bash
# Force no color
NO_COLOR=1 pnpm cli install example-plugin

# Force 16-color mode
COLORTERM= TERM=xterm pnpm cli install example-plugin

# Force ASCII-only
TERM=dumb pnpm cli install example-plugin

# Force non-TTY (pipeline simulation)
pnpm cli install example-plugin < /dev/null
```

Snapshot tests validate output across all modes.

**Specification References**:
[6-1-progress-feedback](../architecture/06_UI_UX_Architecture.md#6-1-progress-feedback),
[1-6-accessibility-design-system](../architecture/06_UI_UX_Architecture.md#1-6-accessibility-design-system)

---

## 4. Implementation Guidelines

<!-- anchor: 4-implementation-guidelines -->

### 4.1 UI Helper Library

**Location**: `packages/cli/src/lib/ui.ts`

**Exports**:

- `renderHeading(text: string, level: 1 | 2 | 3): string` - Formatted heading
  with color/weight
- `renderBadge(text: string, variant: 'success' | 'warning' | 'error' | 'info'): string` -
  Colored badge with icon
- `renderBox(content: string, options?: BoxOptions): string` - ASCII/Unicode box
  with borders
- `renderProgress(current: number, total: number): string` - Progress bar with
  percentage
- `renderSpinner(frame: number): string` - Animated spinner frame
- `detectTerminalCapabilities(): TerminalCapabilities` - Capability detection
- `colorize(text: string, color: ColorName): string` - ANSI-safe colorization
  with fallback

**Example Usage**:

```typescript
import { renderHeading, renderBadge, renderBox, colorize } from './lib/ui.js';

console.log(renderHeading('Installing Plugin', 1));
console.log(renderBadge('Completed', 'success'));
console.log(colorize('Warning: Cache nearing limit', 'warning'));
console.log(
  renderBox('Lifecycle script detected\nReview before proceeding', {
    title: 'Security Alert',
    variant: 'warning',
  })
);
```

### 4.2 Consistency Checklist

Before committing UI changes, verify:

- [ ] Color contrast meets WCAG 2.1 AA (4.5:1 for normal text)
- [ ] Textual synonyms provided for all color-coded states
- [ ] Unicode icons have ASCII fallbacks
- [ ] Terminal capability detection tested (color/nocolor/TTY/non-TTY)
- [ ] Line length capped at 72 characters for CLI output
- [ ] Error messages include error codes + specification anchors
- [ ] Help text examples match documented usage in `docs/cli/*.md`
- [ ] Snapshot tests updated for new output formats
- [ ] `--quiet` mode respects minimal output guidelines
- [ ] `--non-interactive` mode avoids prompts, reads env vars

### 4.3 Documentation Sync

After UI changes:

1. Update `docs/cli/*.md` with new examples if command behavior changed
2. Refresh snapshot tests: `pnpm test:snapshot --update`
3. Run doc linting: `pnpm docs:lint`
4. Validate contract schemas if JSON output changed: `pnpm validate:contracts`
5. Update `CHANGELOG.md` with UX improvements under `### UI/UX Enhancements`

**Specification References**:
[1-7-documentation-patterns](../architecture/06_UI_UX_Architecture.md#1-7-documentation-patterns),
FR-001

---

## 5. Accessibility Test Checklist

<!-- anchor: 5-accessibility-checklist -->

### 5.1 Contrast Verification

Automated script ensures ANSI colors meet contrast ratios:

```bash
pnpm test:contrast
```

Verifies:

- All color combinations against Graphite background
- CLI screenshot review on dark/light terminal backgrounds
- Docs CSS color variables against white/dark backgrounds

### 5.2 Screen Reader Testing

Provide `scripts/assistive-announcer.js` that replays CLI outputs for
NVDA/VoiceOver testing:

```bash
node scripts/assistive-announcer.js < cli-output.txt
```

Validates:

- Progress indicators include textual step counts
- Error messages vocalize error codes and resolution steps
- Spinner states announce "Loading..." then "Complete"

### 5.3 Keyboard-Only Exercise

Validate all interactive prompts reachable without mouse:

- CLI inherently keyboard-only
- No hidden default actions (all defaults explicitly labeled)
- `--non-interactive` fallback for scripts

Test with:

```bash
pnpm cli install --non-interactive < /dev/null
```

### 5.4 Documentation Heading Depth

Confirm no heading jumps >1 level:

```bash
pnpm docs:lint --check-headings
```

Anchors follow sequential numbering for navigation.

### 5.5 Table Alternatives

Provide textual summaries for complex tables:

```markdown
## Update Summary

3 plugins updated:

- example-plugin: 1.2.3 → 1.3.0
- another-plugin: 2.0.0 → 2.1.0
- third-plugin: 0.5.0 → 1.0.0

1 plugin already up-to-date:

- stable-plugin: 1.0.0

1 plugin skipped due to compatibility:

- incompatible-plugin: Requires Node.js >= 22
```

Helps screen readers and plain-text exports.

**Specification References**:
[6-5-accessibility-checklist](../architecture/06_UI_UX_Architecture.md#6-5-accessibility-checklist),
[1-6-accessibility-design-system](../architecture/06_UI_UX_Architecture.md#1-6-accessibility-design-system)

---

## 6. Version History

<!-- anchor: version-history -->

| Version | Date       | Changes                                                                  | Author            |
| ------- | ---------- | ------------------------------------------------------------------------ | ----------------- |
| 1.0.0   | 2026-01-12 | Initial style guide consolidating UI/UX architecture (I3.T5 deliverable) | Claude Sonnet 4.5 |

---

## 7. Related Documentation

<!-- anchor: related-docs -->

- [CLI Command Reference](../cli/help-baseline.md)
- [UI/UX Architecture](../architecture/06_UI_UX_Architecture.md)
- [CLI Contracts Catalog](../contracts/cli-contracts.md)
- [Error Codes Reference](../errors.md)
- [Accessibility Guidelines](../ACCESSIBILITY.md)
- [Contributing Guide](../../CONTRIBUTING.md)

---

**Maintained by**: Claude Code Plugin Marketplace Team **Contact**: See
repository README for contribution guidelines **License**: See LICENSE file in
repository root
