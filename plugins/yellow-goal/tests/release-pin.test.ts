/**
 * Release-pin provenance drift gate: the runtime constants in src/pin.ts
 * and the shell-side public-artifact gate (scripts/verify-goal-release.sh,
 * which hashes the asset before installing it) must name the same
 * released engine version, asset URL and SHA-256.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  PINNED_ENGINE_ASSET_NAME,
  PINNED_ENGINE_ASSET_SHA256,
  PINNED_ENGINE_ASSET_URL,
  PINNED_ENGINE_COMMIT,
  PINNED_ENGINE_TAG,
  PINNED_ENGINE_VERSION,
} from '../src/pin.js';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..'
);
const verifier = readFileSync(
  path.join(repoRoot, 'scripts', 'verify-goal-release.sh'),
  'utf8'
);

function shellConstant(name: string): string {
  const match = verifier.match(new RegExp(`^${name}="([^"]+)"$`, 'm'));
  if (match?.[1] === undefined) {
    throw new Error(
      `${name} is not declared in scripts/verify-goal-release.sh`
    );
  }
  return match[1];
}

describe('released engine pin provenance', () => {
  it('is internally consistent', () => {
    expect(PINNED_ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(PINNED_ENGINE_TAG).toBe(`v${PINNED_ENGINE_VERSION}`);
    expect(PINNED_ENGINE_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(PINNED_ENGINE_ASSET_NAME).toBe(
      `goal-gen-${PINNED_ENGINE_VERSION}.tgz`
    );
    expect(PINNED_ENGINE_ASSET_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(PINNED_ENGINE_ASSET_URL).toBe(
      `https://github.com/KingInYellows/yellow-goal/releases/download/${PINNED_ENGINE_TAG}/${PINNED_ENGINE_ASSET_NAME}`
    );
  });

  it('agrees with the blocking public-artifact gate script', () => {
    expect(shellConstant('PINNED_ENGINE_VERSION')).toBe(PINNED_ENGINE_VERSION);
    expect(shellConstant('PINNED_ENGINE_ASSET_URL')).toBe(
      PINNED_ENGINE_ASSET_URL
    );
    expect(shellConstant('PINNED_ENGINE_ASSET_SHA256')).toBe(
      PINNED_ENGINE_ASSET_SHA256
    );
  });

  it('verifies the asset hash before installing it', () => {
    const hashIndex = verifier.indexOf('actual_sha="$(sha256_of "$asset")"');
    expect(verifier).toContain('sha256sum "$1"');
    expect(verifier).toContain('shasum -a 256 "$1"');
    const compareIndex = verifier.indexOf(
      '"$actual_sha" != "$PINNED_ENGINE_ASSET_SHA256"'
    );
    const exitIndex = verifier.indexOf('exit 1', compareIndex);
    const installIndex = verifier.indexOf('npm install');
    expect(hashIndex).toBeGreaterThan(-1);
    expect(compareIndex).toBeGreaterThan(hashIndex);
    expect(exitIndex).toBeGreaterThan(compareIndex);
    expect(installIndex).toBeGreaterThan(exitIndex);
    expect(verifier).toContain('--ignore-scripts');
  });
});
