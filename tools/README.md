# Automation Scripts

This directory contains cross-platform Node.js automation scripts for the yellow-plugins project. These scripts provide a consistent interface for common development tasks.

## Scripts Overview

All scripts are written as CommonJS modules (`.cjs` extension) and are designed to be:
- **Cross-platform compatible** (Windows, macOS, Linux)
- **Idempotent** (safe to run multiple times)
- **Robust** (proper error handling and exit codes)
- **Informative** (colored console output with timestamps)

## Available Scripts

### 1. `install.cjs` - Environment Setup and Dependency Installation

**Purpose:** Ensures the development environment is properly configured and all dependencies are installed.

**Usage:**
```bash
node tools/install.cjs
```

**Features:**
- Detects and validates Node.js version (>=18.0.0 <=24.x)
- Detects and validates pnpm version (>=8.0.0)
- Installs or updates all project dependencies using pnpm
- Verifies workspace packages are properly configured
- Idempotent: safe to run multiple times

**Exit Codes:**
- `0` - Success (all dependencies installed/verified)
- `1` - Failure (missing requirements or installation error)

---

### 2. `run.cjs` - Project Execution

**Purpose:** Builds and runs the project.

**Usage:**
```bash
# Build all packages
node tools/run.cjs

# Build and run CLI with arguments
node tools/run.cjs --help
node tools/run.cjs install plugin-name
```

**Features:**
- Automatically runs `install.cjs` to ensure dependencies are ready
- Builds all TypeScript packages in the monorepo
- Can execute the CLI package with optional arguments

**Exit Codes:**
- `0` - Success (build completed)
- `1` - Failure (installation or build error)

---

### 3. `lint.cjs` - Code Linting

**Purpose:** Lints the project source code and outputs results in JSON format.

**Usage:**
```bash
node tools/lint.cjs
```

**Features:**
- Automatically runs `install.cjs` silently to ensure ESLint is installed
- Uses project's ESLint configuration (`.eslintrc.cjs`)
- Outputs exclusively JSON to stdout (errors only, warnings suppressed)
- All diagnostic messages go to stderr
- Reports only syntax errors and critical warnings

**Output Format:**
```json
[
  {
    "type": "no-console",
    "path": "packages/cli/src/index.ts",
    "obj": "no-console",
    "message": "Unexpected console statement.",
    "line": 42,
    "column": 5
  }
]
```

**Exit Codes:**
- `0` - Success (no linting errors found)
- `1` - Failure (linting errors found or execution error)

**Note:** Only errors (severity 2) are reported. Warnings are suppressed.

---

### 4. `test.cjs` - Test Execution

**Purpose:** Runs all project tests across workspace packages.

**Usage:**
```bash
# Run all tests
node tools/test.cjs

# Run tests with additional arguments
node tools/test.cjs --watch
node tools/test.cjs --coverage
```

**Features:**
- Automatically runs `install.cjs` to ensure test dependencies are installed
- Executes tests using Vitest across all workspace packages
- Supports passing additional test runner arguments

**Exit Codes:**
- `0` - Success (all tests passed)
- `1` - Failure (tests failed or no tests found)

---

## Integration with Project

These scripts are designed to be used:

1. **Directly via Node.js:**
   ```bash
   node tools/install.cjs
   node tools/run.cjs
   node tools/lint.cjs
   node tools/test.cjs
   ```

2. **In package.json scripts:**
   ```json
   {
     "scripts": {
       "setup": "node tools/install.cjs",
       "dev": "node tools/run.cjs",
       "lint:json": "node tools/lint.cjs",
       "test:ci": "node tools/test.cjs"
     }
   }
   ```

3. **In CI/CD pipelines:**
   ```yaml
   - name: Install dependencies
     run: node tools/install.cjs

   - name: Lint code
     run: node tools/lint.cjs

   - name: Run tests
     run: node tools/test.cjs

   - name: Build project
     run: node tools/run.cjs
   ```

## Requirements

- **Node.js**: >=18.0.0 <=24.x
- **pnpm**: >=8.0.0 (must be installed globally)

To install pnpm:
```bash
npm install -g pnpm
```

## Troubleshooting

### pnpm not found
**Error:** `pnpm is not installed or not in PATH`

**Solution:**
```bash
npm install -g pnpm
# Or visit: https://pnpm.io/installation
```

### ESLint not found
**Error:** `ESLint not found in node_modules`

**Solution:**
```bash
node tools/install.cjs  # Reinstall dependencies
```

### Tests not running
**Error:** `No test script found in package.json`

**Solution:** Ensure your packages have test scripts configured with Vitest.

## Design Philosophy

These scripts follow the **RuntimeScriptGenerator_v2.1** protocol and are designed to:

1. **Be self-contained**: Each script can be run independently
2. **Chain properly**: Scripts call `install.cjs` when needed
3. **Fail fast**: Clear error messages and appropriate exit codes
4. **Be transparent**: Colored output with timestamps for easy debugging
5. **Follow conventions**: Work with standard project structures and tools

## Contributing

When modifying these scripts:
- Maintain cross-platform compatibility
- Preserve idempotency for install script
- Keep JSON output clean for lint script (only stdout)
- Include proper error handling and exit codes
- Update this README if adding new features
