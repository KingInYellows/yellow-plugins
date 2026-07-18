---
'yellow-core': minor
---

/plan:complete Gate C: add a loose token-coverage fallback tier. When the strict full-slug branch match finds nothing (branch names rarely carry the full plan slug), the 100 most recent merged PRs are scored by slug-token coverage over branch + title; a unique PR containing all slug tokens except at most one (all of them for slugs of ≤3 tokens) passes without prompting and is recorded via a Plan-Verifier-LooseMatch commit trailer. Ambiguous or zero loose matches still prompt for a PR-number override. Also fixes a zsh-noclobber stderr-redirect failure in the Gate C strict query that collapsed every run to no-evidence and forced spurious override prompts.
