#!/usr/bin/env node
'use strict';

const { readFileSync } = require('fs');
const { join, resolve } = require('path');

const DEFAULT_NODE_RANGE = '>=22.22.0 <25.0.0';

function parseVersion(version) {
  const cleanVersion = String(version).trim().replace(/^v/, '');
  const match = cleanVersion.match(/^(\d+)\.(\d+)\.(\d+)/);

  if (!match) {
    throw new Error(`Invalid semantic version: "${version}"`);
  }

  return match.slice(1).map((segment) => Number(segment));
}

function compareVersions(left, right) {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }

  return 0;
}

function parseComparators(range) {
  return String(range)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((comparator) => {
      const match = comparator.match(/^(>=|<=|>|<|=)?(.+)$/);

      if (!match) {
        throw new Error(`Unsupported comparator: "${comparator}"`);
      }

      return {
        operator: match[1] || '=',
        version: match[2],
      };
    });
}

function satisfiesVersionRange(version, range) {
  return parseComparators(range).every(({ operator, version: candidate }) => {
    const comparison = compareVersions(version, candidate);

    switch (operator) {
      case '>':
        return comparison > 0;
      case '>=':
        return comparison >= 0;
      case '<':
        return comparison < 0;
      case '<=':
        return comparison <= 0;
      case '=':
        return comparison === 0;
      default:
        throw new Error(`Unsupported operator: "${operator}"`);
    }
  });
}

function readRequiredNodeRange(projectRoot) {
  const packageJsonPath = join(projectRoot, 'package.json');
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

  return packageJson.engines?.node || DEFAULT_NODE_RANGE;
}

function checkNodeVersion(options = {}) {
  const projectRoot = options.projectRoot || resolve(__dirname, '..');
  const currentVersion = options.currentVersion || process.version;
  const requiredRange =
    options.requiredRange || readRequiredNodeRange(projectRoot);

  try {
    const ok = satisfiesVersionRange(currentVersion, requiredRange);

    return {
      ok,
      currentVersion: String(currentVersion).replace(/^v/, ''),
      requiredRange,
      message: ok
        ? `Node.js ${currentVersion} satisfies ${requiredRange}`
        : `Node.js ${currentVersion} does not satisfy ${requiredRange}. Install Node.js 22.22.0 or later (but below 25.0.0).`,
    };
  } catch (error) {
    return {
      ok: false,
      currentVersion: String(currentVersion).replace(/^v/, ''),
      requiredRange,
      message:
        error instanceof Error
          ? error.message
          : `Failed to validate Node.js version: ${String(error)}`,
    };
  }
}

if (require.main === module) {
  const quiet = process.argv.includes('--quiet');
  const result = checkNodeVersion();

  if (!result.ok) {
    console.error(
      `[check-node-version] Unsupported Node.js version: ${result.currentVersion}`
    );
    console.error(`[check-node-version] Required: ${result.requiredRange}`);
    console.error(
      '[check-node-version] Install Node.js 22.22.0 or later (but below 25.0.0), then retry.'
    );
    process.exit(1);
  }

  if (!quiet) {
    console.log(
      `[check-node-version] Node.js ${result.currentVersion} satisfies ${result.requiredRange}`
    );
  }
}

module.exports = {
  checkNodeVersion,
  compareVersions,
  parseVersion,
  satisfiesVersionRange,
};
