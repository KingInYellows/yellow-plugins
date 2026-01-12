import { describe, expect, it } from 'vitest';

import { getCliBanner, version } from './index';

describe('@yellow-plugins/cli package metadata', () => {
  it('exposes the semantic version', () => {
    expect(version).toBe('1.1.0');
  });

  it('returns the CLI banner without side effects', () => {
    const banner = getCliBanner();

    // Verify it's an array with the expected structure
    expect(banner).toBeInstanceOf(Array);
    expect(banner.length).toBeGreaterThan(0);

    // Check for key sections
    expect(banner[0]).toBe('Yellow Plugins CLI v1.1.0');
    expect(banner[1]).toBe('Plugin marketplace for Claude Code');

    // Verify it includes configuration and feature flag sections
    const text = banner.join('\n');
    expect(text).toContain('Configuration:');
    expect(text).toContain('Feature Flags:');
    expect(text).toContain('Plugin directory:');
    expect(text).toContain('Compatibility checks:');
  });
});
