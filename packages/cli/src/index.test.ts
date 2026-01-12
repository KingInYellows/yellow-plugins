import { describe, expect, it } from 'vitest';

import { getCliBanner, version } from './index';

describe('@yellow-plugins/cli package metadata', () => {
  it('exposes the semantic version', () => {
    expect(version).toBe('1.1.0');
  });

  it('returns the CLI banner without side effects', () => {
    expect(getCliBanner()).toEqual([
      'Yellow Plugins CLI v1.1.0',
      'Plugin marketplace for Claude Code',
      '',
      'Setup complete. CLI commands will be implemented in future iterations.',
    ]);
  });
});
