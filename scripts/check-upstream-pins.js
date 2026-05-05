#!/usr/bin/env node
/**
 * check-upstream-pins.js
 *
 * Scans all plugins/*.claude-plugin/plugin.json files for pinned external
 * packages (npx -y <pkg>@<version>) and compares each pin against the
 * `latest` tag on the npm registry. Prints a drift report; exits 0 if no
 * drift exceeds the threshold, exits 1 otherwise.
 *
 * Usage:
 *   node scripts/check-upstream-pins.js                   # advisory (all drift reported, exit 0 unless --strict)
 *   node scripts/check-upstream-pins.js --strict          # exit 1 on any drift
 *   node scripts/check-upstream-pins.js --threshold 10    # exit 1 only when major+minor drift >= 10 versions
 *
 * The git-SHA-pinned entries (uvx --from git+...@<sha>) are listed but not
 * drift-checked, since resolving latest for a git repo requires extra API
 * calls and is out of scope for a quick check.
 */

'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

// Allowlist for npm package names: scope + name chars per npm-name-validator,
// length capped at the registry's documented 214-char limit.
const NPM_NAME_OK = /^(?:@[a-z0-9][a-z0-9._~-]{0,213}\/)?[a-z0-9][a-z0-9._~-]{0,213}$/i;

const ROOT = path.resolve(__dirname, '..');
const PLUGINS_DIR = path.join(ROOT, 'plugins');

function parseArgs(argv) {
  const args = { strict: false, threshold: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--strict') args.strict = true;
    else if (a === '--threshold') args.threshold = parseInt(argv[++i], 10);
  }
  return args;
}

function listPlugins() {
  return fs
    .readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-zA-Z0-9_-]+$/.test(d.name))
    .map((d) => d.name);
}

// Extract pinned npm packages from an args array like ["-y", "@scope/pkg@1.2.3"].
function extractNpmPins(args) {
  const pins = [];
  if (!Array.isArray(args)) return pins;
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    // Match @scope/pkg@1.2.3 or pkg@1.2.3 at start of arg (not tools= arg)
    const m = arg.match(/^(@?[a-z0-9][a-z0-9._~/-]+)@(\d+\.\d+\.\d+[A-Za-z0-9.+-]*)$/);
    if (m) pins.push({ name: m[1], version: m[2] });
  }
  return pins;
}

// Extract git-SHA pins from uvx --from git+https://...@<sha>.
function extractGitPins(args) {
  const pins = [];
  if (!Array.isArray(args)) return pins;
  for (const arg of args) {
    if (typeof arg !== 'string') continue;
    const m = arg.match(/^git\+([^@]+)@([0-9a-f]{7,40})$/);
    if (m) pins.push({ url: m[1], sha: m[2] });
  }
  return pins;
}

function walkMcpServers(pluginJson, fn) {
  const servers = pluginJson?.mcpServers;
  if (!servers || typeof servers !== 'object') return;
  for (const [name, server] of Object.entries(servers)) {
    fn(name, server);
  }
}

function getNpmLatest(pkg) {
  // Reject names that do not match the npm allowlist — prevents the name
  // becoming a shell-injection vector if a plugin.json or package.json is
  // ever crafted maliciously. execFileSync below avoids shell parsing, but
  // belt-and-suspenders is cheap here.
  if (typeof pkg !== 'string' || !NPM_NAME_OK.test(pkg)) return null;
  try {
    const out = execFileSync('npm', ['view', pkg, 'version', '--silent'], {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

// Lexicographic semver drift score: compares major, minor, patch independently.
// Returns positive when latest is newer, negative when pinned is ahead, 0 when equal.
// Each component is weighted separately so large patch numbers (e.g. 165) do not
// overflow into the minor component weight.
function driftScore(pinned, latest) {
  const parse = (v) => v.split('.').map((s) => parseInt(s, 10) || 0);
  const [pM, pm, pp] = parse(pinned);
  const [lM, lm, lp] = parse(latest);
  if (lM !== pM) return (lM - pM) * 1000000;
  if (lm !== pm) return (lm - pm) * 1000;
  return lp - pp;
}

function main() {
  const args = parseArgs(process.argv);
  const plugins = listPlugins();
  const report = { npm: [], git: [] };

  for (const plugin of plugins) {
    const manifestPath = path.join(PLUGINS_DIR, plugin, '.claude-plugin', 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;

    let json;
    try {
      json = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      console.error(`[check-upstream-pins] SKIP: cannot parse ${manifestPath}: ${e.message}`);
      continue;
    }

    walkMcpServers(json, (serverName, server) => {
      const npmPins = extractNpmPins(server.args);
      const gitPins = extractGitPins(server.args);
      for (const p of npmPins) {
        report.npm.push({ plugin, serverName, ...p });
      }
      for (const p of gitPins) {
        report.git.push({ plugin, serverName, ...p });
      }
    });

    // Also scan plugins/<name>/package.json dependencies — the wrapper-based
    // install pattern (yellow-morph 1.1.0+) pins versions here instead of in
    // mcpServers.args. Only consider exact pins (no ^ or ~), mirroring the
    // "pin exact" policy.
    const pkgPath = path.join(PLUGINS_DIR, plugin, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        for (const [name, rawVersion] of Object.entries(deps)) {
          if (typeof rawVersion !== 'string') continue;
          // Skip ^X.Y.Z / ~X.Y.Z / workspace: / file: / git+ — we want exact only
          if (!/^\d+\.\d+\.\d+[A-Za-z0-9.+-]*$/.test(rawVersion)) continue;
          if (!NPM_NAME_OK.test(name)) continue;
          report.npm.push({ plugin, serverName: '(package.json)', name, version: rawVersion });
        }
      } catch {
        // Tolerate unparseable package.json — surface as a skipped note.
        console.error(`[check-upstream-pins] NOTE: cannot parse ${pkgPath}`);
      }
    }
  }

  console.log('=== Upstream pin drift report ===\n');

  let driftCount = 0;
  let maxDrift = 0;
  console.log('-- npm pins --');
  for (const pin of report.npm) {
    const latest = getNpmLatest(pin.name);
    if (!latest) {
      console.log(`  ${pin.plugin} / ${pin.serverName} :: ${pin.name}@${pin.version} -> (npm lookup failed)`);
      continue;
    }
    const drift = driftScore(pin.version, latest);
    const marker = drift > 0 ? 'DRIFT' : 'current';
    console.log(`  ${pin.plugin} / ${pin.serverName} :: ${pin.name}@${pin.version} -> latest ${latest} [${marker}${drift ? ` +${drift}` : ''}]`);
    if (drift > 0) {
      driftCount++;
      if (drift > maxDrift) maxDrift = drift;
    }
  }

  if (report.git.length) {
    console.log('\n-- git SHA pins (not drift-checked) --');
    for (const pin of report.git) {
      console.log(`  ${pin.plugin} / ${pin.serverName} :: ${pin.url}@${pin.sha}`);
    }
  }

  console.log(`\nTotal npm pins: ${report.npm.length}, drift entries: ${driftCount}, max drift score: ${maxDrift}`);

  let exitCode = 0;
  if (args.strict && driftCount > 0) exitCode = 1;
  else if (args.threshold !== null && maxDrift >= args.threshold) exitCode = 1;

  process.exit(exitCode);
}

main();
