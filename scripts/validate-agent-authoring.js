#!/usr/bin/env node

'use strict';

const fs = require('fs');
const path = require('path');

const YAML = require('yaml');

const ROOT = path.resolve(__dirname, '..');
// Allow tests to point the validator at a fixture tree by setting
// VALIDATE_PLUGINS_DIR. Production runs leave it unset and use plugins/.
const PLUGINS_DIR = process.env.VALIDATE_PLUGINS_DIR
  ? path.resolve(process.env.VALIDATE_PLUGINS_DIR)
  : path.join(ROOT, 'plugins');

// W1.5 rule: review/ agents must be read-only.
// Any agent at plugins/<name>/agents/review/<file>.md must not list Bash,
// Write, Edit, or MultiEdit in its `tools:` set. Reviewers analyze; they do
// not act. This containment limits the blast radius of prompt-injection
// attempts in the untrusted PR diff and comment text reviewers consume.
// MultiEdit is a batch file-write tool just like Write/Edit — omitting it
// here left a fail-open path (a reviewer could list `MultiEdit` in `tools:`
// and still mutate files); it is denied alongside Write/Edit.
const REVIEW_AGENT_DENIED_TOOLS = ['Bash', 'Write', 'Edit', 'MultiEdit'];

// W1.5b rule: the write-capable tools a review/ agent with `memory:` set MUST
// deny via `disallowedTools` to preserve the read-only contract. `memory:`
// auto-enables Read/Write/Edit regardless of the `tools:` list, which bypasses
// the W1.5 `tools:` check above. MultiEdit is included defensively (it is NOT
// memory-granted) so the deny set the shipped review agents already declare —
// `[Write, Edit, MultiEdit]` — is enforced and stays consistent with
// REVIEW_AGENT_DENIED_TOOLS. Named REQUIRED_DISALLOWED (not MEMORY_GRANTED_*)
// because MultiEdit is a required deny, not a tool memory grants.
const REVIEW_AGENT_REQUIRED_DISALLOWED_TOOLS = ['Write', 'Edit', 'MultiEdit'];

// Valid `memory:` scope values per Claude Code docs. Only these three
// activate per-agent memory (and the Read/Write/Edit auto-grant); any other
// value (e.g. `memory: true`) is silently ignored by Claude Code, so W1.5b
// must NOT fire on it — otherwise the author gets a misleading error.
const VALID_MEMORY_SCOPES = new Set(['user', 'project', 'local']);

// RULE 13 — library-context drift lint. The canonical context7 → EXA →
// WebSearch fallback chain lives in
// plugins/yellow-research/skills/library-context/SKILL.md. Any agent that
// lists a context7 tool in `tools:` MUST either preload that skill
// (`skills: [library-context]`, which injects the chain at spawn) OR carry an
// inline copy of the safe chain — proven present by the exact drift sentinel
// below. An agent with context7 tools but neither is a silent drift surface:
// it queries context7 with no documented fallback when the user-level MCP is
// absent. This turns that into a CI failure (the repo's "prose alone is
// insufficient" enforcement philosophy — cf. W1.5/RULE 14).
const CONTEXT7_TOOLS = new Set([
  'mcp__context7__resolve-library-id',
  'mcp__context7__query-docs',
  'mcp__context7__get-library-docs',
]);
// The exact phrase every inlined copy of the safe chain must contain. The dash
// is an em dash (U+2014) — written as a literal `—` here so the source is
// unambiguous. An ASCII `--`/`-` substitution (typography auto-correct,
// copy-from-rendered-markdown) fails this exact-substring check, which is the
// intended catch: a corrupted sentinel means the inline copy can no longer be
// drift-detected and must be repaired.
const LIBRARY_CONTEXT_SENTINEL = 'context7 unavailable — falling back to';

// Documented exceptions to the read-only rule. Each entry must be a
// plugins-relative POSIX path. Any exception requires a "Tool Surface —
// Documented … Exception" section in the agent body explaining why the
// containment is dropped and bounding legitimate use.
const REVIEW_AGENT_ALLOWLIST = new Set([
  // codex-reviewer invokes the codex CLI binary as its core function; read-
  // only restriction would break the agent. See agent body for rationale.
  // Decision recorded in plans/everyinc-merge.md W1.2 (2026-04-29).
  'yellow-codex/agents/review/codex-reviewer.md',
  // gemini-reviewer and opencode-reviewer wrap external CLIs (gemini, opencode)
  // for the on-demand cross-lineage council. Same containment rationale as
  // codex-reviewer: Bash is required for binary invocation; read-only contract
  // is enforced via prose discipline + explicit prompt design. See plan
  // plans/yellow-council-godmodeskill-integration.md (2026-05-04).
  'yellow-council/agents/review/gemini-reviewer.md',
  'yellow-council/agents/review/opencode-reviewer.md',
]);

// V1/V2/V3/V4 — model/effort frontmatter lint rules (see M-A-01 plan).
// V1: effort: enum (low|medium|high|xhigh|max) — hard error
// V2: model: enum (haiku|sonnet|opus|inherit, optionally versioned) — hard error
// V3: model: inherit on a scanner/CI agent — non-blocking warning
// V4: synthesizer/orchestrator name without effort: high — non-blocking warning
// `inherit` is a bare keyword (no version suffix). Real model IDs (haiku,
// sonnet, opus) accept an optional one- or two-segment numeric suffix
// (e.g., `sonnet-4-6`).
const MODEL_VALUE_PATTERN = /^(haiku|sonnet|opus)(-\d+(-\d+)?)?$|^inherit$/;
const EFFORT_VALUES = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
// Effort tiers that satisfy V4's "extended chain-of-thought" requirement.
// Subset of EFFORT_VALUES — keep in sync if EFFORT_VALUES grows.
const HIGH_EFFORT = new Set(['high', 'xhigh', 'max']);
const SYNTHESIZER_NAME_PATTERN =
  /(synthesizer|orchestrator|conductor|aggregator|compounder)/i;

// Files exempt from V3/V4 advisory warnings — intentional inheritance
// or intentional default-effort. Each entry must be a plugins-relative
// POSIX path. Adding a file here is a documented decision that the
// agent's role does NOT match the rule's intent (e.g., failure-analyst
// in agents/ci/ is a workflow integration agent, not a scanner).
const MODEL_RULE_ALLOWLIST = new Set([
  // failure-analyst is a CI failure diagnosis orchestrator that delegates
  // to runner-diagnostics for deep work — its model: inherit is intentional.
  'yellow-ci/agents/ci/failure-analyst.md',
  // workflow-optimizer is a CI workflow analysis agent whose output quality
  // scales with the parent session's model — intentional inherit.
  'yellow-ci/agents/ci/workflow-optimizer.md',
  // devin-orchestrator coordinates Devin V3 sessions; its name matches V4's
  // synthesizer/orchestrator pattern but the effort default is intentional —
  // sub-sessions run independently in Devin.
  'yellow-devin/agents/workflow/devin-orchestrator.md',
  // knowledge-compounder dispatches sub-agents that handle synthesis;
  // its own role is orchestration without Opus-level reasoning. The name
  // matches V4's pattern but the brainstorm explicitly decided no
  // effort: high because the heavy work happens in sub-agents.
  'yellow-core/agents/workflow/knowledge-compounder.md',
]);

const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  blue: '\x1b[34m',
  yellow: '\x1b[33m',
};

function walk(dir, predicate = () => true) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walk(fullPath, predicate));
      continue;
    }
    if (predicate(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

function extractFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  return match ? match[1] : null;
}

// Parse a frontmatter block with the real YAML parser (the `yaml` devDep) so
// the validator interprets frontmatter the way Claude Code does: inline
// comments stripped, quotes resolved, and flow/block lists normalized to
// arrays. Returns the parsed object on success, {} for empty/scalar/array
// frontmatter (so key lookups yield undefined → null/[]), and null when the
// YAML is malformed (callers degrade safely; validateAgentFile surfaces a
// clear error). Replacing the old hand-rolled regex parser fixes two bugs an
// audit confirmed change behavior on ZERO currently-shipped files:
//   1. `memory: project # note` previously returned "project # note" (not a
//      valid scope), silently disabling the W1.5b read-only gate. YAML strips
//      the comment → "project" → the gate fires, matching runtime behavior.
//   2. The comma-string list form Claude Code accepts (`disallowedTools:
//      Write, Edit`) is now honored — see parseList.
// Memoized on the raw frontmatter string: every agent file parses the same
// block up to ~6 times (model/effort/memory/name + tools/disallowedTools/
// skills), and YAML.parse is heavier than the regex parser it replaced.
// Identical input always yields the same result, so caching is safe — and the
// validator is spawned as a fresh child process per run (see the test harness),
// so the Map starts empty each invocation and never leaks across runs.
const frontmatterCache = new Map();

function parseFrontmatter(frontmatter) {
  if (frontmatter == null) return null;
  if (frontmatterCache.has(frontmatter)) {
    return frontmatterCache.get(frontmatter);
  }
  let data;
  try {
    data = YAML.parse(frontmatter);
  } catch {
    // Malformed YAML caches as null so the parse-error gate fires consistently.
    frontmatterCache.set(frontmatter, null);
    return null;
  }
  const result =
    data && typeof data === 'object' && !Array.isArray(data) ? data : {};
  frontmatterCache.set(frontmatter, result);
  return result;
}

// Read a scalar frontmatter value as a string. Primitive non-strings are
// coerced (e.g. `memory: true` → "true", which is not a VALID_MEMORY_SCOPE, so
// the scope-gate still treats memory as inactive — preserving prior behavior
// and the W1.5b scope-gate test). A non-scalar node (array/object) is INVALID
// frontmatter for a scalar field: plain String() would smuggle `model:
// [inherit]` → "inherit" or `effort: [high]` → "high" past the V1/V2 enum
// checks the old regex parser flagged. Returning the JSON form instead keeps
// those checks failing loudly, and for `memory:` an array/object scope is not a
// VALID_MEMORY_SCOPE so the W1.5b gate stays inactive — matching Claude Code,
// which ignores a non-scalar memory value (no Read/Write/Edit auto-grant → no
// read-only-contract risk).
function parseScalar(frontmatter, key) {
  const data = parseFrontmatter(frontmatter);
  if (!data) return null;
  const value = data[key];
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Read a list-typed frontmatter value (tools/disallowedTools/skills) as a
// string array. Claude Code accepts THREE forms for these fields: a YAML block
// list, a YAML flow list (`[A, B]`), and a bare comma-separated string
// (`A, B`) — see docs/research/all-possible-subagent-frontmatter-config.md.
// yaml.parse returns an array for the first two and a STRING for the comma
// form, so a string result is split on commas. Anything else (or an absent
// key) yields []. ALWAYS returns a real array so RULE 14's exact-match
// `.includes()` anti-bypass invariant holds on every accepted form (a naive
// yaml.parse swap without this split would degrade RULE 14 to substring
// matching on the comma-string form).
function parseList(frontmatter, key) {
  const data = parseFrontmatter(frontmatter);
  if (!data) return [];
  const value = data[key];
  if (Array.isArray(value)) {
    return value
      .map((item) => (item == null ? '' : String(item).trim()))
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

function relative(filePath) {
  return path.relative(ROOT, filePath) || '.';
}

function logInfo(message) {
  console.log(`${colors.blue}ℹ INFO:${colors.reset} ${message}`);
}

function logError(message) {
  console.error(`${colors.red}✗ ERROR:${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠ WARN:${colors.reset} ${message}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓ PASS:${colors.reset} ${message}`);
}

// Patterns used by the agent and markdown scans. Module-scoped constants.
const skillReferencePattern = /`([a-z0-9][a-z0-9-]*)`\s+skill\b/gi;
const pluginSubagentPattern =
  /subagent_type\s*(?:=|:)\s*["']?([a-z0-9-]+:[a-z0-9-]+(?::[a-z0-9-]+)?)["']?/g;

// Validate a single agent .md file. Pushes findings into ctx.errors /
// ctx.warnings and registers discovered agent names in ctx.pluginAgents.
function validateAgentFile(filePath, ctx) {
  const { errors, warnings, pluginAgents } = ctx;
  const content = fs.readFileSync(filePath, 'utf8');
  const frontmatter = extractFrontmatter(content);

  if (!frontmatter) {
    errors.push(`${relative(filePath)}: missing frontmatter`);
    return;
  }

  // Malformed YAML would make every parseScalar/parseList return null/[],
  // silently disabling W1.5/W1.5b/V1/V2/RULE 14. Fail loud with the parser's
  // message instead of letting the security gates go dark.
  try {
    YAML.parse(frontmatter);
  } catch (e) {
    errors.push(
      `${relative(filePath)}: malformed YAML frontmatter — ${String(e.message).split('\n')[0]}`
    );
    return;
  }

  // Derive plugin name from the path relative to PLUGINS_DIR so the validator
  // works with VALIDATE_PLUGINS_DIR fixture trees that are not under a
  // literal `.../plugins/...` ancestor directory.
  const relPath = path.relative(PLUGINS_DIR, filePath);
  const relSegments = relPath.split(path.sep);
  const pluginName = relSegments[0];
  // Hoist segment computations used by V3/V4 + W1.5 + 3-segment registration.
  // POSIX-form path keeps allowlist matching consistent across platforms.
  const agentsIdx = relSegments.indexOf('agents');
  const subdir = agentsIdx >= 0 ? relSegments[agentsIdx + 1] : null;
  const pluginsRelPath = relSegments.join('/');
  const allowlisted = MODEL_RULE_ALLOWLIST.has(pluginsRelPath);

  // V1: effort: enum (low | medium | high | xhigh | max). Hard error.
  // Catches typos (e.g., effort: hight) that would otherwise silently fall
  // back to the default and make the assignment a no-op.
  const effortVal = parseScalar(frontmatter, 'effort');
  const effortValid = effortVal === null || EFFORT_VALUES.has(effortVal);
  if (effortVal !== null && !EFFORT_VALUES.has(effortVal)) {
    errors.push(
      `${relative(filePath)}: invalid effort: '${effortVal}' ` +
        `(must be one of low|medium|high|xhigh|max)`
    );
  }

  // V2: model: enum (haiku | sonnet | opus | inherit, optionally with a
  // version suffix like sonnet-4-5). Hard error. Catches typos and invalid
  // model IDs that would otherwise fall back to the session default.
  const modelVal = parseScalar(frontmatter, 'model');
  if (modelVal !== null && !MODEL_VALUE_PATTERN.test(modelVal)) {
    errors.push(
      `${relative(filePath)}: invalid model: '${modelVal}' ` +
        `(must match ^(haiku|sonnet|opus)(-\\d+(-\\d+)?)?$|^inherit$)`
    );
  }

  // V3: model: inherit on a scanner/CI agent — non-blocking warning.
  // Nudge authors to make an explicit model choice for narrow-role agents
  // where inheritance is usually wasteful (Opus session → scanner doing
  // taxonomy matching).
  if (
    modelVal === 'inherit' &&
    !allowlisted &&
    (subdir === 'scanners' || subdir === 'ci')
  ) {
    warnings.push(
      `[V3 advisory] ${relative(filePath)}: model: inherit on a ` +
        `${subdir}/ agent — consider explicit model: sonnet or model: ` +
        `haiku based on task complexity.`
    );
  }

  // V4: synthesizer/orchestrator agents without effort: high — non-blocking
  // warning. Matches against the name field (not description) to reduce
  // false positives on integration agents that mention "synthesize" or
  // "merge" in passing. Skipped when V1 already errors on effortVal so
  // authors get one clear message instead of two.
  const name = parseScalar(frontmatter, 'name');
  if (
    name &&
    SYNTHESIZER_NAME_PATTERN.test(name) &&
    effortValid &&
    !HIGH_EFFORT.has(effortVal) &&
    !allowlisted
  ) {
    warnings.push(
      `[V4 advisory] ${relative(filePath)}: synthesizer/orchestrator ` +
        `agent without effort: high — consider extended chain-of-thought.`
    );
  }

  if (!name) {
    errors.push(`${relative(filePath)}: missing agent name`);
  } else {
    pluginAgents.add(`${pluginName}:${name}`);
    // Claude Code's Task registry resolves cross-plugin agents by the
    // three-segment plugin:directory:name form. For an agent file at
    // `<pluginName>/agents/<dir>/<name>.md`, the runtime dispatch form
    // is `<pluginName>:<dir>:<name>`. Both forms are registered so
    // existing 2-segment callers continue to validate, but the
    // markdown-scan loop below emits a warning when a 2-segment hit has
    // an available 3-segment equivalent — turning silent runtime
    // failures into loud CI signal for new code.
    if (agentsIdx >= 0 && relSegments.length > agentsIdx + 2) {
      pluginAgents.add(`${pluginName}:${subdir}:${name}`);
    }
  }

  const hasAllowedTools = /^allowed-tools:/m.test(frontmatter);
  if (hasAllowedTools) {
    errors.push(`${relative(filePath)}: use "tools:" instead of "allowed-tools:"`);
  }

  if (!hasAllowedTools) {
    const tools = parseList(frontmatter, 'tools');
    if (tools.length === 0) {
      errors.push(`${relative(filePath)}: missing or empty "tools:" list`);
    }

    // W1.5 — Rule X: review/ agents must be read-only (no Bash, Write, Edit)
    // unless explicitly allowlisted with a documented exception. Tool
    // comparison is case-insensitive so lowercase variants (e.g., `bash`)
    // cannot bypass the security check. Reuses subdir/pluginsRelPath
    // computed once at the top of the loop body.
    if (subdir === 'review') {
      if (!REVIEW_AGENT_ALLOWLIST.has(pluginsRelPath)) {
        const deniedLower = REVIEW_AGENT_DENIED_TOOLS.map((t) =>
          t.toLowerCase()
        );
        const toolsLower = tools.map((t) => t.toLowerCase());
        const violations = REVIEW_AGENT_DENIED_TOOLS.filter((_, i) =>
          toolsLower.includes(deniedLower[i])
        );
        if (violations.length > 0) {
          errors.push(
            `${relative(filePath)}: review/ agent must not include ` +
              `${violations.join(', ')} in "tools:" — reviewers are ` +
              `read-only (W1.5 rule). To document a justified exception, ` +
              `add the plugins-relative path to REVIEW_AGENT_ALLOWLIST in ` +
              `scripts/validate-agent-authoring.js and add a "Tool ` +
              `Surface — Documented Exception" section to the agent body.`
          );
        }

        // W1.5b — `memory:` auto-enables Read/Write/Edit regardless of the
        // `tools:` list (per Claude Code docs), so the tools-only check
        // above is bypassed whenever a review/ agent sets `memory:`. Such an
        // agent MUST restore the read-only contract with a `disallowedTools`
        // entry denying Write, Edit, and MultiEdit. Without this, a review
        // agent processing untrusted PR diffs runs write-capable. Every
        // shipped memory:-bearing review agent already carries
        // `disallowedTools: [Write, Edit, MultiEdit]`; this rule prevents a
        // future review/ agent from regressing silently.
        const memoryScope = parseScalar(frontmatter, 'memory');
        if (memoryScope && VALID_MEMORY_SCOPES.has(memoryScope)) {
          const disallowedLower = parseList(
            frontmatter,
            'disallowedTools'
          ).map((t) => t.toLowerCase());
          const missingDenies = REVIEW_AGENT_REQUIRED_DISALLOWED_TOOLS.filter(
            (t) => !disallowedLower.includes(t.toLowerCase())
          );
          if (missingDenies.length > 0) {
            errors.push(
              `${relative(filePath)}: review/ agent sets \`memory: ` +
                `${memoryScope}\` (auto-enables Read/Write/Edit) but ` +
                `\`disallowedTools\` is missing ${missingDenies.join(', ')} ` +
                `— add \`disallowedTools: [Write, Edit, MultiEdit]\` to ` +
                `restore the read-only contract (W1.5b rule). The \`tools:\` ` +
                `list alone does not contain the memory-granted write access.`
            );
          }
        }
      }
    }

    const skills = new Set(parseList(frontmatter, 'skills'));

    // RULE 13 — context7 consumers must preload library-context OR carry the
    // inline drift sentinel. `tools` is the parsed `tools:` list, so an empty
    // list is vacuously exempt (the "missing tools" gate above already fired).
    // The sentinel is matched against the BODY only (frontmatter stripped, same
    // CRLF-tolerant pattern as RULE 14b) with HTML comments also stripped —
    // otherwise a sentinel phrase quoted only inside a `<!-- ... -->` dev note
    // (documenting the pattern, not instructing the agent — see
    // best-practices-researcher.md's inline-copy comment) would satisfy
    // `.includes()` with no real fallback instruction in the agent's live
    // prompt body. A stray sentinel in a YAML comment still cannot satisfy the
    // rule either, since frontmatter is stripped first.
    // Exact Set match on tool names and exact-substring match on the em-dash
    // sentinel are both intentionally strict so an ASCII-dash corruption is
    // caught, not silently accepted.
    // The `skills: [library-context]` preload exemption is scoped to agents
    // inside plugins/yellow-research/ — the plugin that owns the skill.
    // Cross-plugin `skills:` resolution is documented as unavailable
    // (anthropics/claude-code#15944, closed not planned — see
    // plugins/yellow-research/skills/library-context/SKILL.md), so an agent
    // in another plugin that merely lists `skills: [library-context]` would
    // pass a plugin-unscoped check yet never receive the fallback chain at
    // runtime; such agents must inline the sentinel instead.
    if (tools.some((t) => CONTEXT7_TOOLS.has(t))) {
      const body = content
        .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
        .replace(/<!--[\s\S]*?-->/g, '');
      const preloadExempt =
        pluginName === 'yellow-research' &&
        [...skills].some((s) => s.toLowerCase() === 'library-context');
      if (!preloadExempt && !body.includes(LIBRARY_CONTEXT_SENTINEL)) {
        const fixHint =
          pluginName === 'yellow-research'
            ? `either add \`library-context\` to \`skills:\` frontmatter, ` +
              `OR include the exact phrase \`${LIBRARY_CONTEXT_SENTINEL}\` ` +
              `(em dash U+2014) in the agent body.`
            : `include the exact phrase \`${LIBRARY_CONTEXT_SENTINEL}\` (em ` +
              `dash U+2014) in the agent body — the \`skills: ` +
              `[library-context]\` preload only satisfies this rule for ` +
              `agents inside plugins/yellow-research/ (cross-plugin skills: ` +
              `resolution is unavailable at runtime).`;
        errors.push(
          `${relative(filePath)}: references a context7 tool without a ` +
            `documented fallback (RULE 13). Fix: ${fixHint}`
        );
      }
    }

    const referencedSkills = new Set();
    for (const match of content.matchAll(skillReferencePattern)) {
      referencedSkills.add(match[1].toLowerCase());
    }

    if (referencedSkills.size > 0) {
      const hasSkillTool = tools.includes('Skill');
      for (const skill of referencedSkills) {
        if (!skills.has(skill) && !hasSkillTool) {
          errors.push(
            `${relative(filePath)}: references skill "${skill}" without frontmatter "skills:" preload or Skill tool access`
          );
        }
      }
    }
  }
}

// Map plugin:name → plugin:dir:name (when unambiguous). Used to suggest
// the 3-segment form to authors who wrote a 2-segment dispatch.
function buildTwoToThreeSegmentMap(pluginAgents) {
  const twoToThreeSegment = new Map();
  for (const ref of pluginAgents) {
    const parts = ref.split(':');
    if (parts.length !== 3) continue;
    const twoSeg = `${parts[0]}:${parts[2]}`;
    if (twoToThreeSegment.has(twoSeg)) {
      twoToThreeSegment.set(twoSeg, null); // ambiguous
    } else {
      twoToThreeSegment.set(twoSeg, ref);
    }
  }
  return twoToThreeSegment;
}

// Validate subagent_type references across all markdown files against the
// discovered agent registry. Pushes hard errors into ctx.errors; emits
// advisory info logs for legacy 2-segment dispatch forms.
function validateSubagentReferences(markdownFiles, ctx) {
  const { pluginNames, pluginAgents, twoToThreeSegment, errors } = ctx;
  for (const filePath of markdownFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const match of content.matchAll(pluginSubagentPattern)) {
      const subagentType = match[1];
      const pluginName = subagentType.split(':', 1)[0];
      if (!pluginNames.has(pluginName)) {
        continue;
      }
      if (!pluginAgents.has(subagentType)) {
        errors.push(
          `${relative(filePath)}: subagent_type "${subagentType}" does not match any declared plugin agent`
        );
        continue;
      }
      // The 2-segment form remains valid (transitional) but the runtime
      // requires 3-segment. Warn when a 2-segment hit has an unambiguous
      // 3-segment equivalent so authors update before the runtime fails.
      const segments = subagentType.split(':');
      if (segments.length === 2) {
        const suggestion = twoToThreeSegment.get(subagentType);
        if (suggestion) {
          logInfo(
            `${relative(filePath)}: subagent_type "${subagentType}" uses the legacy 2-segment form — runtime expects "${suggestion}" (3-segment). Update before this CI gate becomes hard-fail.`
          );
        }
      }
    }
  }
}

// RULE 14 — staging-promoter frontmatter MUST contain
// `disallowedTools: [AskUserQuestion]` (in YAML list form, with or without
// flow-style brackets). This is the load-bearing structural enforcement
// of D8 in plans/background-compounding-triggers.md: the
// staging-promoter is dispatched from a background `claude -p` drain
// session where AskUserQuestion would block indefinitely (no human
// in the loop). If a future edit removes the deny, the drain breaks
// silently. RULE 14 turns that into a CI failure.
function validateStagingPromoterFrontmatter(agentFiles, errors) {
  // RULE 14 applies to BOTH staging-promoter AND staging-reviewer — both
  // run non-interactively under bypassPermissions; both must hard-deny
  // AskUserQuestion at the frontmatter level (prose-only enforcement is
  // insufficient — see docs/solutions/code-quality/subagent-frontmatter-field-catalog.md).
  const checkedAgents = [
    'staging-promoter.md',
    'staging-reviewer.md',
  ];

  for (const basename of checkedAgents) {
    const agentPath = agentFiles.find(
      (f) =>
        f.endsWith(
          `${path.sep}yellow-core${path.sep}agents${path.sep}workflow${path.sep}${basename}`
        )
    );
    if (!agentPath) {
      // Agent not yet present (e.g., stack item #2 not merged).
      // Don't fail; the agent itself is what's checked, not its absence.
      continue;
    }
    const content = fs.readFileSync(agentPath, 'utf8');
    const frontmatter = extractFrontmatter(content) || '';

    // Use the parseList() helper to extract disallowedTools as a real
    // string array, then check whether 'AskUserQuestion' is a complete
    // entry. parseList handles both flow form (`[A, B]`) and block form
    // (`- A\n- B`) and strips surrounding quotes. A `.includes()` test
    // on the parsed array is impossible to fool with substring tricks —
    // values like `'foo AskUserQuestion'`, `'AskUserQuestion(bar)'`, or
    // `'AskUserQuestion-disabled'` parse to entries that are NOT equal
    // to the bare string `'AskUserQuestion'`, so they fail the check.
    // Earlier regex-only approaches (`\b` boundaries, then lookarounds)
    // were repeatedly bypassed — see PR #544 round-1/round-2/round-3
    // review comments — because regex cannot cleanly distinguish "the
    // entry IS AskUserQuestion" from "the entry CONTAINS AskUserQuestion".
    // Parsing first sidesteps the entire problem.
    const disallowed = parseList(frontmatter, 'disallowedTools');
    if (!disallowed.includes('AskUserQuestion')) {
      errors.push(
        `${relative(agentPath)}: RULE 14 — frontmatter MUST contain \`disallowedTools: [AskUserQuestion]\` (load-bearing D8 enforcement for background-compounding drain pipeline; staging-promoter and staging-reviewer both run non-interactively)`
      );
    }
  }
}

// RULE 14b — V1 prose-only: scan staging-promoter body for any Write/Edit
// invocation that targets MEMORY.md but is not gated to the `## Session
// Notes` section. Full AST lint deferred to V2. V1 catches the most
// common drift: someone editing the agent to also append to other
// MEMORY.md sections (CORE_RULES, USER_PREFERENCES, KNOWN_PROJECTS).
function validateMemoryWriteSectionGate(agentFiles, errors) {
  const promoter = agentFiles.find(
    (f) =>
      f.endsWith(
        `${path.sep}yellow-core${path.sep}agents${path.sep}workflow${path.sep}staging-promoter.md`
      )
  );
  if (!promoter) {
    return;
  }
  const content = fs.readFileSync(promoter, 'utf8');
  // Strip frontmatter so we don't false-positive on metadata. CRLF-tolerant:
  // WSL2-authored files arrive with \r\n line endings before `.gitattributes`
  // normalization, and this regex must match either form (mirrors the pattern
  // used by extractFrontmatter()).
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');

  // RULE 14b heuristic: the body must document that
  //  (a) writes target `## Session Notes` ONLY (with explicit write-
  //      restriction phrasing, not a bare "Session Notes" mention),
  //  (b) the three protected sections (CORE_RULES, USER_PREFERENCES,
  //      KNOWN_PROJECTS) are explicitly forbidden in a paragraph that
  //      also contains a "Never modify|write|touch" verb.
  //
  // Session Notes gate (a): bare `/Session Notes/` would let any
  // unrelated mention (e.g., "Session Notes section exists") satisfy
  // the rule, so a body that talks about Session Notes without claiming
  // write-restriction could pass. Bind the check to a write-restriction
  // anchor within ±200 chars: `only|ONLY .* Session Notes`,
  // `Session Notes .* section ONLY|never any other`, or
  // `append .* Session Notes .* [Nn]ever`.
  const sessionNotesGateRe = new RegExp(
    // Form A: "ONLY ... Session Notes" within 200 chars
    '(?:only|ONLY)[\\s\\S]{0,200}Session Notes' +
      // Form B: "Session Notes ... section only / ONLY / never any|other"
      '|Session Notes[\\s\\S]{0,200}(?:section\\s+only|ONLY|never\\s+(?:any|other))' +
      // Form C: "append ... Session Notes ... Never" within 200 chars
      '|append[\\s\\S]{0,200}Session Notes[\\s\\S]{0,200}[Nn]ever',
    ''
  );
  const hasSessionNotesGate = sessionNotesGateRe.test(body);

  // Never-modify invariant (b): paragraph co-location prevents the
  // global-boolean false negative where a "Never modify staging entries"
  // sentence elsewhere in the body satisfies the rule without actually
  // protecting any section. A SINGLE paragraph (text between blank lines)
  // must contain a "Never modify|write|touch" verb AND name all three
  // protected sections. This admits multi-line invariants ("Never touch
  // `## CORE_RULES`,\n `## USER_PREFERENCES`, or `## KNOWN_PROJECTS`")
  // while rejecting decoys.
  const paragraphs = body.split(/\n\s*\n/);
  const hasNeverModifyInvariant = paragraphs.some(
    (p) =>
      /[Nn]ever (?:modif|write|touch)/.test(p) &&
      /CORE_RULES/.test(p) &&
      /USER_PREFERENCES/.test(p) &&
      /KNOWN_PROJECTS/.test(p)
  );

  if (!hasSessionNotesGate || !hasNeverModifyInvariant) {
    errors.push(
      `${relative(promoter)}: RULE 14b — staging-promoter body must reference \`## Session Notes\` write gate AND state a "Never modify" invariant that enumerates ALL THREE protected sections (CORE_RULES, USER_PREFERENCES, KNOWN_PROJECTS) within the same paragraph as the Never-verb (D9-L1 memory-partition enforcement)`
    );
  }
}

// Validate that command files do not source plugin files via BASH_SOURCE.
function validateCommandFiles(commandFiles, errors) {
  for (const filePath of commandFiles) {
    const content = fs.readFileSync(filePath, 'utf8');
    const frontmatter = extractFrontmatter(content);
    const codeBlocks = content.match(/```[^\n]*\n[\s\S]*?```/g) || [];
    const codeContent = (frontmatter || '') + '\n' + codeBlocks.join('\n');
    if (codeContent.includes('BASH_SOURCE')) {
      errors.push(
        `${relative(filePath)}: markdown command sources plugin files via BASH_SOURCE; use \${CLAUDE_PLUGIN_ROOT} or a real script path`
      );
    }
  }
}

function main() {
  const pluginNames = new Set(
    fs
      .readdirSync(PLUGINS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  );

  const agentFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.includes(`${path.sep}agents${path.sep}`) &&
      filePath.endsWith('.md')
  );
  // Skip CHANGELOG.md files: they document history including agents that have
  // since been deleted/renamed, so subagent_type references in CHANGELOG prose
  // are not live dispatches and must not be validated against the current
  // agent registry. See `docs/solutions/build-errors/` for context.
  const markdownFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.endsWith('.md') &&
      path.basename(filePath).toUpperCase() !== 'CHANGELOG.MD'
  );
  const commandFiles = walk(
    PLUGINS_DIR,
    (filePath) =>
      filePath.includes(`${path.sep}commands${path.sep}`) &&
      filePath.endsWith('.md')
  );

  logInfo(
    `Validating ${agentFiles.length} agents and ${markdownFiles.length} markdown files...`
  );

  const errors = [];
  const warnings = [];
  const pluginAgents = new Set();

  for (const filePath of agentFiles) {
    validateAgentFile(filePath, { errors, warnings, pluginAgents });
  }

  const twoToThreeSegment = buildTwoToThreeSegmentMap(pluginAgents);
  validateSubagentReferences(markdownFiles, {
    pluginNames,
    pluginAgents,
    twoToThreeSegment,
    errors,
  });
  validateCommandFiles(commandFiles, errors);
  validateStagingPromoterFrontmatter(agentFiles, errors);
  validateMemoryWriteSectionGate(agentFiles, errors);

  // Print warnings first so they remain visible above the trailing
  // success/error block. Warnings do NOT affect exit code; only errors do.
  for (const warning of warnings) {
    logWarning(warning);
  }

  if (errors.length > 0) {
    for (const error of errors) {
      logError(error);
    }
    process.exit(1);
  }

  logSuccess(
    `Validated ${agentFiles.length} agents and ${markdownFiles.length} markdown files`
  );
}

main();
