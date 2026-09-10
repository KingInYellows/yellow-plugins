---
'yellow-codex': patch
---

Install Codex CLI as the standalone binary OpenAI now ships instead of the npm
package. `scripts/install-codex.sh` keeps the Homebrew cask path on macOS and
otherwise downloads and runs the official installer
(`https://chatgpt.com/codex/install.sh`) non-interactively, which verifies the
release archive's SHA-256 digest, links `~/.local/bin/codex` and adds that
directory to the shell profile; native Windows is pointed at the PowerShell
installer. The Node.js 22+ prerequisite, the npm `--prefix` fallbacks and the
nvm/fnm handling are gone. `/codex:setup`, the README and CLAUDE.md describe the
new install paths, and the CI Codex install verification job uses the same
installers on both its ubuntu and Windows legs (the npm package's missing
`@openai/codex-win32-x64` optional dependency had been failing the Windows leg).
