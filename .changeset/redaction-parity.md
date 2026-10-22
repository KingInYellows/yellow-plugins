---
"yellow-ci": minor
"yellow-core": patch
---

Bring yellow-ci's CI-log redactor and yellow-core's `cs_redact_secrets` to the
same set of credential shapes. yellow-ci now also masks `ASIA`/`ABIA`/`ACCA`
AWS keys, Anthropic, OpenAI, Slack, Stripe, Hugging Face, Tavily (`tvly-`),
Perplexity (`pplx-`) and Semgrep (`sgp_`) keys, credentials in URL userinfo,
and bare `Basic <base64>` payloads, in `lib/redact.sh` and in the four skill
references that inline its pipeline. yellow-core now also masks `gho_`,
`ghr_`, `ghu_` and `pypi-` tokens. A new parity test fails when either
redactor gains a labelled pattern the other lacks, or when an inline copy
drifts from `redact.sh`.
