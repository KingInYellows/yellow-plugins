# yellow-composio Expansion Research (W3.8 / OQ-7)

<!-- prettier-ignore -->
**Date:** 2026-04-30
**Status:** Research-level deliverable; explicit go/no-go recommendation. Implementation deferred.
**Related upstream SHA:** `e5b397c9d1883354f03e338dd00f98be3da39f9f` (`compound-engineering-v3.3.2`)

## Question

Should yellow-composio expand beyond its current setup/status surface to integrate with upstream EveryInc orchestration patterns — specifically the `ce-optimize` parallel-experiments pattern and any related batch-execution / remote-workbench machinery in the upstream PR history?

## TL;DR Recommendation

**NO-GO for direct ce-optimize integration in yellow-composio.**

**YES-GO for a *separate* `composio-optimize` adapter** that activates only when ce-optimize is shipped (W3.14, currently deferred from this session) AND a user opts in via `execution.environment: composio-workbench` in their optimize-spec YAML. The adapter is a thin pass-through, not an alternative implementation. Default off.

**Practical effect:** yellow-composio's surface stays minimal. The optimize integration question is best owned by W3.14 (yellow-core's `optimize` skill), not by yellow-composio.

## Current yellow-composio surface

- **2 commands:** `/composio:setup`, `/composio:status`
- **1 skill:** `composio-patterns` (~ reference material for consuming plugins)
- **0 bundled MCP** — explicitly relies on the user's external Composio MCP connector (varies: `mcp__claude_ai_composio__*`, `mcp__composio-server__*`, etc.)
- **6 core / 11 total documented Composio tools** (provided by the user's connector, discoverable via ToolSearch). The 6 core tools are the integration anchors used throughout this analysis; the canonical reference is `plugins/yellow-composio/skills/composio-patterns/SKILL.md`, which also documents 5 additional meta tools (`COMPOSIO_CREATE_PLAN`, `COMPOSIO_WAIT_FOR_CONNECTIONS`, `COMPOSIO_LIST_TOOLKITS`, `COMPOSIO_EXECUTE_AGENT`, `COMPOSIO_GET_TOOL_DEPENDENCY_GRAPH`) — out of scope for this expansion analysis but listed here so the count is not misleading.
  - `COMPOSIO_SEARCH_TOOLS` — discovery
  - `COMPOSIO_GET_TOOL_SCHEMAS` — parameter schemas
  - `COMPOSIO_MULTI_EXECUTE_TOOL` — up to 50 parallel tool runs
  - `COMPOSIO_MANAGE_CONNECTIONS` — OAuth / API key auth flow
  - `COMPOSIO_REMOTE_WORKBENCH` — persistent Python sandbox (4-min timeout)
  - `COMPOSIO_REMOTE_BASH_TOOL` — bash in sandbox

Plugin convention is graceful degradation: if the Composio MCP isn't installed, every workflow falls through to a local path silently.

## Upstream pattern survey

### `ce-optimize` parallel-experiments

`ce-optimize` (upstream skill at the locked SHA, 659 lines after PR #588 + #671 + #580) is a metric-driven iterative optimization loop. It defines a measurable goal, builds measurement scaffolding, then runs parallel experiments that try many approaches, measure each against hard gates and/or LLM-as-judge quality scores, keeps improvements, and converges.

Relevant attributes from a Composio-fit perspective:

- **Persistence-first.** Experiment log on disk is the single source of truth (`.context/compound-engineering/ce-optimize/<spec>/`). Conversation context is not durable. Sessions run for hours.
- **`execution.mode: serial` and `execution.max_concurrent: 1` defaults.** First-run advice is "optimize for signal and safety, not maximum throughput."
- **Hard-gate vs LLM-as-judge measurement.** Hard gates (deterministic tests) are preferred when the metric is objective and cheap. Judge mode opens for prompt-quality / semantic outputs and starts at `sample_size: 10`, `batch_size: 5`, `max_total_cost_usd: 5`.
- **Multi-file code changes.** Generalized for non-ML domains — applies to refactors, retrieval-quality tuning, prompt iteration, build-perf optimization.

### Other upstream batch / remote-workbench patterns

A focused review of the locked SHA's plugin tree did not surface additional batch-execution machinery beyond what `ce-optimize` already contains. `ce-compound-refresh` (W3.10's source) has a similar persistence-first discipline but is single-pass, not iterative. `ce-debug` (W3.1's source) sometimes dispatches read-only sub-agents in parallel for hypothesis testing, but the parallelism is platform-level (Claude Code Task tool), not Composio-backed.

**Conclusion:** the only meaningful Composio-fit candidate in upstream is `ce-optimize`'s parallel-experiments. Nothing else in upstream PR history needs cross-vendor batch infrastructure.

## Cost / fit analysis

### Where Composio shines for ce-optimize

1. **Workbench persistence.** A Composio sandbox holds Python state across calls (4-min timeout per call, but state survives). For an optimize loop that builds a measurement harness once and then runs many evaluation calls against it, this is genuinely useful — fewer cold starts, no local-environment churn.

2. **Multi-execute parallel fan-out.** If an experiment's evaluation step is "test prompt P against external LLM endpoints E1…En," `COMPOSIO_MULTI_EXECUTE_TOOL` can run all n in one batch (up to 50). Locally, this would be N sequential `curl` calls or a manually-orchestrated parallel pool.

3. **External API surface without local credential management.** Composio's `COMPOSIO_MANAGE_CONNECTIONS` handles OAuth for a long list of SaaS APIs. ce-optimize experiments that test against external endpoints (Notion, Airtable, GitHub, etc.) avoid the local-credential footprint.

### Where Composio adds friction for ce-optimize

1. **Most ce-optimize use cases are local code.** The Quick Start advice is "start from `references/example-hard-spec.yaml` when the metric is objective and cheap to measure." That's TypeScript/Python lint pass rates, build times, retrieval relevance against a local fixture set. **Local execution wins on simplicity, latency, and cost.**

2. **Sandbox quotas.** Composio has rate limits and 4-min Workbench call timeouts. ce-optimize sessions run for hours. A hours-long session translated into Composio calls would burn through quotas fast — and ce-optimize's persistence-first discipline means each evaluation is a separate Composio invocation, not a single long-running process.

3. **Per-call latency.** Local Python imports are sub-second. Composio MCP calls round-trip through the MCP server, the user's Composio account, and back — each call is hundreds of ms minimum. For a hard-gate experiment that runs 100 evaluations to find the best parameter, that's 100× the latency overhead.

4. **Debuggability.** Local experiments produce local logs visible to the user. Composio Workbench logs live in the Composio dashboard, not in the user's terminal. When the experiment goes sideways, the diagnosis path is harder.

5. **Plugin coupling.** If ce-optimize *requires* yellow-composio for parallelism, ce-optimize stops working when Composio is degraded or unconfigured. The yellow-plugins convention (and the existing yellow-composio CLAUDE.md prose) says Composio is "an enhancement, never a dependency." **A first-class integration risks violating that contract.**

### Net

The benefits matter for a narrow slice of use cases (external-API-driven prompt tuning, scrape-based optimization). The friction matters for the broad use case (local code optimization). Forcing one interface to serve both produces a worse experience for the dominant case.

## Recommendation in detail

### Don't change yellow-composio

Keep the plugin's surface where it is: setup + status + the patterns skill. Resist any temptation to add a "ce-optimize-compatible" command or a "composio-optimize" command directly to `plugins/yellow-composio/`. **yellow-composio should remain a quiet enabler, not an active orchestrator.**

### Do define an opt-in integration boundary in W3.14

When `ce-optimize` ships (W3.14, deferred from this session), its spec schema should include an optional `execution.environment` field with values `local` (default) and `composio-workbench`. The skill body should:

1. **Default to `local`** — every spec without an explicit `environment` runs locally with no Composio dependency.
2. **Detect Composio availability** when `composio-workbench` is set: `ToolSearch("COMPOSIO_REMOTE_WORKBENCH")`. If not found, fall back to `local` with a clear `[ce-optimize] Warning: composio-workbench requested but Composio MCP not installed; falling back to local.` message — never error out.
3. **Translate experiments to `COMPOSIO_MULTI_EXECUTE_TOOL` calls** when the environment is set and Composio is available — one MCP call per experiment batch (up to 50).
4. **Maintain persistence discipline.** The experiment log still lives on local disk under `.context/compound-engineering/ce-optimize/<spec>/`. Composio is the execution backend for experiment runs, not the result store. **This is non-negotiable** — the upstream's persistence rule is what makes ce-optimize survivable across sessions.

### Operating-mode summary

| Mode                              | Trigger                                                  | Implementation         |
| --------------------------------- | -------------------------------------------------------- | ---------------------- |
| `local` (default)                 | Any spec without explicit `environment`                  | Local Python / shell   |
| `composio-workbench` (opt-in)     | Spec sets `execution.environment: composio-workbench` AND `COMPOSIO_REMOTE_WORKBENCH` is discoverable via ToolSearch | Composio MCP fan-out   |
| `composio-workbench` → `local` (graceful degrade) | Spec asks for Composio but tool not found                | Falls back, warns once |

### What this looks like in code (sketch only)

In ce-optimize's experiment dispatch step (post-W3.14):

```
env = spec.execution.environment ?? "local"
if env == "composio-workbench":
    if ToolSearch("COMPOSIO_REMOTE_WORKBENCH").found:
        run_via_composio_multi_execute(experiments)
    else:
        warn_once("[ce-optimize] composio-workbench requested but MCP not installed; falling back to local")
        env = "local"
if env == "local":
    run_via_local_executor(experiments)
```

### Why this lives in yellow-core (W3.14), not yellow-composio

ce-optimize is a yellow-core skill in the Wave 3 plan (item #10, scope `NEW plugins/yellow-core/skills/optimize/`). The Composio-aware execution is part of *how* ce-optimize runs, not a separate Composio feature. yellow-composio's CLAUDE.md is explicit: "Composio is an enhancement, never a dependency" — keeping the integration logic on the consumer side (yellow-core) preserves that contract, because yellow-core checks for Composio availability the same way it checks for any other optional dependency (yellow-codex, yellow-linear, etc.).

## Out of scope for this report

- **`codex-executor` parallelization via Composio.** Could codex-rescue fan out N investigations across a Composio Workbench? Probably not — Codex CLI invocation is the gating factor, and Codex CLI doesn't run in a Composio sandbox. **Different orchestration entirely.**
- **Other consumer plugins.** yellow-debt scanners, yellow-docs generators, yellow-research deep-research — all of these *could* in principle benefit from Multi-Execute fan-out for their own batch operations. None are in the W3.8 scope. If a future research session takes them up, the same opt-in / graceful-degrade contract should apply.
- **Composio billing / quotas.** Real production deployment of any Composio-backed loop needs a budget guard. yellow-composio's `/composio:status` already surfaces local usage tracking; deeper budget integration is a separate concern.

## Acceptance check

Per the plan's W3.8 acceptance criterion ("research-report level, explicit go/no-go"):

- [x] Searched upstream EveryInc plugin tree at locked SHA for batch-execution / remote-workbench orchestration patterns
- [x] Confirmed `ce-optimize` parallel-experiments is the only meaningful candidate
- [x] Provided explicit go/no-go: **NO-GO for direct yellow-composio expansion; YES-GO for opt-in integration in W3.14's ce-optimize skill**
- [x] Documented why the integration belongs in yellow-core, not yellow-composio
- [x] Deferred all implementation to W3.14 (when it ships)

## References

- `plugins/yellow-composio/CLAUDE.md` — current yellow-composio surface and graceful-degradation contract
- `plugins/yellow-composio/skills/composio-patterns/SKILL.md` — Composio tool reference
- Upstream `RESEARCH/upstream-snapshots/e5b397c9d1883354f03e338dd00f98be3da39f9f/plugins/compound-engineering/skills/ce-optimize/SKILL.md` — 659-line locked snapshot of the parallel-experiments skill (W3.14 source)
- `plans/everyinc-merge.md` Wave 3 task W3.14 — "ce-optimize analog" implementation spec for yellow-core
- `plans/everyinc-merge-wave3.md` item #10 — `feat/optimize-skill` parallel branch (currently deferred)
