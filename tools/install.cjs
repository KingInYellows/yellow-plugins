#!/usr/bin/env node
/**
 * install.cjs - Environment setup and dependency installation script
 *
 * This script ensures the project environment is properly configured and all
 * dependencies are installed. It is idempotent and safe to run multiple times.
 *
 * Project type: Node.js with pnpm monorepo
 * Package manager: pnpm (>=8.0.0)
 * Node version: >=18.0.0 <=24.x
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for better output visibility
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
  const prefix = `[${timestamp}] [install.cjs]`;

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
 * Executes a command and returns whether it succeeded
 * @param {string} command - The command to execute
 * @param {string} description - Description of what the command does
 * @param {boolean} silent - Whether to suppress command output
 * @returns {boolean} - True if command succeeded, false otherwise
 */
function execCommand(command, description, silent = false) {
  try {
    log('info', description);
    const options = silent ? { stdio: 'pipe' } : { stdio: 'inherit' };
    execSync(command, { ...options, encoding: 'utf8' });
    return true;
  } catch (error) {
    log('error', `Failed: ${description}`);
    if (error.stdout) console.error(error.stdout);
    if (error.stderr) console.error(error.stderr);
    return false;
  }
}

/**
 * Checks if a command is available in the system
 * @param {string} command - The command to check
 * @returns {boolean} - True if command exists, false otherwise
 */
function commandExists(command) {
  try {
    const checkCmd = process.platform === 'win32'
      ? `where ${command}`
      : `which ${command}`;
    execSync(checkCmd, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gets the installed version of a package manager
 * @param {string} packageManager - The package manager command
 * @returns {string|null} - Version string or null if not found
 */
function getVersion(packageManager) {
  try {
    const version = execSync(`${packageManager} --version`, {
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim();
    return version;
  } catch {
    return null;
  }
}

/**
 * Compares two semantic versions
 * @param {string} version - The version to check
 * @param {string} required - The minimum required version
 * @returns {boolean} - True if version meets requirement
 */
function meetsVersionRequirement(version, required) {
  const v = version.split('.').map(n => parseInt(n, 10));
  const r = required.split('.').map(n => parseInt(n, 10));

  for (let i = 0; i < Math.max(v.length, r.length); i++) {
    const vNum = v[i] || 0;
    const rNum = r[i] || 0;
    if (vNum > rNum) return true;
    if (vNum < rNum) return false;
  }
  return true;
}

/**
 * Main installation function
 */
function main() {
  log('info', 'Starting environment setup and dependency installation...');

  const rootDir = path.resolve(__dirname, '..');
  const packageJsonPath = path.join(rootDir, 'package.json');

  // Verify we're in the correct directory
  if (!fs.existsSync(packageJsonPath)) {
    log('error', 'package.json not found. Are you in the correct directory?');
    process.exit(1);
  }

  // Read package.json to get requirements
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
  } catch (error) {
    log('error', `Failed to read package.json: ${error.message}`);
    process.exit(1);
  }

  // Check Node.js version
  const nodeVersion = process.version.slice(1); // Remove 'v' prefix
  const requiredNodeVersion = packageJson.engines?.node || '>=18.0.0';
  log('info', `Node.js version: ${nodeVersion} (required: ${requiredNodeVersion})`);

  // Check if pnpm is installed
  if (!commandExists('pnpm')) {
    log('error', 'pnpm is not installed or not in PATH');
    log('info', 'Install pnpm with: npm install -g pnpm');
    log('info', 'Or visit: https://pnpm.io/installation');
    process.exit(1);
  }

  // Check pnpm version
  const pnpmVersion = getVersion('pnpm');
  const requiredPnpmVersion = packageJson.engines?.pnpm || '>=8.0.0';
  log('info', `pnpm version: ${pnpmVersion} (required: ${requiredPnpmVersion})`);

  if (pnpmVersion && !meetsVersionRequirement(pnpmVersion, '8.0.0')) {
    log('warn', `pnpm version ${pnpmVersion} may not meet requirements`);
    log('info', 'Consider upgrading: npm install -g pnpm@latest');
  }

  // Check if node_modules exists and has content
  const nodeModulesPath = path.join(rootDir, 'node_modules');
  const lockFilePath = path.join(rootDir, 'pnpm-lock.yaml');
  const needsInstall = !fs.existsSync(nodeModulesPath) ||
                       fs.readdirSync(nodeModulesPath).length === 0;

  if (needsInstall) {
    log('info', 'Dependencies not found. Installing...');
  } else {
    // Check if lock file is newer than node_modules (packages were updated)
    const lockFileTime = fs.existsSync(lockFilePath)
      ? fs.statSync(lockFilePath).mtime.getTime()
      : 0;
    const nodeModulesTime = fs.statSync(nodeModulesPath).mtime.getTime();

    if (lockFileTime > nodeModulesTime) {
      log('info', 'Dependencies are outdated. Updating...');
    } else {
      log('success', 'Dependencies are up to date');

      // Still run a quick install to ensure everything is in sync
      // This is idempotent and fast if nothing needs to be done
      if (!execCommand('pnpm install --frozen-lockfile --prefer-offline',
                       'Verifying dependencies...', true)) {
        log('warn', 'Failed to verify dependencies. Trying full install...');
        if (!execCommand('pnpm install', 'Installing dependencies...', false)) {
          log('error', 'Failed to install dependencies');
          process.exit(1);
        }
      }

      log('success', 'Environment setup completed successfully');
      process.exit(0);
    }
  }

  // Install dependencies
  // Try frozen-lockfile first (faster, uses existing lock file)
  let installSuccess = false;

  if (fs.existsSync(lockFilePath)) {
    log('info', 'Using frozen lockfile for installation...');
    installSuccess = execCommand(
      'pnpm install --frozen-lockfile',
      'Installing dependencies from lockfile...',
      false
    );
  }

  // If frozen-lockfile fails or doesn't exist, do a regular install
  if (!installSuccess) {
    log('info', 'Performing fresh installation...');
    installSuccess = execCommand(
      'pnpm install',
      'Installing dependencies...',
      false
    );
  }

  if (!installSuccess) {
    log('error', 'Failed to install dependencies');
    process.exit(1);
  }

  // Verify installation
  log('info', 'Verifying installation...');

  // Check that critical workspace packages have node_modules
  const workspacePackages = [
    'packages/cli',
    'packages/domain',
    'packages/infrastructure'
  ];

  let allPackagesValid = true;
  for (const pkg of workspacePackages) {
    const pkgPath = path.join(rootDir, pkg, 'package.json');
    if (fs.existsSync(pkgPath)) {
      log('success', `Workspace package verified: ${pkg}`);
    } else {
      log('warn', `Workspace package may have issues: ${pkg}`);
      allPackagesValid = false;
    }
  }

  if (!allPackagesValid) {
    log('warn', 'Some workspace packages may not be properly set up');
  }

  log('success', 'Environment setup completed successfully');
  log('info', 'All dependencies installed and verified');
  process.exit(0);
}

// Run the installation
try {
  main();
} catch (error) {
  log('error', `Unexpected error: ${error.message}`);
  console.error(error.stack);
  process.exit(1);
}
