#!/usr/bin/env node
'use strict';

/**
 * Trigger eval runner (CLAUDE-315, roadmap R1.2).
 *
 * Measures whether a skill or command fires (the model calls the Skill tool
 * with it) for prompts that should trigger it, and stays quiet for near-miss
 * prompts that should not. Wraps `claude plugin eval` with the free
 * `tool_used` grader only; no model-graded check runs.
 *
 * Eval sets live at repo level in evals/<plugin>/<component>/queries.json and
 * never ship inside a plugin. Each run stages a temporary root holding copies
 * of the plugins a set needs (the target plus its manifest dependencies) and
 * one generated case per query, then runs the whole suite in one invocation.
 *
 * Usage:
 *   node scripts/eval/trigger/run-trigger-eval.js [selector...]
 *        [--check] [--validate] [--runs N] [--max-cost-usd USD]
 *        [--model M] [-j N] [--out DIR] [--keep-stage] [--case GLOB]
 *
 *   selector   <plugin> or <plugin>:<component>, e.g. yellow-core:flow-plan.
 *              No selector selects every set.
 *   --check    Free: validate the query files only (no CLI call).
 *   --validate Free: also stage the suite and let `claude plugin eval` load
 *              every case under a zero cost ceiling (no model call).
 *   --case     Run only cases whose name matches GLOB, e.g. '*--n*' for the
 *              near misses. Unrun queries are left out of the scores.
 *
 * Exit: 0 when every selected set reaches held-out accuracy >= 0.8, 1 when
 * one does not, 2 on a check failure or a partial or failed run.
 *
 * Method, costs and the committed baseline: evals/README.md.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

const DEFAULTS = {
  runs: 3,
  maxCostUsd: 20,
  model: 'claude-sonnet-5-5',
  concurrency: 4,
  maxTurns: 2,
};
// A query triggers when its target fires in at least this share of runs.
const TRIGGER_THRESHOLD = 0.5;
const HELDOUT_PASS = 0.8;
const MIN_PER_SIDE = 8;
const ALLOWED_TOOLS = ['Skill', 'Read', 'Glob', 'Grep'];
const COPY_SKIP = new Set(['.git', 'node_modules', 'tests', 'evals']);

function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    out[kv[1]] = kv[2].replace(/^(['"])(.*)\1$/, '$2').trim();
  }
  return out;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Resolve a component source path to the names the Skill tool may be called
 * with. A command is listed by its file path (`plugin:dir:file`), a skill by
 * its directory (`plugin:dir`); both may also be called by frontmatter name.
 */
function componentInfo(repoRoot, source) {
  const parts = source.split('/');
  if (parts[0] !== 'plugins' || parts.length < 4) {
    throw new Error(`source must be plugins/<plugin>/...: ${source}`);
  }
  const plugin = parts[1];
  const rest = parts.slice(2);
  let kind;
  let pathId;
  if (rest[0] === 'commands' && rest[rest.length - 1].endsWith('.md')) {
    kind = 'command';
    pathId = rest.slice(1).join(':').replace(/\.md$/, '');
  } else if (rest[0] === 'skills' && rest[rest.length - 1] === 'SKILL.md') {
    kind = 'skill';
    pathId = rest.slice(1, -1).join(':');
  } else {
    throw new Error(`source is not a command or SKILL.md: ${source}`);
  }
  const abs = path.join(repoRoot, source);
  const fm = fs.existsSync(abs)
    ? parseFrontmatter(fs.readFileSync(abs, 'utf8'))
    : null;
  const names = [pathId];
  if (fm && fm.name && fm.name !== pathId) names.push(fm.name);
  const inputMatch =
    `"skill":\\s*"(?:${escapeRegex(plugin)}:)?` +
    `(?:${names.map(escapeRegex).join('|')})"`;
  return { plugin, kind, pathId, names, frontmatter: fm, inputMatch };
}

function loadSets(repoRoot, selectors) {
  const root = path.join(repoRoot, 'evals');
  const sets = [];
  if (!fs.existsSync(root)) return sets;
  for (const plugin of fs.readdirSync(root).sort()) {
    const pdir = path.join(root, plugin);
    if (!fs.statSync(pdir).isDirectory()) continue;
    for (const component of fs.readdirSync(pdir).sort()) {
      const file = path.join(pdir, component, 'queries.json');
      if (!fs.existsSync(file)) continue;
      const id = `${plugin}:${component}`;
      if (
        selectors.length &&
        !selectors.some((s) => s === plugin || s === id)
      ) {
        continue;
      }
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      sets.push({ id, plugin, component, file, data });
    }
  }
  return sets;
}

function checkSet(repoRoot, set) {
  const errors = [];
  const { data } = set;
  if (typeof data.source !== 'string') {
    return [`${set.id}: missing "source"`];
  }
  let info;
  try {
    info = componentInfo(repoRoot, data.source);
  } catch (e) {
    return [`${set.id}: ${e.message}`];
  }
  if (info.plugin !== set.plugin) {
    errors.push(
      `${set.id}: source plugin ${info.plugin} != directory ${set.plugin}`
    );
  }
  if (!info.frontmatter) {
    errors.push(`${set.id}: source ${data.source} does not exist`);
  } else {
    if (info.frontmatter['disable-model-invocation'] === 'true') {
      errors.push(
        `${set.id}: target sets disable-model-invocation; it cannot trigger`
      );
    }
    if (
      info.kind === 'skill' &&
      info.frontmatter['user-invocable'] === 'false'
    ) {
      errors.push(
        `${set.id}: target is user-invocable: false; it is not listed to the model`
      );
    }
  }
  const qs = Array.isArray(data.queries) ? data.queries : [];
  const seen = new Set();
  const count = {
    pos: { train: 0, heldout: 0 },
    neg: { train: 0, heldout: 0 },
  };
  qs.forEach((q, i) => {
    const where = `${set.id} query ${i + 1}`;
    if (typeof q.q !== 'string' || !q.q.trim())
      errors.push(`${where}: empty "q"`);
    if (typeof q.trigger !== 'boolean')
      errors.push(`${where}: "trigger" must be boolean`);
    if (q.split !== 'train' && q.split !== 'heldout') {
      errors.push(`${where}: "split" must be train or heldout`);
    }
    const key = String(q.q).trim().toLowerCase();
    if (seen.has(key)) errors.push(`${where}: duplicate query`);
    seen.add(key);
    if (typeof q.trigger === 'boolean' && count.pos[q.split] !== undefined) {
      count[q.trigger ? 'pos' : 'neg'][q.split] += 1;
    }
  });
  for (const side of ['pos', 'neg']) {
    const total = count[side].train + count[side].heldout;
    const label = side === 'pos' ? 'should-trigger' : 'should-not-trigger';
    if (total < MIN_PER_SIDE) {
      errors.push(
        `${set.id}: ${total} ${label} queries (minimum ${MIN_PER_SIDE})`
      );
    }
    if (count[side].heldout === 0 || count[side].train === 0) {
      errors.push(
        `${set.id}: ${label} queries need both train and heldout entries`
      );
    }
  }
  return errors;
}

function pluginDeps(repoRoot, plugin, acc = new Set()) {
  if (acc.has(plugin)) return acc;
  const manifest = path.join(
    repoRoot,
    'plugins',
    plugin,
    '.claude-plugin',
    'plugin.json'
  );
  if (!fs.existsSync(manifest))
    throw new Error(`no plugin manifest: ${manifest}`);
  acc.add(plugin);
  const deps = JSON.parse(fs.readFileSync(manifest, 'utf8')).dependencies || [];
  // Optional dependencies are loaded too: a plugin loaded from a directory
  // drops its agents when a declared dependency is missing.
  for (const d of deps) {
    const name = typeof d === 'string' ? d : d.name;
    if (name) pluginDeps(repoRoot, name, acc);
  }
  return acc;
}

function caseName(set, q, index) {
  const side = q.trigger ? 'p' : 'n';
  return `${set.plugin}--${set.component}--${side}${String(index + 1).padStart(2, '0')}`;
}

/**
 * Write a stage root: plugins/<name>/ copies and evals/<case>/case.yaml.
 * case.yaml is written as JSON, which YAML accepts unchanged.
 */
function stage(repoRoot, sets, stageDir, opts) {
  const plugins = new Set();
  const cases = [];
  for (const set of sets) {
    const info = componentInfo(repoRoot, set.data.source);
    const load = [...pluginDeps(repoRoot, info.plugin)];
    load.forEach((p) => plugins.add(p));
    set.data.queries.forEach((q, i) => {
      const name = caseName(set, q, i);
      const grader = {
        type: 'tool_used',
        name: q.trigger ? 'fires' : 'stays-quiet',
        tool: 'Skill',
        input_match: info.inputMatch,
      };
      // tool_used defaults min to 1, so a near miss sets both bounds.
      if (q.trigger) grader.min = 1;
      else Object.assign(grader, { min: 0, max: 0 });
      const doc = {
        schema_version: '1.0',
        name,
        description: `${set.id} ${q.trigger ? 'should trigger' : 'near miss'} (${q.split})`,
        tags: [
          'trigger',
          set.id.replace(':', '--'),
          q.trigger ? 'pos' : 'neg',
          q.split,
        ],
        plugins: load.map((p) => `../../plugins/${p}`),
        execution: {
          prompt: q.q,
          max_turns: opts.maxTurns,
          allowed_tools: ALLOWED_TOOLS,
        },
        runs: opts.runs,
        graders: [grader],
      };
      const dir = path.join(stageDir, 'evals', name);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'case.yaml'),
        JSON.stringify(doc, null, 2) + '\n'
      );
      cases.push({
        name,
        set: set.id,
        trigger: q.trigger,
        split: q.split,
        q: q.q,
      });
    });
  }
  for (const p of plugins) {
    fs.cpSync(
      path.join(repoRoot, 'plugins', p),
      path.join(stageDir, 'plugins', p),
      {
        recursive: true,
        filter: (src) => !COPY_SKIP.has(path.basename(src)),
      }
    );
  }
  return cases;
}

/** Score `claude plugin eval --json` output against the staged cases. */
function score(aggregate, cases) {
  const byName = new Map((aggregate.cases || []).map((c) => [c.name, c]));
  const perQuery = [];
  let failedRuns = 0;
  for (const meta of cases) {
    const c = byName.get(meta.name);
    const runs = c && c.arms && Array.isArray(c.arms.with) ? c.arms.with : [];
    let fired = 0;
    let valid = 0;
    for (const r of runs) {
      const g = (r.graders || [])[0];
      const benign = !r.error || /maximum number of turns/i.test(r.error);
      if (!g || !benign) {
        failedRuns += 1;
        continue;
      }
      valid += 1;
      const triggered = meta.trigger ? g.passed : !g.passed;
      if (triggered) fired += 1;
    }
    const rate = valid ? fired / valid : null;
    const triggers = rate !== null && rate >= TRIGGER_THRESHOLD;
    perQuery.push({
      ...meta,
      runs: valid,
      fired,
      rate,
      pass: rate === null ? null : triggers === meta.trigger,
    });
  }
  const sets = {};
  for (const r of perQuery) {
    const s = (sets[r.set] ||= { queries: [] });
    s.queries.push(r);
  }
  for (const [id, s] of Object.entries(sets)) {
    const scored = s.queries.filter((q) => q.pass !== null);
    const pos = scored.filter((q) => q.trigger);
    const neg = scored.filter((q) => !q.trigger);
    const tp = pos.filter((q) => q.pass).length;
    const fp = neg.filter((q) => !q.pass).length;
    const held = scored.filter((q) => q.split === 'heldout');
    const ratio = (a, b) => (b ? a / b : null);
    const mean = (xs) =>
      ratio(
        xs.reduce((a, q) => a + q.rate, 0),
        xs.length
      );
    sets[id] = {
      queries: s.queries,
      recall: ratio(tp, pos.length),
      precision: ratio(tp, tp + fp),
      specificity: ratio(neg.length - fp, neg.length),
      accuracy: ratio(scored.filter((q) => q.pass).length, scored.length),
      heldoutAccuracy: ratio(held.filter((q) => q.pass).length, held.length),
      meanTriggerRatePositive: mean(pos),
      meanTriggerRateNegative: mean(neg),
    };
  }
  return { sets, failedRuns };
}

function fmt(x) {
  return x === null || x === undefined ? '  -  ' : x.toFixed(2).padStart(5);
}

function report(summary) {
  const lines = [
    'SET                            RECALL PREC  SPEC  ACC   HELD  RATE+ RATE-',
  ];
  for (const [id, s] of Object.entries(summary.sets)) {
    lines.push(
      `${id.padEnd(30)} ${fmt(s.recall)} ${fmt(s.precision)} ${fmt(s.specificity)} ` +
        `${fmt(s.accuracy)} ${fmt(s.heldoutAccuracy)} ${fmt(s.meanTriggerRatePositive)} ` +
        `${fmt(s.meanTriggerRateNegative)}`
    );
  }
  lines.push('');
  lines.push('Misses (query, side, fired/runs):');
  for (const s of Object.values(summary.sets)) {
    for (const q of s.queries) {
      if (q.pass === false) {
        lines.push(
          `  ${q.name} ${q.trigger ? 'should fire' : 'near miss'} ${q.fired}/${q.runs}: ${q.q.slice(0, 80)}`
        );
      }
    }
  }
  return lines.join('\n');
}

function parseArgs(argv) {
  const opts = {
    ...DEFAULTS,
    selectors: [],
    check: false,
    validate: false,
    out: null,
    keepStage: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${a} needs a value`);
      return argv[++i];
    };
    if (a === '--check') opts.check = true;
    else if (a === '--validate') opts.validate = true;
    else if (a === '--runs') opts.runs = Number(next());
    else if (a === '--max-cost-usd') opts.maxCostUsd = Number(next());
    else if (a === '--model') opts.model = next();
    else if (a === '-j' || a === '--concurrency')
      opts.concurrency = Number(next());
    else if (a === '--out') opts.out = path.resolve(next());
    else if (a === '--keep-stage') opts.keepStage = true;
    else if (a === '--case') opts.caseGlob = next();
    else if (a === '-h' || a === '--help') opts.help = true;
    else if (a.startsWith('-')) throw new Error(`unknown option ${a}`);
    else opts.selectors.push(a);
  }
  if (!Number.isInteger(opts.runs) || opts.runs < 1 || opts.runs > 50) {
    throw new Error('--runs must be an integer from 1 to 50');
  }
  if (!(opts.maxCostUsd >= 0))
    throw new Error('--max-cost-usd must be a number >= 0');
  if (
    !Number.isInteger(opts.concurrency) ||
    opts.concurrency < 1 ||
    opts.concurrency > 8
  ) {
    throw new Error('-j must be an integer from 1 to 8');
  }
  return opts;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (e) {
    console.error(`run-trigger-eval: ${e.message}`);
    return 2;
  }
  if (opts.help) {
    console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0]);
    return 0;
  }
  const sets = loadSets(REPO_ROOT, opts.selectors);
  if (!sets.length) {
    console.error(
      `run-trigger-eval: no eval set matches ${opts.selectors.join(' ') || '(all)'}`
    );
    return 2;
  }
  const errors = sets.flatMap((s) => checkSet(REPO_ROOT, s));
  if (errors.length) {
    errors.forEach((e) => console.error(`✗ ${e}`));
    return 2;
  }
  const total = sets.reduce((n, s) => n + s.data.queries.length, 0);
  console.log(`✓ ${sets.length} eval set(s), ${total} queries`);
  if (opts.check) return 0;

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trigger-eval-'));
  const cases = stage(REPO_ROOT, sets, stageDir, opts);
  const outDir = opts.out || path.join(stageDir, 'results');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonPath = path.join(outDir, 'aggregate.json');
  const args = [
    'plugin',
    'eval',
    stageDir,
    '--ablation',
    'none',
    '--trust-plugin',
    '--no-publish',
    '--runs',
    String(opts.runs),
    '--model',
    opts.model,
    '-j',
    String(opts.concurrency),
    '--max-cost-usd',
    String(opts.validate ? 0 : opts.maxCostUsd),
    '--threshold',
    '0',
    '--json',
    jsonPath,
    '--report',
    path.join(outDir, 'report.html'),
  ];
  if (opts.caseGlob) args.push('--case', opts.caseGlob);
  console.log(
    opts.validate
      ? `Validating ${cases.length} cases (zero cost ceiling, no model call)`
      : `Running ${cases.length} cases x ${opts.runs} runs on ${opts.model}, ` +
          `cap ${opts.maxCostUsd} USD API-equivalent (not a bill)`
  );
  const res = spawnSync('claude', args, {
    cwd: stageDir,
    env: { ...process.env, COMPOUND_DRAIN_IN_PROGRESS: '1' },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const cliOut = `${res.stdout || ''}${res.stderr || ''}`;
  const cleanup = () => {
    if (!opts.keepStage) fs.rmSync(stageDir, { recursive: true, force: true });
  };
  if (res.error) {
    console.error(
      `run-trigger-eval: could not start claude: ${res.error.message}`
    );
    cleanup();
    return 2;
  }
  if (/Couldn't load|^✗/m.test(cliOut)) {
    console.error(cliOut);
    cleanup();
    return 2;
  }
  if (opts.validate) {
    console.log(`✓ claude plugin eval loaded all ${cases.length} cases`);
    cleanup();
    return 0;
  }
  if (!fs.existsSync(jsonPath)) {
    console.error(cliOut);
    cleanup();
    return 2;
  }
  const aggregate = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const scored = score(aggregate, cases);
  const summary = {
    claudeVersion: aggregate.claudeVersion,
    startedAt: aggregate.startedAt,
    model: opts.model,
    runsPerQuery: opts.runs,
    maxTurns: opts.maxTurns,
    costUsdApiEquivalent: aggregate.costUsd,
    durationSeconds: aggregate.durationSeconds,
    partial: Boolean(aggregate.partial),
    partialReason: aggregate.partialReason || null,
    failedRuns: scored.failedRuns,
    sets: scored.sets,
  };
  fs.writeFileSync(
    path.join(outDir, 'summary.json'),
    JSON.stringify(summary, null, 2) + '\n'
  );
  console.log(report(summary));
  console.log(
    `\nCost ${Number(aggregate.costUsd || 0).toFixed(2)} USD API-equivalent (not a bill), ` +
      `${aggregate.durationSeconds}s. Results: ${outDir}`
  );
  // Without --out the results sit inside the stage dir, so it stays.
  if (opts.out) cleanup();
  if (opts.keepStage || !opts.out) console.log(`Stage kept: ${stageDir}`);
  if (summary.partial || summary.failedRuns > 0) return 2;
  const low = Object.values(summary.sets).some(
    (s) => s.heldoutAccuracy === null || s.heldoutAccuracy < HELDOUT_PASS
  );
  return low ? 1 : 0;
}

module.exports = {
  componentInfo,
  loadSets,
  checkSet,
  pluginDeps,
  stage,
  score,
  parseArgs,
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
