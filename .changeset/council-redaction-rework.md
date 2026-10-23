---
'yellow-council': patch
---

Rework the credential-redaction program: `cred_hit` and `strip_deco` now run in
linear time (a line of many short `sk-` placeholders and nested list, diff or
numbered prefixes were quadratic), and the PEM body tests unwrap JSON string
arrays, markdown table columns and `\n`-escaped strings so a serializer-wrapped
key no longer leaks its tail. Step 5e lists every staged citation under
Unverified Claims (`verifier-error`) when `verification.tsv` vanished after Step
5b.
