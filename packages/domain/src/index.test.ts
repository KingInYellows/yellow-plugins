import { describe, expect, it } from 'vitest';

import { version } from './index';

describe('@yellow-plugins/domain package metadata', () => {
  it('exposes the semantic version', () => {
    expect(version).toBe('1.1.0');
  });
});
