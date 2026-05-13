---
'yellow-core': minor
'yellow-browser-test': patch
---

feat(yellow-core): credential-status-aware /setup:all classification

Closes the dashboard's three biggest false-positive paths reported by users
running plugins on multiple hosts:

1. **yellow-research PARTIAL despite working MCPs.** The dashboard previously
   only probed shell env vars (`EXA_API_KEY` etc) and missed keys stored in
   the system keychain via userConfig. Now reads `credential-status.json`
   (emitted by the SessionStart hook from the yellow-research PR earlier in
   this stack) as the authoritative source.

2. **yellow-composio NEEDS SETUP cascade.** Updated classification reflects
   the v1.3.0 stdio architecture: the bundled MCP only registers when the
   wrapper's credential resolution succeeds, so an empty URL no longer
   breaks `claude doctor` for other MCPs. Dashboard now distinguishes
   "credentials absent" from "credentials present but MCP not yet visible"
   (Claude Code restart needed).

3. **yellow-browser-test NEEDS SETUP on every non-web-app repo.** Adds a
   project-type heuristic: if NO web-app signals are present (no React/
   Vue/Next/Django/Rails/Axum framework deps, no Vercel/Fly/Render config,
   no docker-compose HTTP port mapping) AND no
   `.claude/yellow-browser-test.local.md`, omit the plugin from the
   dashboard entirely. When web-app signals ARE present but the config file
   is missing, emit a RECOMMENDED hint instead of a NEEDS SETUP error.

Also extends `app-discoverer` agent (yellow-browser-test) with non-Node
language detection (Gemfile/Rails, requirements.txt/Django/Flask/FastAPI,
go.mod/Gin/Echo, Cargo.toml/Axum/Actix) and PaaS config detection
(fly.toml, render.yaml, vercel.json, netlify.toml).

New Step 1.6 reads each credential-bearing plugin's status file. Falls back
to legacy shell-env-only probes when status files are absent (e.g., on
first install before any SessionStart has fired).
