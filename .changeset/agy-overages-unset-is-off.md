---
'yellow-agy': patch
---

`/agy:setup` no longer asks the owner to add `"useG1Credits": false` by hand.
agy saves that key with omitempty, so it drops `false` whenever it rewrites
`settings.json` (seen when agy self-updated to 1.5.1), and an absent key now
counts as off. Setup refuses with `AGY_OVERAGES` only when `useG1Credits` is
`true`, or when `userSettings.useAiCredits` in `~/.gemini/config/config.json`,
which agy copies into `useG1Credits` at startup, is `true`.
