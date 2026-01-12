#!/usr/bin/env node
/**
 * run.cjs - Project execution script
 *
 * This script ensures dependencies are installed and then runs the main project.
 * For this monorepo, it builds all packages and can optionally run the CLI.
 *
 * Project type: Node.js with pnpm monorepo (TypeScript)
 * Main execution: Build all packages, optionally run CLI
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
  const prefix = `[${timestamp}] [run.cjs]`;

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
 * Executes a command and handles errors
 * @param {string} command - The command to execute
 * @param {string} description - Description of what the command does
 * @returns {boolean} - True if command succeeded
 */
function execCommand(command, description) {
  try {
    log('info', description);
    execSync(command, { stdio: 'inherit', encoding: 'utf8' });
    return true;
  } catch (error) {
    log('error', `Failed: ${description}`);
    return false;
  }
}

/**
 * Main execution function
 */
function main() {
  log('info', 'Starting project execution...');

  const rootDir = path.resolve(__dirname, '..');
  const installScript = path.join(__dirname, 'install.cjs');

  // Verify install script exists
  if (!fs.existsSync(installScript)) {
    log('error', 'install.cjs not found in tools directory');
    process.exit(1);
  }

  // Step 1: Ensure dependencies are installed
  log('info', 'Ensuring dependencies are installed...');
  try {
    execSync('node tools/install.cjs', { stdio: 'inherit', cwd: rootDir });
    log('success', 'Dependencies verified');
  } catch (error) {
    log('error', 'Failed to install dependencies');
    process.exit(1);
  }

  // Step 2: Read package.json to determine run strategy
  const packageJsonPath = path.join(rootDir, 'package.json');
  let packageJson;

  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    log('error', `Failed to read package.json: ${error.message}`);
    process.exit(1);
  }

  // Step 3: Build the project (TypeScript compilation)
  // This monorepo needs to be built before it can run
  if (packageJson.scripts && packageJson.scripts.build) {
    log('info', 'Building project...');
    if (!execCommand('pnpm run build', 'Compiling TypeScript packages...')) {
      log('error', 'Build failed');
      process.exit(1);
    }
    log('success', 'Build completed successfully');
  } else {
    log('warn', 'No build script found in package.json');
  }

  // Step 4: Check if CLI package can be executed
  const cliPackagePath = path.join(rootDir, 'packages', 'cli', 'package.json');
  const cliDistPath = path.join(rootDir, 'packages', 'cli', 'dist');

  if (fs.existsSync(cliPackagePath) && fs.existsSync(cliDistPath)) {
    log('info', 'CLI package is available');
    log('success', 'Project is ready to run');

    // Parse command line arguments passed to this script
    const args = process.argv.slice(2);

    if (args.length > 0) {
      // If arguments provided, pass them to the CLI
      const cliArgs = args.join(' ');
      log('info', `Running CLI with arguments: ${cliArgs}`);

      try {
        execSync(`node packages/cli/dist/index.js ${cliArgs}`, {
          stdio: 'inherit',
          cwd: rootDir
        });
        log('success', 'CLI executed successfully');
      } catch (error) {
        log('error', 'CLI execution failed');
        process.exit(error.status || 1);
      }
    } else {
      // No arguments - just show that build was successful
      log('success', 'All packages built successfully');
      log('info', 'To run the CLI: node packages/cli/dist/index.js [args]');
      log('info', 'Or use: pnpm run <script-name> from package.json');
    }
  } else {
    log('success', 'Build completed. Project is ready.');
    log('info', 'This is a library/framework project. Use the exported packages.');
  }

  process.exit(0);
}

// Execute main function
try {
  main();
} catch (error) {
  log('error', `Unexpected error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
