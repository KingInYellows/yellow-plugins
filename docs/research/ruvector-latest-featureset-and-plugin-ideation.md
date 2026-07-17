# RuVector — Latest Version, Full Feature Set, and Plugin-System Ideation

**Date:** 2026-07-17
**Type:** Research + ideation (no implementation)
**Target:** github.com/ruvnet/ruvector → applicability to the `yellow-plugins` Claude Code marketplace
**Method:** deep-research workflow (98 agents, 16 primary sources, 3-vote adversarial verification) + direct npm/deepwiki/live-MCP-surface probing, advisor-reviewed.

> **Verification note.** The workflow's auto-synthesis returned a broken stub, so findings below were recovered from the per-agent journal (`refuted:false` = confirmed against a primary source; `refuted:true` = killed). Version facts are corroborated by a live `npm view` and by the ~97-tool MCP surface exposed in this very environment. Vendor performance numbers are labeled **[vendor-stated]** where not independently benchmarked.

---

## 1. TL;DR

- **The version the plugin actually runs is `ruvector` npm `0.2.34`** (published 2026-07-05). That's what `npx ruvector` / `yellow-ruvector` installs today. *Confirmed via npm registry + GitHub release `ruvector-v0.2.34`.*
- **RuVector is a monorepo with independently-versioned artifacts.** "Latest version" is ambiguous unless you name the artifact:
  - npm `ruvector` (the CLI + MCP server) → **0.2.34**
  - Rust crate `ruvector-core` (newest GitHub release overall) → **2.3.0** (~2026-07-12, *"Lattice embeddings, CVE cleanup"*)
  - `@ruvector/rvf` → 0.2.3 · `@ruvector/rvlite` → 0.2.4 (2025-12-12)
  - Earlier crate line `2.0.4`/`2.0.5` (Feb 2026) is **superseded** — any "2.0.5 is latest" claim is stale.
- **The single most actionable finding for us:** RuVector's installed MCP server exposes **~97 tools across 8 families**, but the current `yellow-ruvector` plugin surfaces **only `hooks_remember` / `hooks_recall` + semantic search + 5 CLI lifecycle hooks.** The intelligence layer — agent routing, error→fix memory, co-edit prediction, coverage routing, trajectory RL, shared "brain" memory, background workers — is **installed and reachable but unused.**
- The highest-value ideas are **not "expose 97 tools"** — they are **connecting ruvector's *learned/automated* versions of things this repo already hand-builds** (`docs/solutions/`, review-persona selection, file-grouping, shared `MEMORY.md`).

---

## 2. Versioning reality (why "latest" is a trick question)

RuVector ships as ~14 Rust crates + 4 `@ruvector/*` npm packages + a CLI + an MCP server + a Postgres extension + a browser/WASM build, each on its own version line (78% Rust / ~11% TS). The adversarial verifier **refuted** the flat claim "0.2.34 is the latest RuVector release" — not because 0.2.34 is wrong, but because `ruvector-core-v2.3.0` is a *newer GitHub release* on a *different* version line. Both facts are true simultaneously.

| Artifact | Version | Date | Relevance to us |
|---|---|---|---|
| `ruvector` (npm CLI + MCP) | **0.2.34** | 2026-07-05 | **This is what the plugin runs.** |
| `ruvector-core` (Rust crate) | 2.3.0 | ~2026-07-12 | Newest overall; not directly consumed by the npm CLI |
| `@ruvector/rvf` | 0.2.3 | 2026-07-05 | RVF format SDK |
| `@ruvector/rvlite` | 0.2.4 | 2025-12-12 | Browser/WASM vector DB |
| `ruvector-core` 2.0.4 / 2.0.5 | — | Feb 2026 | **Superseded** (stale "latest" claims) |

**Takeaway for the plan:** pin and reason about **npm `ruvector` 0.2.34**. The flashy 2.x crate features (below) are *not necessarily in the npm CLI's MCP surface* and must not be assumed reachable.

---

## 3. Full feature set (organized by subsystem)

### 3.1 Storage — the RVF format
- **RVF (RuVector Format):** a single-file binary "substrate" merging **database + ML model + graph engine + OS kernel + cryptographic attestation** — not just a vector file. *Confirmed against `crates/rvf/README.md`.*
- **~20–24 self-describing, 64-byte-aligned segment types:** data (`VEC_SEG`, `INDEX_SEG`, `QUANT_SEG`), compute (`WASM_SEG`, `EBPF_SEG`, `KERNEL_SEG`), security (`WITNESS_SEG`, `CRYPTO_SEG`), branching (`COW_MAP_SEG`, `MEMBERSHIP_SEG`).
- **Git-like copy-on-write branching** at cluster granularity; **hash-linked witness logs** for tamper-evident lineage.
- **Progressive 3-layer HNSW query engine** trading recall for latency **[vendor-stated]**: Layer A ~70%+ recall <5ms, B ~85%+ ~10ms, C 95%+ ~50ms; results sharpen as background indexing completes.
- ⚠️ **Refuted / marketing:** "an RVF file self-boots as a microservice via embedded Linux microkernel in <125ms" was **killed by verification** — treat as aspirational.

### 3.2 Semantic search & retrieval
- Baseline: **HNSW + SIMD**, all-MiniLM-L6-v2 (384-dim, ONNX-WASM) — this is what the plugin uses now.
- **v2.1 "SOTA Vector Search" cluster** *(mostly Rust-crate / 2.x — verify reachability before assuming in the 0.2.34 MCP surface)*: hybrid sparse+dense with **RRF fusion**, **Graph RAG**, **DiskANN/Vamana** (billion-scale SSD ANN), **ColBERT** multi-vector, **Matryoshka** adaptive-dim, **OPQ**, **GraphMAE** self-supervised graph learning.

### 3.3 Agent memory & learning
- **Four-tier `AgenticMemory`:** working / episodic / semantic / procedural. *Confirmed.*
- **SONA MicroLoRA** adapter weights triggered by **trajectory + reward** signals; **EWC++** consolidation guards against catastrophic forgetting.
- **Q-learning self-learning loop**, tunable via `RUVECTOR_LEARNING_RATE` (0–1, default 0.1); default memory backend is `rvlite` (`RUVECTOR_MEMORY_BACKEND`).
- ⚠️ RuVector's own README states there's **no native save/load yet** for the unified `AgenticMemory` manager — the four-tier model is partly aspirational at the API layer.

### 3.4 MCP server & Claude Code hooks (the integration surface)
- Launch: `claude mcp add ruvector -- npx ruvector mcp start` → **97 tools [vendor-stated, matches our live count of ~97]**.
- **Policy-gated tool access (ADR-256, added 0.2.32):** `RUVECTOR_MCP_PROFILE` (e.g. `readonly`) + explicit `RUVECTOR_MCP_ALLOW` / `RUVECTOR_MCP_DENY` (**deny wins**); inspect via `npx ruvector harness status --json`. This is a genuine least-privilege lever for a plugin.
- **Claude Code hooks — 5 core capabilities** *(confirmed against `HOOKS.md`)*: **agent routing, co-edit pattern detection, vector memory, command analysis, self-learning.** Backed by a **9-phase pretrain pipeline** (AST / diff / coverage / neural / graph) and an **agent-config generator**. Q-learning routing **[vendor-stated] 80%+ accuracy**.
- ⚠️ The claim "hooks integrate with *all* Claude Code event types (PreToolUse, PostToolUse, SessionStart, Stop, UserPromptSubmit, PreCompact, Notification)" was **refuted (0-3)** as an over-broad enumeration — the plugin wires 5 today.

### 3.5 "Brain" — shared / collective intelligence
- `mcp-brain`: shared memory with **remote contributions, semantic search, provenance, and quality voting**; **hypergraph** storage + **Cypher**; **DiskANN** backend; **prompt-injection / PII detection bundled** into the search layer (AIDefence-style).
- Optional **federated sync to `pi.ruv.io`** (**[vendor-stated]** 12k+ community memories), **differential-privacy noise** on shared embeddings, **localhost-only binding by default** (federation is opt-in).

### 3.6 Knowledge graph
- `ruvector-graph`: explicit relationships, **multi-hop memory**, hyperedges, Cypher. **GNN-based reranking** (`ruvector-gnn-rerank`) over Cue/Tag/Content associations.

### 3.7 Workers, Edge, Decompile, rvlite (breadth)
- **Workers (`workers_*`, 12 tools):** background dispatch for speculative pre-embedding, multi-file AST, distributed trajectory replay, parallel SAST, git-churn/blame — offload heavy analysis off the critical path.
- **Edge/swarm:** `ruvllm-esp32` firmware, `ruvector-hailo` NPU backend — IoT/edge; **not relevant to a Claude Code plugin.**
- **Decompile (`decompile_*`, 6 tools):** ruDevolution JS decompiler — niche.
- **rvlite:** fully client-side browser vector DB (~850KB WASM), SQL/SPARQL/Cypher, in-browser GNN, IndexedDB persistence — interesting but off-target for us.

### 3.8 Recent changelog (what's new)
- **0.2.34 (5 Jul):** fixed MCP **`rvf_create`** (advertised one field name, forwarded another → tool calls failed); added a **macOS Metal "lattice" LLM backend** for Apple Silicon (safetensors); suppressed misleading install hints; accepts `dimension`/`dimensions`; loosened vector-store creation errors.
- **0.2.32 (17 Jun):** **"Harness Router"** unifying routing/agent/MCP/memory; **default-deny MCP policy** (ADR-256); stable memory-namespace env var.
- **`ruvector-core` 2.3.0 (~12 Jul):** local **Lattice embeddings** (pure-Rust CPU-native, worker-thread) + WASM equivalent; **CVE cleanup** (bumped `crossbeam-epoch` 0.9.20; quick-xml DoS documented as upstream-blocked); privacy fix so CLI embedding no longer leaks text via process inspection (adds stdin/`--input-file`).
- Earlier **2.0.4:** External Intelligence Providers for SONA, "Security-Hardened RVF v3.0", path-traversal (CWE-22) fix in MCP backup, plus scope-creep features (`rvDNA` biomarker analysis) that signal a **very broad, fast-moving, pre-1.0 surface**.

---

## 4. The reachable surface today (~97 MCP tools, 8 families)

This is the **integration budget** — what a plugin can actually call against 0.2.34. (Counts from the live MCP surface in this environment.)

| Family | Count | What's in it | Used by plugin now? |
|---|---:|---|---|
| `hooks_*` | ~49 | route, route_enhanced, error_record/suggest, coedit_record/suggest, coverage_route/suggest, trajectory_begin/step/end, swarm_recommend, learn, rag_context, ast_analyze, diff_classify, git_churn, security_scan, remember, recall, stats… | **Only `remember`/`recall`** |
| `workers_*` | 12 | background dispatch, run, results, phases, presets, triggers | No |
| `brain_*` | 11 | search, share, vote, drift, sync, transfer, partition, status | No |
| `rvf_*` | 10 | create, open, ingest, query, derive, segments, compact | No |
| `decompile_*` | 6 | file, diff, package, search, url, witness | No |
| `edge_*` | 4 | join, status, tasks, balance | No |
| `rvlite_*` | 3 | sql, cypher, sparql | No |
| `identity_*` | 2 | generate, show (Pi keys) | No |

**~95% of the installed, paid-for-in-startup-cost tool surface is dark.**

---

## 5. Gap analysis — `yellow-ruvector` today vs. available

**Today the plugin is a thin memory+search wrapper:**
- 6 commands (`setup`/`index`/`search`/`status`/`learn`/`memory`), 2 agents (semantic-search, memory-manager), 3 skills, 5 lifecycle hooks.
- Hooks call the **CLI** (`hooks session-start/post-edit/post-command/recall`) under **tight budgets** (1s pre/post, 3s session-start) — and per CHANGELOG 1.1.8 must use the **global `ruvector` binary**, because `npx` cold-start (~2700ms) blows the watchdog.
- Design rules that constrain any plan: **graceful degradation** (must work with ruvector absent), **local-only** (`.ruvector/`, gitignored, per-developer), and a settled **memory-router decision** (PR #607/#609): *yellow-ruvector is the standard memory system; mempalace is deprecated.* → **Build on yellow-ruvector, don't fork it.**

**The untapped capabilities that map cleanly onto problems this repo already solves by hand** are the subject of §6.

---

## 6. Ideation plan — "useful pieces" mapped to existing repo systems

Framing (per advisor): the win isn't surfacing tools — it's **wiring ruvector's *learned* version of things `yellow-plugins` already hand-builds.** Each idea below names the ruvector capability, the existing repo system it augments, and a build sketch. **Everything anchors to a tool in the reachable §4 surface.** Ordered by value-to-effort.

### Tier 1 — high value, low risk, reachable now

**I1. Error→fix memory backed by `docs/solutions/` + `MEMORY.md`.**
`hooks_error_record` / `hooks_error_suggest` are literally an error-pattern KB with retrieval — which is exactly what `docs/solutions/<category>/` and `MEMORY.md` are, but built manually. **Sketch:** a `PostToolUse`/`Stop` hook records `(error, fix, file)` when a bash/edit failure is later resolved; the `debugging` skill and `/review:resolve` query `hooks_error_suggest` before re-deriving a fix. Seed the store from the existing solution corpus. **Guardrail (from the RSCB-MC paper, adjacent research): gate suggestions on confidence/false-positive risk, not raw similarity — make "don't suggest" a first-class safe action.** Complements, doesn't replace, the human-curated solution docs.

**I2. Learned review-persona / agent routing.**
`hooks_route` / `hooks_route_enhanced` / `hooks_swarm_recommend` do **Q-learning task→agent routing with AST/diff/coverage signals** — the review pipeline currently selects conditional personas (adversarial-reviewer, security-reviewer, performance-reviewer…) by **static diff heuristics.** **Sketch:** feed the diff to `hooks_route_enhanced` as an *advisory* signal alongside the existing rules; record which personas actually produced surviving findings via `hooks_learn`, so selection improves over PRs. **Advisory only** — never let a learned router *suppress* an always-on persona. Vendor's 80%+ routing accuracy is **[vendor-stated]**; treat as a hint source, verify empirically.

**I3. Co-edit / file-sequence prediction for review grouping & `/workflows:work`.**
`hooks_coedit_record` / `hooks_coedit_suggest` learn "files edited together" via git-history Markov chains — directly useful for the repo's **file-based review grouping** ("one agent per file") and for pre-warming context in `/workflows:work`. **Sketch:** after edits, `coedit_record`; when planning a change, `coedit_suggest(file)` to surface likely-related files (e.g., "touched `plugin.json` → also usually touch `marketplace.json` + `setup/all.md`", a rule the repo enforces manually today).

### Tier 2 — high value, needs a decision on shared state

**I4. Shared/team "brain" for `MEMORY.md` learnings.**
`brain_*` (share/search/vote/drift/provenance) is a collective-memory layer with quality voting — the repo currently shares learnings by **manually committing `MEMORY.md` + `docs/solutions/`.** **Sketch:** optionally push high-value learnings to a **self-hosted, localhost-bound brain** (NOT `pi.ruv.io`) so multiple worktrees/developers share a queryable, vote-ranked store, with `brain_drift` flagging stale entries. **Decision required:** the repo's current model is deliberately per-developer + git-reviewed; a shared brain changes the trust/review model. Keep federation **off**; keep the git-committed corpus as source of truth, brain as an index. Weigh against the settled memory-router decision.

**I5. Background workers for review pre-computation.**
`workers_*` can pre-embed changed files, run parallel AST/security/churn analysis, and warm caches **off the critical path** — the review pipeline does much of this inline. **Sketch:** on `SessionStart`/PR-open, `workers_dispatch` a security-scan + complexity pass; agents read `workers_results` instead of recomputing. Fits the repo's existing async patterns (compound-staging background drain). Bounded by worker-runtime cost; measure before adopting.

### Tier 3 — interesting, likely defer

**I6. Trajectory RL over the review-resolve / compound loops.** `hooks_trajectory_*` + `hooks_learn` could learn which resolve strategies converge fastest (the repo empirically budgets "~4 resolve rounds"). High conceptual fit, but reward-signal design is hard and payoff is uncertain — spike-only.
**I7. Coverage-aware routing** (`hooks_coverage_*`): valuable for code repos with coverage data; **this repo is validators + markdown**, so low fit here (but a strong story for the plugin's *end users*).
**I8. RVF / rvlite / decompile / edge:** off-target for the plugin system's needs. Note RVF's **witness-chain lineage** as a *conceptual* reference for tamper-evident audit trails, nothing more.

### Cross-cutting: adopt ruvector's **default-deny MCP policy** regardless
Independent of any feature: `yellow-ruvector` should set `RUVECTOR_MCP_PROFILE`/`RUVECTOR_MCP_DENY` so only the tools the plugin actually uses are exposed — a least-privilege win that shrinks the agent's tool surface and matches the repo's security-fencing posture. Reachable today (0.2.32+).

---

## 7. Caveats, refuted claims, and labeling

- **Refuted (killed by 2–3 votes):** "0.2.34 is the latest release *overall*" (→ it's the latest *npm CLI*); "2.0.5 is the most recent release" (stale); "RVF self-boots in <125ms" (marketing); "hooks integrate with *all* Claude Code event types" (over-broad).
- **[vendor-stated], not independently benchmarked:** Q-learning routing "80%+ accuracy", "150x faster" recall, 3-layer HNSW recall/latency figures, "12k+ community memories".
- **Adjacent, not RuVector itself** (clearly labeled as inspiration): **Ruflo** (formerly "Claude Flow") — a separate orchestration harness by the same author that *composes* ruvector as one memory component; the **RSCB-MC arxiv paper** on risk-sensitive memory control (informs I1's confidence-gating); **obsidian-brain** (a RuVector-backed MCP plugin, useful as an integration-pattern reference).
- **Maturity signal:** pre-1.0 npm line, ~weekly releases, and scope sprawl (bio-data `rvDNA`, ESP32 firmware) mean the surface **churns**. Pin exact versions; re-verify tool contracts each bump (0.2.34 itself was a bug-fix to a broken MCP tool).

---

## 8. Sources (primary unless noted)

- npm registry: `ruvector` 0.2.34 dist-tags/time (live `npm view`) · `@ruvector/rvlite` 0.2.4
- GitHub `ruvnet/ruvector`: releases (`ruvector-v0.2.34`, `ruvector-v0.2.32`, `ruvector-core-v2.3.0`), `README.md`, `crates/rvf/README.md`, `npm/packages/ruvector/HOOKS.md`, `CHANGELOG.md`, issue #168 (RVF spec)
- DeepWiki `ruvnet/ruvector` (AI-indexed; **its version claim 0.2.5 was stale — do not trust deepwiki for versions**)
- Live MCP tool surface in this environment (`mcp__plugin_yellow-ruvector_ruvector__*`, ~97 tools) — authoritative for 0.2.34's reachable surface
- Adjacent: arxiv RSCB-MC memory-control paper; starlog.is Ruflo write-up (blog); `ruvnet/obsidian-brain`
- Repo-internal: `plugins/yellow-ruvector/{README,CLAUDE,CHANGELOG}.md`, `plugin.json`, `hooks/hooks.json`; `docs/memory-routing-protocol.md`
