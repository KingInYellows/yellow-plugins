---
"yellow-core": patch
---

Redact tvly-, pplx- and sgp_ tokens and `Authorization: Basic` header tokens in compound-staging output. A Basic token of two or three characters plus padding (an empty username or password) is redacted too.
