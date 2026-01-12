#!/usr/bin/env node
/**
 * test.cjs - Test execution script
 *
 * This script ensures dependencies are installed and then runs the project tests.
 * For this monorepo, it executes tests across all workspace packages.
 *
 * Project type: Node.js/TypeScript with Vitest
 * Test runner: Vitest (configured in package.json)
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

/**
 * Logs a message with color support
 * @param {string} level - The log level (info, success, warn, error)
 * @param {string} message - The message to log
 */
function log(level, message) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [test.cjs]`;

  switch (level) {
    case 'success':
      console.log(`${colors.green}✓ ${prefix} ${message}${colors.reset}`);
      break;
    case 'info':
      console.log(`${colors.blue}ℹ ${prefix} ${message}${colors.reset}`);
      break;
    case 'warn':
      console.log(`${colors.yellow}⚠ ${prefix} ${message}${colors.reset}`);
      break;
    case 'error':
      console.error(`${colors.red}✗ ${prefix} ${message}${colors.reset}`);
      break;
    default:
      console.log(`${prefix} ${message}`);
  }
}

/**
 * Main test execution function
 */
function main() {
  log('info', 'Starting test execution...');

  const rootDir = path.resolve(__dirname, '..');
  const installScript = path.join(__dirname, 'install.cjs');

  // Step 1: Verify install script exists
  if (!fs.existsSync(installScript)) {
    log('error', 'install.cjs not found in tools directory');
    process.exit(1);
  }

  // Step 2: Ensure dependencies are installed
  log('info', 'Ensuring dependencies are installed...');
  try {
    execSync('node tools/install.cjs', { stdio: 'inherit', cwd: rootDir });
    log('success', 'Dependencies verified');
  } catch (error) {
    log('error', 'Failed to install dependencies');
    process.exit(1);
  }

  // Step 3: Read package.json to determine test strategy
  const packageJsonPath = path.join(rootDir, 'package.json');
  let packageJson;

  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    log('error', `Failed to read package.json: ${error.message}`);
    process.exit(1);
  }

  // Step 4: Check if test script exists
  if (!packageJson.scripts || !packageJson.scripts.test) {
    log('warn', 'No test script found in package.json');
    log('info', 'Skipping tests (no test configuration)');
    process.exit(0);
  }

  // Step 5: Verify test runner is installed
  const vitestPath = path.join(rootDir, 'node_modules', '.bin', 'vitest');
  const vitestExists = fs.existsSync(vitestPath) ||
                       fs.existsSync(vitestPath + '.cmd') ||
                       fs.existsSync(vitestPath + '.ps1');

  if (!vitestExists) {
    log('warn', 'Vitest not found in node_modules');
    log('info', 'Tests may not be configured yet');
  }

  // Step 6: Parse command line arguments
  // Allow passing additional test arguments (e.g., --watch, --coverage)
  const args = process.argv.slice(2);
  const testArgs = args.length > 0 ? ' ' + args.join(' ') : '';

  // Step 7: Execute tests
  // Use pnpm to run tests across all workspace packages
  const testCommand = `pnpm run test${testArgs}`;

  log('info', `Running tests with command: ${testCommand}`);

  try {
    execSync(testCommand, {
      stdio: 'inherit',
      cwd: rootDir,
      encoding: 'utf8'
    });
    log('success', 'All tests passed');
    process.exit(0);
  } catch (error) {
    log('error', 'Tests failed');
    // Exit with the same code as the test runner
    process.exit(error.status || 1);
  }
}

// Execute main function
try {
  main();
} catch (error) {
  log('error', `Unexpected error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
