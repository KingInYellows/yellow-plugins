---
"yellow-core": minor
---

Add `ideation` skill (W3.11) — generate 3 grounded approaches with the Toulmin
warrant contract and route the chosen approach into `brainstorm-orchestrator`

Introduces `plugins/yellow-core/skills/ideation/SKILL.md` (user-invokable as
`/yellow-core:ideation`) for solution-space exploration before requirements
dialogue. Adapted from upstream `EveryInc/compound-engineering-plugin`
`ce-ideate` skill at locked SHA `e5b397c9d1883354f03e338dd00f98be3da39f9f`,
re-shaped around the MIDAS three-phase pattern + Toulmin warrant contract
researched in the source plan.

**Six phases:**

1. **Subject gate** — identifiability check on `<problem_statement>`. Vague
   inputs (quality/category words like "improvements", "things to fix") trigger
   one `AskUserQuestion` with three options (Specify / Surprise me / Cancel).
   Threshold heuristic: <10 words AND no domain noun → ask; otherwise accept.

2. **Free generation (no gate)** — 5–7 candidates across six framing biases
   (pain, inversion, reframing, leverage, cross-domain analogy, constraint-
   flipping). Frames are starting lenses, not constraints. Optional one-shot
   `Grep` grounding when the input mentions an existing file.

3. **Warrant filtration (Toulmin contract)** — every survivor carries
   `[EVIDENCE: direct|external|reasoned|SPECULATIVE]` + `[WARRANT: linking
   principle]` + `[IDEA: one sentence]`. Empty `[EVIDENCE]` slot → rejected.
   `[SPECULATIVE]` is valid only when strict-warrant mode is **off** (see
   below). Filter to 3 strongest survivors.

4. **Warrant-guided extension** — each survivor gets a **next step** (smallest
   testable action) and an **open question** (highest-uncertainty unknown)
   so the brainstorm hand-off lands with concrete dialogue starting points,
   not just an idea.

5. **Ranked selection** — surface the 3 survivors via `AskUserQuestion`. User
   may pick "Other" with custom text to override (skill routes that text into
   brainstorm directly).

6. **Hand-off** — spawn `brainstorm-orchestrator` via `Task` with literal
   3-segment `subagent_type: "yellow-core:workflow:brainstorm-orchestrator"`
   (avoids the LLM-guesses-2-segment regression from PR #289). Graceful
   degradation: if the spawn fails, surface the chosen approach + warrant +
   next step + open question in plain markdown for manual paste.

**Strict-warrant mode (domain-aware default):**

- **Off** for feature ideation, DX, refactoring, docs, performance — speculation
  is allowed because cross-domain analogies often start speculative and gain
  evidence in brainstorm.
- **On** for security, auth, encryption, data migration, schema changes,
  payments, PII — speculation in these domains has higher cost (a speculative
  auth approach that misses a known attack pattern can ship a real CVE).

Detection is keyword-based (case-insensitive) on `<problem_statement>`. User
override via `--strict-warrant` / `--no-strict-warrant` flag in `$ARGUMENTS`.
Conflicting flags resolve left-to-right (last-flag-wins), and the resolution
is reported in one line so the user can correct.

**Yellow-plugins divergence from upstream:**

- **No `references/` subdirectory** — upstream splits universal-ideation,
  post-ideation-workflow, and web-research-cache into separate files
  totaling ~1100 lines. yellow-core skills consistently use a single
  SKILL.md, so the methodology is folded inline at ~270 lines. The
  surprise-me deeper-exploration mode, V15 web-research cache, V17
  scratch-checkpoints, and full Phase 6 menu (Save/Refine/Open in Proof) are
  out of scope for this initial pass — they can be added later if the team
  adopts ideation as a primary entry point.
- **Toulmin contract is new** — upstream's `direct: / external: / reasoned:`
  warrant tags map onto Toulmin's evidence slot, but yellow-core also requires
  an explicit `[WARRANT]` slot (linking principle) and `[IDEA]` slot, and
  permits `[SPECULATIVE]` as an explicit fourth evidence type rather than
  silently allowing weakly-grounded ideas through.
- **Three survivors, not 5–7** — upstream targets 25–30 survivors after
  dedupe; yellow-core targets 3 because the next step is a hand-off to a
  blocking `AskUserQuestion`, not a markdown artifact.
- **No persistence** — upstream writes `docs/ideation/<topic>.md`; yellow-core
  treats the conversation as the artifact and lets the brainstorm output
  (`docs/brainstorms/<date>-<topic>-brainstorm.md`) carry the chosen
  approach forward. Persistence can be added later if a use case emerges.

**Methodology preserved from upstream:**

- Six framing biases (pain / inversion / reframing / leverage / analogy /
  constraint-flipping) — kept verbatim because the framing taxonomy is the
  durable insight; the dispatch architecture around it is what changed.
- Subject-identifiability gate as Phase 0 — kept because vague subjects
  produce scattered ideation regardless of the rest of the workflow.
- Warrant-required generation rule — kept; this is the quality mechanism.

**Hand-off semantics:** ideation answers "what are the strongest options
worth exploring"; brainstorm answers "what does the chosen option mean
precisely". Different jobs, different tools — the skill explicitly does not
continue requirements dialogue after the spawn.

Discoverable via auto-discovery from
`plugins/yellow-core/skills/ideation/SKILL.md` — no `plugin.json` registration
required.
