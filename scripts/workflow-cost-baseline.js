#!/usr/bin/env node
'use strict';

/**
 * Per-workflow cost baseline (CLAUDE-302, roadmap R0.1).
 *
 * Reads Claude Code session transcripts and `claude -p --output-format json`
 * results after the fact and reports tokens, wall-clock duration and
 * API-equivalent cost per workflow run. It adds no hook and calls no model.
 *
 * Usage:
 *   node scripts/workflow-cost-baseline.js [--projects-dir <dir>]
 *        [--project <substring>]... [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *        [--headless <file-or-dir>]... [--json] [--runs]
 *
 * Method and limits: docs/research/workflow-cost-baseline.md.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');

// Canonical workflow -> matcher for the names a transcript records. A typed
// command is recorded as `/yellow-review:review:resolve-pr`; a Skill tool call
// as `yellow-review:review:review-pr` or the bare `review:pr`.
const WORKFLOWS = [
  ['/review:pr', /(^|:)review:(review-)?pr$/],
  ['/review:resolve', /(^|:)review:resolve(-pr)?$/],
  ['/review:sweep', /(^|:)review:sweep$/],
  ['/flow:plan', /(^|:)flow:plan$/],
  ['/flow:work', /(^|:)flow:work$/],
];

// USD per million tokens, from
// https://platform.claude.com/docs/en/about-claude/pricing (read 2026-11-11).
// Columns: base input, 5-minute cache write, 1-hour cache write, cache read,
// output.
const PRICES = {
  'claude-fable-5-2': [8, 10, 16, 0.2, 40],
  'claude-fable-5-1': [10, 12.5, 20, 0.25, 50],
  'claude-fable-5': [10, 12.5, 20, 1, 50],
  'claude-opus-5-5': [4, 5, 8, 0.2, 20],
  'claude-opus-5': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-8': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-7': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-6': [5, 6.25, 10, 0.5, 25],
  'claude-opus-4-5': [5, 6.25, 10, 0.5, 25],
  'claude-sonnet-5-5': [2, 2.5, 4, 0.1, 10],
  'claude-sonnet-5': [2, 2.5, 4, 0.2, 10],
  'claude-sonnet-4-6': [3, 3.75, 6, 0.3, 15],
  'claude-sonnet-4-5': [3, 3.75, 6, 0.3, 15],
  'claude-haiku-5-5': [0.1, 0.125, 0.2, 0.01, 0.5],
  'claude-haiku-4-5': [1, 1.25, 2, 0.1, 5],
};
// Claude Haiku 5.5 bills prompts over 100,000 tokens at a higher rate.
const HAIKU_55_LARGE_PROMPT = [0.5, 0.625, 1, 0.05, 2.5];
const HAIKU_55_LARGE_PROMPT_TOKENS = 100000;
// Fast mode is exactly twice the standard rate on the models that offer it.
const FAST_MODE_MULTIPLIER = 2;

function canonicalWorkflow(name) {
  if (typeof name !== 'string') return null;
  const bare = name.trim().replace(/^\//, '');
  for (const [canonical, pattern] of WORKFLOWS) {
    if (pattern.test(bare)) return canonical;
  }
  return null;
}

function normalizeModel(model) {
  return String(model || '')
    .replace(/\[1m\]$/, '')
    .replace(/-20\d{6}$/, '');
}

function emptyTokens() {
  return { input: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, output: 0 };
}

function usageTokens(usage) {
  const creation = usage.cache_creation || {};
  const write1h = creation.ephemeral_1h_input_tokens || 0;
  const writeTotal = usage.cache_creation_input_tokens || 0;
  // Older records carry only the total; without a breakdown it is the
  // 5-minute rate, which is the API default.
  const write5m =
    creation.ephemeral_5m_input_tokens !== undefined
      ? creation.ephemeral_5m_input_tokens
      : Math.max(0, writeTotal - write1h);
  return {
    input: usage.input_tokens || 0,
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
    cacheRead: usage.cache_read_input_tokens || 0,
    output: usage.output_tokens || 0,
  };
}

/** API-equivalent USD for one response, or null when the model has no price. */
function usageCost(model, usage) {
  const id = normalizeModel(model);
  let price = PRICES[id];
  if (!price) return null;
  const t = usageTokens(usage);
  if (id === 'claude-haiku-5-5') {
    const prompt = t.input + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
    if (prompt > HAIKU_55_LARGE_PROMPT_TOKENS) price = HAIKU_55_LARGE_PROMPT;
  }
  const dollars =
    (t.input * price[0] +
      t.cacheWrite5m * price[1] +
      t.cacheWrite1h * price[2] +
      t.cacheRead * price[3] +
      t.output * price[4]) /
    1e6;
  return usage.speed === 'fast' ? dollars * FAST_MODE_MULTIPLIER : dollars;
}

function newBucket() {
  return { calls: 0, tokens: emptyTokens(), costUsd: 0, unpricedCalls: 0, models: {} };
}

function addUsage(bucket, model, usage) {
  const t = usageTokens(usage);
  for (const key of Object.keys(t)) bucket.tokens[key] += t[key];
  bucket.calls += 1;
  const id = normalizeModel(model);
  bucket.models[id] = (bucket.models[id] || 0) + 1;
  const cost = usageCost(model, usage);
  if (cost === null) bucket.unpricedCalls += 1;
  else bucket.costUsd += cost;
}

function mergeBucket(into, from) {
  for (const key of Object.keys(from.tokens)) into.tokens[key] += from.tokens[key];
  into.calls += from.calls;
  into.costUsd += from.costUsd;
  into.unpricedCalls += from.unpricedCalls;
  for (const [model, n] of Object.entries(from.models)) {
    into.models[model] = (into.models[model] || 0) + n;
  }
}

async function eachRecord(file, onRecord) {
  const lines = readline.createInterface({
    input: fs.createReadStream(file),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    if (!line) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue; // a torn final line in a live transcript
    }
    onRecord(record);
  }
}

function userText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => block && block.type === 'tool_result')) return null;
  return content
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text || '')
    .join('\n');
}

// Harness-written user records that are not a person typing a new prompt.
const NON_PROMPT_PREFIX =
  /^<(task-notification|wake|local-command-stdout|local-command-caveat|bash-input|bash-stdout|bash-stderr|system-reminder)[ >]/;

/**
 * The human prompt in a user record: `{ workflow }` (null when the prompt is
 * not one of the tracked commands), or null when the record is a tool result,
 * injected skill body, notification or other harness-written entry.
 */
function humanPrompt(record) {
  if (record.type !== 'user' || !record.message || record.isSidechain) return null;
  if (record.isMeta || record.isCompactSummary) return null;
  if (record.origin && record.origin.kind !== 'human') return null;
  const text = userText(record.message.content);
  if (text === null) return null;
  const trimmed = text.trimStart();
  if (NON_PROMPT_PREFIX.test(trimmed)) return null;
  const command = trimmed.match(/<command-name>([^<]+)<\/command-name>/);
  return { workflow: command ? canonicalWorkflow(command[1]) : null };
}

/**
 * Split one main-session transcript into workflow runs. A run starts at a
 * typed tracked command, or at a Skill tool call for one when no run is open,
 * and ends at the next human prompt or the end of the transcript. A Skill
 * call for a different tracked workflow inside an open run starts a nested
 * run, which ends at the next nested run or with its parent; the parent's
 * totals include it.
 */
async function parseSession(file, seen) {
  const runs = [];
  const toolUseOwner = new Map();
  const turns = []; // [startMs, endMs] of every completed turn
  let open = null;
  let nested = null;
  let lastTs = null;
  let unowned = null; // usage of the response in progress, counted before a run opened

  const newRun = (record, workflow, trigger, ts, parent) => ({
    workflow,
    trigger,
    parent,
    children: [],
    sessionId: record.sessionId || path.basename(file, '.jsonl'),
    entrypoint: record.entrypoint || 'unknown',
    startTs: ts,
    endTs: ts,
    endedBy: 'eof',
    lead: newBucket(),
    subagents: newBucket(),
    subagentCount: 0,
  });
  const closeNested = (endTs, endedBy) => {
    if (!nested) return;
    nested.endTs = endTs === null ? nested.startTs : endTs;
    nested.endedBy = endedBy;
    runs.push(nested);
    nested = null;
  };
  const close = (endTs, endedBy) => {
    if (!open) return;
    closeNested(endTs, endedBy);
    open.endTs = endTs === null ? open.startTs : endTs;
    open.endedBy = endedBy;
    runs.push(open);
    open = null;
  };
  const start = (record, workflow, trigger, ts) => {
    open = newRun(record, workflow, trigger, ts, null);
  };

  await eachRecord(file, (record) => {
    const ts = record.timestamp ? Date.parse(record.timestamp) : null;
    if (ts !== null && !Number.isNaN(ts)) lastTs = ts;

    if (record.type === 'system' && record.subtype === 'turn_duration') {
      if (lastTs !== null && record.durationMs >= 0) turns.push([lastTs - record.durationMs, lastTs]);
      return;
    }

    const prompt = humanPrompt(record);
    if (prompt) {
      close(lastTs, 'prompt');
      unowned = null;
      const duplicate = record.uuid && seen.promptUuids.has(record.uuid);
      if (record.uuid) seen.promptUuids.add(record.uuid);
      if (prompt.workflow && !duplicate) start(record, prompt.workflow, 'typed', lastTs);
      return;
    }

    if (record.type !== 'assistant' || !record.message || record.isSidechain) return;
    const message = record.message;
    const blocks = Array.isArray(message.content) ? message.content : [];

    for (const block of blocks) {
      if (!block || block.type !== 'tool_use') continue;
      if (block.name === 'Skill') {
        const workflow = canonicalWorkflow(block.input && block.input.skill);
        if (workflow && !open) {
          start(record, workflow, 'model', lastTs);
          if (unowned && unowned.id === message.id) {
            addUsage(open.lead, unowned.model, unowned.usage);
          }
        } else if (workflow && workflow !== open.workflow) {
          closeNested(lastTs, 'next-workflow');
          nested = newRun(record, workflow, 'nested', lastTs, open);
          open.children.push(nested);
        }
      }
      if (open && block.id) toolUseOwner.set(block.id, nested || open);
    }

    // One API response is written as one record per content block, each
    // repeating the same usage; count it once.
    if (message.usage && message.id && !seen.messageIds.has(message.id)) {
      seen.messageIds.add(message.id);
      if (open) addUsage((nested || open).lead, message.model, message.usage);
      else unowned = { id: message.id, model: message.model, usage: message.usage };
    }
  });

  close(lastTs, 'eof');
  // Turn records can overlap (a turn that resumes while another is still
  // being timed), so merge them before measuring.
  turns.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const turn of turns) {
    const last = merged[merged.length - 1];
    if (last && turn[0] <= last[1]) last[1] = Math.max(last[1], turn[1]);
    else merged.push([...turn]);
  }
  for (const run of runs) {
    run.activeMs = merged.reduce(
      (total, [from, to]) => total + Math.max(0, Math.min(to, run.endTs) - Math.max(from, run.startTs)),
      0
    );
  }
  return { runs, toolUseOwner };
}

/** Usage of one subagent transcript, plus the tool-use ids it issued itself. */
async function parseSubagent(file, seen) {
  const bucket = newBucket();
  const toolUseIds = [];
  await eachRecord(file, (record) => {
    if (record.type !== 'assistant' || !record.message) return;
    const message = record.message;
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block && block.type === 'tool_use' && block.id) toolUseIds.push(block.id);
    }
    if (message.usage && message.id && !seen.messageIds.has(message.id)) {
      seen.messageIds.add(message.id);
      addUsage(bucket, message.model, message.usage);
    }
  });
  return { bucket, toolUseIds };
}

/** Add each subagent's usage to the run whose tool call spawned it. */
async function attributeSubagents(sessionFile, toolUseOwner, seen) {
  const dir = path.join(sessionFile.replace(/\.jsonl$/, ''), 'subagents');
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  const agents = [];
  for (const name of names) {
    if (!/^agent-.*\.jsonl$/.test(name)) continue;
    let meta = {};
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, name.replace(/\.jsonl$/, '.meta.json')), 'utf8'));
    } catch {
      // no metadata: the subagent cannot be tied to a tool call
    }
    const parsed = await parseSubagent(path.join(dir, name), seen);
    agents.push({ toolUseId: meta.toolUseId, ...parsed });
  }
  // A subagent spawned by another subagent inherits that subagent's run, so
  // resolve until no new owner is found.
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const agent of agents) {
      if (agent.done) continue;
      const owner = toolUseOwner.get(agent.toolUseId);
      if (!owner) continue;
      mergeBucket(owner.subagents, agent.bucket);
      owner.subagentCount += 1;
      for (const id of agent.toolUseIds) toolUseOwner.set(id, owner);
      agent.done = true;
      progressed = true;
    }
  }
}

function findSessionFiles(projectsDir, projectFilters) {
  const files = [];
  let projects;
  try {
    projects = fs.readdirSync(projectsDir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`cannot read projects directory ${projectsDir}: ${error.message}`);
  }
  for (const project of projects) {
    if (!project.isDirectory()) continue;
    if (projectFilters.length && !projectFilters.some((f) => project.name.includes(f))) continue;
    const dir = path.join(projectsDir, project.name);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) files.push(path.join(dir, entry.name));
    }
  }
  return files.sort();
}

function summarizeRun(run) {
  const total = newBucket();
  const subagents = newBucket();
  let subagentCount = 0;
  for (const part of [run, ...run.children]) {
    mergeBucket(total, part.lead);
    mergeBucket(total, part.subagents);
    mergeBucket(subagents, part.subagents);
    subagentCount += part.subagentCount;
  }
  return {
    workflow: run.workflow,
    trigger: run.trigger,
    parent: run.parent ? run.parent.workflow : null,
    sessionId: run.sessionId,
    entrypoint: run.entrypoint,
    start: new Date(run.startTs).toISOString(),
    endedBy: run.endedBy,
    wallSeconds: Math.round((run.endTs - run.startTs) / 1000),
    activeSeconds: Math.round(run.activeMs / 1000),
    nested: run.children.map((child) => child.workflow),
    subagentCount,
    calls: total.calls,
    tokens: total.tokens,
    costUsd: total.costUsd,
    subagentCostUsd: subagents.costUsd,
    unpricedCalls: total.unpricedCalls,
    models: total.models,
  };
}

async function collectRuns({ projectsDir, projectFilters = [], since = null, until = null }) {
  const seen = { messageIds: new Set(), promptUuids: new Set() };
  const runs = [];
  for (const file of findSessionFiles(projectsDir, projectFilters)) {
    const { runs: sessionRuns, toolUseOwner } = await parseSession(file, seen);
    if (!sessionRuns.length) continue;
    await attributeSubagents(file, toolUseOwner, seen);
    for (const run of sessionRuns) {
      if (since !== null && run.startTs < since) continue;
      if (until !== null && run.startTs >= until) continue;
      const summary = summarizeRun(run);
      // A run with no model response is a command that never executed.
      if (summary.calls === 0) continue;
      runs.push(summary);
    }
  }
  return runs;
}

/** Nearest-rank percentile of a numeric list; null for an empty list. */
function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function aggregate(runs) {
  const rows = [];
  for (const [workflow, scope] of WORKFLOWS.flatMap(([name]) => [[name, 'standalone'], [name, 'nested']])) {
    const group = runs.filter(
      (run) => run.workflow === workflow && (scope === 'nested') === (run.parent !== null)
    );
    if (scope === 'nested' && !group.length) continue;
    const stat = (pick) => {
      const values = group.map(pick);
      return { median: percentile(values, 0.5), p90: percentile(values, 0.9), max: percentile(values, 1) };
    };
    const totalCost = group.reduce((sum, run) => sum + run.costUsd, 0);
    const subCost = group.reduce((sum, run) => sum + run.subagentCostUsd, 0);
    const dates = group.map((run) => run.start).sort();
    rows.push({
      workflow,
      scope,
      runs: group.length,
      typed: group.filter((run) => run.trigger === 'typed').length,
      modelInvoked: group.filter((run) => run.trigger === 'model').length,
      headless: group.filter((run) => run.entrypoint !== 'cli').length,
      first: dates[0] || null,
      last: dates[dates.length - 1] || null,
      wallSeconds: stat((run) => run.wallSeconds),
      activeSeconds: stat((run) => run.activeSeconds),
      calls: stat((run) => run.calls),
      subagents: stat((run) => run.subagentCount),
      input: stat((run) => run.tokens.input),
      cacheWrite: stat((run) => run.tokens.cacheWrite5m + run.tokens.cacheWrite1h),
      cacheRead: stat((run) => run.tokens.cacheRead),
      output: stat((run) => run.tokens.output),
      costUsd: stat((run) => run.costUsd),
      totalCostUsd: totalCost,
      subagentCostShare: totalCost > 0 ? subCost / totalCost : null,
      unpricedCalls: group.reduce((sum, run) => sum + run.unpricedCalls, 0),
    });
  }
  return rows;
}

/** Result objects of `claude -p --output-format json`, one row per file. */
function readHeadless(paths) {
  const files = [];
  for (const target of paths) {
    const stat = fs.statSync(target);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) {
        if (/\.(json|jsonl)$/.test(name)) files.push(path.join(target, name));
      }
    } else {
      files.push(target);
    }
  }
  const rows = [];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    const candidates = [];
    try {
      const parsed = JSON.parse(text);
      candidates.push(...(Array.isArray(parsed) ? parsed : [parsed]));
    } catch {
      for (const line of text.split('\n')) {
        try {
          candidates.push(JSON.parse(line));
        } catch {
          // not a JSON line
        }
      }
    }
    const results = candidates.filter(
      (value) => value && typeof value === 'object' && typeof value.total_cost_usd === 'number'
    );
    if (!results.length) continue;
    const tokens = emptyTokens();
    for (const result of results) {
      const t = usageTokens(result.usage || {});
      for (const key of Object.keys(t)) tokens[key] += t[key];
    }
    const sum = (pick) => results.reduce((total, result) => total + (pick(result) || 0), 0);
    rows.push({
      label: path.basename(file).replace(/\.(json|jsonl)$/, ''),
      results: results.length,
      errors: results.filter((result) => result.is_error).length,
      turns: sum((result) => result.num_turns),
      durationSeconds: Math.round(sum((result) => result.duration_ms) / 1000),
      tokens,
      costUsd: sum((result) => result.total_cost_usd),
    });
  }
  return rows;
}

function formatTokens(n) {
  if (n === null) return 'n/a';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function formatDuration(seconds) {
  if (seconds === null) return 'n/a';
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(1)} h`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} min`;
  return `${seconds} s`;
}

function formatUsd(n) {
  return n === null ? 'n/a' : `$${n.toFixed(2)}`;
}

function renderMarkdown(rows, headless) {
  const out = [];
  out.push('| Workflow | Runs | Active time (median / p90) | API calls | Subagents | Input | Cache write | Cache read | Output | Cost (median / p90 / max) | Subagent share |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const row of rows) {
    const name = row.scope === 'nested' ? `\`${row.workflow}\` inside another workflow` : `\`${row.workflow}\``;
    if (!row.runs) {
      out.push(`| ${name} | 0 | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |`);
      continue;
    }
    out.push(
      [
        `| ${name}`,
        row.scope === 'nested' ? String(row.runs) : `${row.runs} (${row.typed} typed, ${row.modelInvoked} model)`,
        `${formatDuration(row.activeSeconds.median)} / ${formatDuration(row.activeSeconds.p90)}`,
        row.calls.median,
        row.subagents.median,
        formatTokens(row.input.median),
        formatTokens(row.cacheWrite.median),
        formatTokens(row.cacheRead.median),
        formatTokens(row.output.median),
        `${formatUsd(row.costUsd.median)} / ${formatUsd(row.costUsd.p90)} / ${formatUsd(row.costUsd.max)}`,
        row.subagentCostShare === null ? 'n/a' : `${Math.round(row.subagentCostShare * 100)}%`,
      ].join(' | ') + ' |'
    );
  }
  if (headless.length) {
    out.push('');
    out.push('| Headless run | Results | Errors | Turns | Duration | Input | Cache write | Cache read | Output | Reported cost |');
    out.push('|---|---|---|---|---|---|---|---|---|---|');
    for (const row of headless) {
      out.push(
        [
          `| ${row.label}`,
          row.results,
          row.errors,
          row.turns,
          formatDuration(row.durationSeconds),
          formatTokens(row.tokens.input),
          formatTokens(row.tokens.cacheWrite5m + row.tokens.cacheWrite1h),
          formatTokens(row.tokens.cacheRead),
          formatTokens(row.tokens.output),
          formatUsd(row.costUsd),
        ].join(' | ') + ' |'
      );
    }
  }
  return out.join('\n');
}

function parseDate(value, flag) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(`${flag} needs a YYYY-MM-DD date`);
  return Date.parse(`${value}T00:00:00Z`);
}

function parseArgs(argv) {
  const options = {
    projectsDir: path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'projects'),
    projectFilters: [],
    since: null,
    until: null,
    headless: [],
    json: false,
    runs: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--projects-dir') options.projectsDir = value();
    else if (arg === '--project') options.projectFilters.push(value());
    else if (arg === '--since') options.since = parseDate(value(), arg);
    else if (arg === '--until') options.until = parseDate(value(), arg);
    else if (arg === '--headless') options.headless.push(value());
    else if (arg === '--json') options.json = true;
    else if (arg === '--runs') options.runs = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  return options;
}

async function main(argv) {
  const options = parseArgs(argv);
  const runs = await collectRuns(options);
  const rows = aggregate(runs);
  const headless = readHeadless(options.headless);
  if (options.json) {
    const payload = { workflows: rows, headless };
    if (options.runs) payload.runs = runs;
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${renderMarkdown(rows, headless)}\n`);
  if (options.runs) {
    for (const run of runs) {
      process.stdout.write(
        `${run.workflow}\t${run.start}\t${run.trigger}\t${run.entrypoint}\t${formatDuration(run.activeSeconds)} active of ${formatDuration(run.wallSeconds)}\t${run.calls} calls\t${run.subagentCount} subagents\t${formatUsd(run.costUsd)}\t${run.sessionId}\n`
      );
    }
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`workflow-cost-baseline: ${error.message}\n`);
    process.exit(1);
  });
}

module.exports = {
  aggregate,
  canonicalWorkflow,
  collectRuns,
  humanPrompt,
  percentile,
  readHeadless,
  renderMarkdown,
  usageCost,
};
