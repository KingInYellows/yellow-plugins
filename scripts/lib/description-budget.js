'use strict';

// RULE 23 — description budget, ERROR tier on growth. Every command, agent
// and skill `description:` is loaded into each Claude Code session, so the
// total is a standing context cost. The committed baseline holds one number
// per plugin; a plugin above its number fails until the author raises it in
// the same PR, which makes growth a reviewable diff. A plugin below its
// number only prints a notice, so two PRs that shrink the same plugin cannot
// fail each other. No overall total is stored: it would conflict in every
// parallel PR and is derivable.
//
// Counted: parsed `description` plus `when_to_use`, in characters, for
// markdown at any depth under a plugin's commands/ or agents/ directory and
// for skills/<name>/SKILL.md. Classifying by the directory directly under the
// plugin also drops the generated codex/skills and cursor/skills copies. A
// command or skill with `disable-model-invocation: true` is not listed to the
// model and is skipped; Codex and Cursor still list it.
//
// A counted file the budget cannot measure is an error, never a silent zero:
// malformed YAML is reported by the per-file rules, and a file with no string
// description is reported here. The update flag refuses to write while either
// exists, so a broken file cannot lower the committed number.

const fs = require('fs');
const path = require('path');

const DESCRIPTION_KINDS = new Set(['commands', 'agents', 'skills']);
const UPDATE_DESCRIPTION_BASELINE_FLAG = '--update-description-baseline';
const UPDATE_DESCRIPTION_BASELINE_COMMAND = 'pnpm update:description-baseline';
const UTF8_BOM = '\uFEFF';

function hasLeadingBom(text) {
  return typeof text === 'string' && text.startsWith(UTF8_BOM);
}

function formatBomError(relPath) {
  return (
    `${relPath}: leading UTF-8 BOM (byte-order mark, U+FEFF) prevents ` +
    `frontmatter parsing — save as UTF-8 without BOM`
  );
}

// Fixture runs (VALIDATE_PLUGINS_DIR set) skip the check unless they name
// their own baseline, so a fixture tree is never compared with the real one.
function resolveDescriptionBaselinePath({ rootDir, env = process.env }) {
  if (env.VALIDATE_DESCRIPTION_BASELINE) {
    return path.resolve(env.VALIDATE_DESCRIPTION_BASELINE);
  }
  if (env.VALIDATE_PLUGINS_DIR) return null;
  return path.join(rootDir, 'scripts', 'description-budget-baseline.json');
}

// Classify by the directory directly under the plugin (`commands/`, `agents/`,
// `skills/`), which drops generated `codex/skills` and `cursor/skills` copies
// without excluding real commands such as `commands/cursor/setup.md`.
function classifyBudgetFile(filePath, pluginsDir) {
  const parts = path.relative(pluginsDir, filePath).split(path.sep);
  const [pluginName, kind] = parts;
  if (!pluginName || !DESCRIPTION_KINDS.has(kind)) return null;
  if (kind === 'skills' && (parts.length !== 4 || parts[3] !== 'SKILL.md')) {
    return null;
  }
  return { pluginName, kind };
}

function measureDescriptionFields(data, kind) {
  if (kind !== 'agents' && data['disable-model-invocation'] === true) {
    return { status: 'skip' };
  }
  if (typeof data.description !== 'string' || !data.description) {
    return { status: 'issue', reason: 'missing-description' };
  }
  let chars = data.description.length;
  if (typeof data.when_to_use === 'string') {
    chars += data.when_to_use.length;
  }
  return { status: 'counted', chars };
}

function measureBudgetEntry(
  content,
  kind,
  { extractFrontmatter, parseFrontmatter }
) {
  if (hasLeadingBom(content)) {
    return { status: 'issue', reason: 'bom' };
  }
  const frontmatter = extractFrontmatter(content);
  if (frontmatter === null) {
    return {
      status: 'issue',
      reason: kind === 'agents' ? 'missing-frontmatter' : 'missing-description',
    };
  }
  const data = parseFrontmatter(frontmatter);
  if (!data) {
    return { status: 'issue', reason: 'malformed' };
  }
  return measureDescriptionFields(data, kind);
}

function collectDescriptionBudget({
  pluginsDir,
  pluginNames,
  files,
  extractFrontmatter,
  parseFrontmatter,
  readFile = (filePath) => fs.readFileSync(filePath, 'utf8'),
}) {
  // No prototype, so a directory named `__proto__` is an ordinary key.
  const plugins = Object.create(null);
  for (const name of [...pluginNames].sort()) plugins[name] = 0;
  const kinds = { commands: 0, agents: 0, skills: 0 };
  const perFile = Object.create(null);
  const issues = [];

  // A Set: caller file lists overlap for a path that has both a commands/ and
  // an agents/ segment, and each file counts once under its top-level kind.
  for (const filePath of new Set(files)) {
    const classified = classifyBudgetFile(filePath, pluginsDir);
    if (!classified) continue;
    const { pluginName, kind } = classified;
    if (!Object.prototype.hasOwnProperty.call(plugins, pluginName)) continue;

    const content = readFile(filePath);
    const entry = measureBudgetEntry(content, kind, {
      extractFrontmatter,
      parseFrontmatter,
    });
    if (entry.status === 'skip') continue;
    if (entry.status === 'issue') {
      issues.push({ filePath, kind, reason: entry.reason });
      continue;
    }

    plugins[pluginName] += entry.chars;
    kinds[kind] += entry.chars;
    (perFile[pluginName] ||= []).push({ filePath, chars: entry.chars });
  }

  return { plugins, kinds, perFile, issues };
}

function formatBudgetIssue(issue, formatPath) {
  const relPath = formatPath(issue.filePath);
  switch (issue.reason) {
    case 'bom':
      return formatBomError(relPath);
    case 'malformed':
      return `${relPath}: malformed YAML frontmatter`;
    case 'missing-frontmatter':
      return `${relPath}: no YAML frontmatter`;
    case 'missing-description':
    default:
      return (
        `RULE 23 — ${relPath}: no string \`description:\` in the ` +
        `frontmatter. Claude Code may list its first body text instead, which ` +
        `the budget cannot count; add a description.`
      );
  }
}

function readDescriptionBaseline(baselinePath, formatPath) {
  let baseline;
  try {
    baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  } catch (e) {
    return {
      ok: false,
      error:
        `RULE 23 — cannot read the description baseline ` +
        `${formatPath(baselinePath)} (${e.code || e.name}); run ` +
        `\`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\`.`,
    };
  }
  const entries = baseline && baseline.plugins;
  if (
    !entries ||
    baseline.unit !== 'chars' ||
    typeof entries !== 'object' ||
    Array.isArray(entries)
  ) {
    return {
      ok: false,
      error:
        `RULE 23 — ${formatPath(baselinePath)} must have \`"unit": "chars"\` ` +
        `and a \`plugins\` object; run \`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\`.`,
    };
  }
  return { ok: true, entries };
}

function largestDescriptions(entries = [], formatPath) {
  return [...entries]
    .sort((a, b) => b.chars - a.chars)
    .slice(0, 3)
    .map(({ filePath, chars }) => `${formatPath(filePath)} (${chars})`)
    .join(', ');
}

function checkPluginBudget(
  name,
  budget,
  entries,
  { formatPath, errors, notices }
) {
  const current = budget.plugins[name];
  const hasEntry = Object.prototype.hasOwnProperty.call(entries, name);
  if (hasEntry && !(Number.isInteger(entries[name]) && entries[name] >= 0)) {
    errors.push(
      `RULE 23 — ${name}: baseline entry must be a non-negative integer; ` +
        `run \`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\`.`
    );
    return;
  }
  const allowed = hasEntry ? entries[name] : 0;
  if (current > allowed) {
    errors.push(
      `RULE 23 — ${name}: description total ${current} chars is over its ` +
        `baseline ${allowed} (+${current - allowed}). Shorten the ` +
        `descriptions, or run \`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\` ` +
        `and commit the baseline so the growth is reviewed. Largest: ` +
        `${largestDescriptions(budget.perFile[name], formatPath)}.`
    );
  } else if (current < allowed) {
    notices.push(
      `[RULE 23 notice] ${name}: description total ${current} chars is ` +
        `under its baseline ${allowed} (-${allowed - current}); run ` +
        `\`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\` to lower it.`
    );
  }
}

function checkDescriptionBudget(
  budget,
  baselinePath,
  { formatPath, errors, notices }
) {
  const loaded = readDescriptionBaseline(baselinePath, formatPath);
  if (!loaded.ok) {
    errors.push(loaded.error);
    return;
  }
  const { entries } = loaded;

  for (const name of Object.keys(budget.plugins)) {
    checkPluginBudget(name, budget, entries, { formatPath, errors, notices });
  }

  // BOM, malformed YAML, and agent missing-frontmatter issues are already
  // reported once by the per-file passes; only undescribed files belong here.
  for (const issue of budget.issues) {
    if (issue.reason === 'missing-description') {
      errors.push(formatBudgetIssue(issue, formatPath));
    }
  }

  for (const name of Object.keys(entries).sort()) {
    if (!Object.prototype.hasOwnProperty.call(budget.plugins, name)) {
      notices.push(
        `[RULE 23 notice] baseline entry "${name}" has no plugin directory; ` +
          `run \`${UPDATE_DESCRIPTION_BASELINE_COMMAND}\` to drop it.`
      );
    }
  }
}

// Temp file then rename, so an interrupted run cannot leave a truncated
// baseline that the next run reports as unreadable.
function writeDescriptionBaseline(budget, baselinePath) {
  const tmpPath = `${baselinePath}.${process.pid}.tmp`;
  fs.writeFileSync(
    tmpPath,
    `${JSON.stringify({ unit: 'chars', plugins: budget.plugins }, null, 2)}\n`
  );
  fs.renameSync(tmpPath, baselinePath);
}

function describeDescriptionBudget(budget) {
  const { commands, agents, skills } = budget.kinds;
  return (
    `Description budget: ${commands + agents + skills} chars ` +
    `(commands ${commands}, agents ${agents}, skills ${skills})`
  );
}

function updateDescriptionBaseline({
  budget,
  baselinePath,
  formatPath,
  logError,
  logSuccess,
}) {
  if (!baselinePath) {
    logError(
      `${UPDATE_DESCRIPTION_BASELINE_FLAG} needs VALIDATE_DESCRIPTION_BASELINE ` +
        `when VALIDATE_PLUGINS_DIR is set`
    );
    return false;
  }
  if (budget.issues.length > 0) {
    for (const issue of budget.issues) {
      logError(formatBudgetIssue(issue, formatPath));
    }
    logError('Baseline not written: fix the files above first.');
    return false;
  }
  try {
    writeDescriptionBaseline(budget, baselinePath);
  } catch (e) {
    logError(`cannot write ${formatPath(baselinePath)} (${e.code || e.name})`);
    return false;
  }
  logSuccess(
    `Wrote ${formatPath(baselinePath)} — ${describeDescriptionBudget(budget)}`
  );
  return true;
}

module.exports = {
  UPDATE_DESCRIPTION_BASELINE_FLAG,
  checkDescriptionBudget,
  collectDescriptionBudget,
  describeDescriptionBudget,
  formatBomError,
  hasLeadingBom,
  resolveDescriptionBaselinePath,
  updateDescriptionBaseline,
};
