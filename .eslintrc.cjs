/**
 * ESLint configuration for yellow-plugins workspace
 * Part of Task I1.T1: Bootstrap pnpm workspace
 *
 * Enforces:
 * - Strict TypeScript rules
 * - Layered architecture import rules (domain -> infrastructure -> cli)
 * - Code quality and consistency
 */

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'import'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:import/recommended',
    'plugin:import/typescript',
    'prettier',
  ],
  rules: {
    // TypeScript specific rules
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': [
      'warn',
      {
        allowExpressions: true,
        allowTypedFunctionExpressions: true,
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'error',
      {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
      },
    ],

    // Import/Export rules
    'import/order': [
      'error',
      {
        groups: [
          'builtin',
          'external',
          'internal',
          'parent',
          'sibling',
          'index',
        ],
        'newlines-between': 'always',
        alphabetize: {
          order: 'asc',
          caseInsensitive: true,
        },
      },
    ],
    'import/no-cycle': 'error',
    'import/no-self-import': 'error',
    // Disable import/no-unresolved since TypeScript handles module resolution
    'import/no-unresolved': 'off',

    // General code quality
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'no-debugger': 'error',
    'no-alert': 'error',
    'prefer-const': 'error',
    'no-var': 'error',
  },
  overrides: [
    {
      // Layered architecture enforcement
      files: ['packages/domain/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              {
                target: './packages/domain',
                from: './packages/infrastructure',
                message: 'Domain layer cannot import from infrastructure layer',
              },
              {
                target: './packages/domain',
                from: './packages/cli',
                message: 'Domain layer cannot import from CLI layer',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['packages/infrastructure/**/*.ts'],
      rules: {
        'import/no-restricted-paths': [
          'error',
          {
            zones: [
              {
                target: './packages/infrastructure',
                from: './packages/cli',
                message: 'Infrastructure layer cannot import from CLI layer',
              },
            ],
          },
        ],
      },
    },
    {
      // Test files
      files: ['**/*.test.ts', '**/*.spec.ts'],
      rules: {
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/no-non-null-assertion': 'off',
      },
    },
    {
      // Scripts can use console and don't need type checking
      files: ['scripts/**/*.js'],
      extends: ['eslint:recommended'],
      parser: 'espree',
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'commonjs',
      },
      rules: {
        'no-console': 'off',
        '@typescript-eslint/no-var-requires': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/explicit-function-return-type': 'off',
        '@typescript-eslint/no-unused-vars': 'off',
      },
    },
    {
      // CLI can use console for output
      files: ['packages/cli/src/index.ts'],
      rules: {
        'no-console': 'off',
      },
    },
  ],
  settings: {
    'import/resolver': {
      node: {
        extensions: ['.js', '.jsx', '.ts', '.tsx'],
      },
    },
  },
  ignorePatterns: [
    'node_modules',
    'dist',
    'coverage',
    '*.config.js',
    '*.config.ts',
    'serena',
    '.codemachine',
  ],
};
