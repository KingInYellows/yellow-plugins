import { resolve } from 'path';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@yellow-plugins/cli': resolve(__dirname, 'packages/cli/src/index.ts'),
      '@yellow-plugins/domain': resolve(
        __dirname,
        'packages/domain/src/index.ts'
      ),
      '@yellow-plugins/infrastructure': resolve(
        __dirname,
        'packages/infrastructure/src/index.ts'
      ),
    },
  },
  test: {
    passWithNoTests: true,
  },
});
