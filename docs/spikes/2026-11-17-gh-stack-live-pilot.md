# gh-stack live pilot (2026-11-17)

Throwaway three-layer stack opened with `gh stack` v0.3.0 through
`plugins/github-workflow/lib/github-stack-runtime.js` to verify the native
stacked pull request lifecycle against GitHub (CLAUDE-344).

## Layer 1

Created with `init`, submitted as the bottom pull request.
Amended after submit.

## Layer 2

Created with `add` on top of layer 1.

## Layer 3

Created with `add` on top of layer 2. Not meant to merge.
