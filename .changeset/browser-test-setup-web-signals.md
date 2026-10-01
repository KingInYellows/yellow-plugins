---
'yellow-browser-test': patch
---

fix(yellow-browser-test): `/browser-test:setup` now detects web apps beyond
`package.json`, using the same signals as `/setup:all` (Rails, Python
Django/Flask/FastAPI/Starlette/Sanic, Go, Rust, PaaS config, docker-compose
HTTP ports). Django, FastAPI, Rails, Go and Rust projects no longer see the
"no web framework detected" prompt, which also stops claiming those apps are
undetectable. The `app-discoverer` agent now inspects all four Compose
filenames (`compose.yaml`, `compose.yml`, `docker-compose.yaml`,
`docker-compose.yml`) to match.
