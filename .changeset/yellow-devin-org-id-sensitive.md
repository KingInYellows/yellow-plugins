---
'yellow-devin': patch
---

fix(yellow-devin): mark `devin_org_id` userConfig as sensitive (#271)

Flips `userConfig.devin_org_id.sensitive` from `false` to `true` in
`plugins/yellow-devin/.claude-plugin/plugin.json`. The org ID pairs
with the service-user token in every Devin V3 API call, narrows the
auth target if leaked, and previously lived in
`~/.claude/settings.json` in plaintext. Marking it sensitive routes
storage to the system keychain and enables transcript redaction.

**Migration note:** existing users may be re-prompted once for the
org ID after upgrading. The shell-env fallback (`DEVIN_ORG_ID`)
remains intact for power users and CI; no command behavior changes.
The interactive validation output in `/devin:setup` is unaffected
(the `sensitive` flag controls storage and transcript redaction, not
the validation echo shown to the active user as they type).

Source: PR #259 multi-agent review (code-reviewer P3, security-sentinel L1).
