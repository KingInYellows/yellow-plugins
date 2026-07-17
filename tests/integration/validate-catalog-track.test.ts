/**
 * Unit tests for the pure comparison core of the Q3 catalog-track guard
 * (R13). No live git fixtures — the git shell path is exercised by
 * `pnpm release:check` at HEAD, which must exit 0.
 */

import { describe, it, expect } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { computeTrackViolations } = require('../../scripts/validate-catalog-track.js');

describe('computeTrackViolations', () => {
  it('returns no violations when nothing changed', () => {
    expect(
      computeTrackViolations({
        pluginVersionsAtTag: { 'yellow-core': '1.24.5', 'gt-workflow': '1.5.4' },
        pluginVersionsAtHead: { 'yellow-core': '1.24.5', 'gt-workflow': '1.5.4' },
        rootVersionAtTag: '2.0.4',
        rootVersionAtHead: '2.0.4',
      })
    ).toEqual([]);
  });

  it('returns no violations when the root version advanced, even with plugin changes', () => {
    expect(
      computeTrackViolations({
        pluginVersionsAtTag: { 'yellow-core': '1.24.5' },
        pluginVersionsAtHead: { 'yellow-core': '1.25.0', 'brand-new': '0.1.0' },
        rootVersionAtTag: '2.0.4',
        rootVersionAtHead: '2.0.5',
      })
    ).toEqual([]);
  });

  it('flags a plugin version change when the root did not advance', () => {
    const violations = computeTrackViolations({
      pluginVersionsAtTag: { 'yellow-core': '1.24.5' },
      pluginVersionsAtHead: { 'yellow-core': '1.25.0' },
      rootVersionAtTag: '2.0.4',
      rootVersionAtHead: '2.0.4',
    });
    expect(violations).toEqual([
      'plugin "yellow-core" changed 1.24.5 -> 1.25.0 since catalog tag v2.0.4 ' +
        'but the root package.json version did not advance',
    ]);
  });

  it('flags an added plugin when the root did not advance', () => {
    const violations = computeTrackViolations({
      pluginVersionsAtTag: {},
      pluginVersionsAtHead: { 'brand-new': '0.1.0' },
      rootVersionAtTag: '2.0.4',
      rootVersionAtHead: '2.0.4',
    });
    expect(violations).toEqual([
      'plugin "brand-new" (0.1.0) was added since catalog tag v2.0.4 ' +
        'but the root package.json version did not advance',
    ]);
  });

  it('flags a removed plugin when the root did not advance', () => {
    const violations = computeTrackViolations({
      pluginVersionsAtTag: { retired: '3.0.0' },
      pluginVersionsAtHead: {},
      rootVersionAtTag: '2.0.4',
      rootVersionAtHead: '2.0.4',
    });
    expect(violations).toEqual([
      'plugin "retired" (3.0.0) was removed since catalog tag v2.0.4 ' +
        'but the root package.json version did not advance',
    ]);
  });

  it('reports multiple violations sorted by plugin name', () => {
    const violations = computeTrackViolations({
      pluginVersionsAtTag: { zeta: '1.0.0', alpha: '1.0.0' },
      pluginVersionsAtHead: { zeta: '1.0.1', alpha: '1.1.0' },
      rootVersionAtTag: '2.0.4',
      rootVersionAtHead: '2.0.4',
    });
    expect(violations).toHaveLength(2);
    expect(violations[0]).toContain('"alpha"');
    expect(violations[1]).toContain('"zeta"');
  });
});
