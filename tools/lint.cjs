#!/usr/bin/env node
/**
 * lint.cjs - Code linting script with JSON output
 *
 * This script ensures dependencies are installed (including ESLint) and then
 * lints the project source code, outputting results exclusively in JSON format.
 *
 * Project type: Node.js/TypeScript with ESLint
 * Output: JSON array of error objects to stdout
 * Logs: All non-JSON output goes to stderr
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * Logs messages to stderr (not stdout, which is reserved for JSON)
 * @param {string} message - The message to log
 */
function logToStderr(message) {
  console.error(`[lint.cjs] ${message}`);
}

/**
 * Main linting function
 */
function main() {
  const rootDir = path.resolve(__dirname, '..');
  const installScript = path.join(__dirname, 'install.cjs');

  // Step 1: Silently ensure dependencies are installed (including ESLint)
  if (!fs.existsSync(installScript)) {
    logToStderr('ERROR: install.cjs not found');
    process.exit(1);
  }

  try {
    execSync('node tools/install.cjs', {
      stdio: 'ignore',
      cwd: rootDir
    });
  } catch (error) {
    logToStderr('ERROR: Failed to install dependencies');
    process.exit(1);
  }

  // Step 2: Verify ESLint is installed
  const eslintPath = path.join(rootDir, 'node_modules', '.bin', 'eslint');
  const eslintExists = fs.existsSync(eslintPath) ||
                       fs.existsSync(eslintPath + '.cmd') ||
                       fs.existsSync(eslintPath + '.ps1');

  if (!eslintExists) {
    logToStderr('ERROR: ESLint not found in node_modules');
    process.exit(1);
  }

  // Step 3: Read package.json to get lint configuration
  const packageJsonPath = path.join(rootDir, 'package.json');
  let lintCommand = 'eslint . --ext .ts,.tsx,.js,.jsx';

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    if (packageJson.scripts && packageJson.scripts.lint) {
      // Extract the actual eslint command from the script
      const scriptCommand = packageJson.scripts.lint;
      // Use the command as-is if it starts with eslint
      if (scriptCommand.trim().startsWith('eslint')) {
        lintCommand = scriptCommand;
      }
    }
  } catch (error) {
    logToStderr('WARN: Could not read package.json, using default lint command');
  }

  // Step 4: Run ESLint with JSON output format
  // We use --format json to get structured output
  // We ignore warnings and only report errors
  // Use pnpm exec to ensure we use the locally installed eslint
  const eslintJsonCommand = `pnpm exec ${lintCommand} --format json --quiet`;

  try {
    // Execute ESLint - it will throw if there are errors
    const output = execSync(eslintJsonCommand, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd: rootDir
    });

    // Parse ESLint JSON output
    const eslintResults = JSON.parse(output);

    // Transform ESLint format to required format
    const errors = [];

    for (const result of eslintResults) {
      // Only process files with messages
      if (!result.messages || result.messages.length === 0) {
        continue;
      }

      for (const message of result.messages) {
        // Only include errors (severity 2), skip warnings
        if (message.severity === 2) {
          errors.push({
            type: message.ruleId || 'lint-error',
            path: path.relative(rootDir, result.filePath),
            obj: message.ruleId || '',
            message: message.message,
            line: message.line || 0,
            column: message.column || 0
          });
        }
      }
    }

    // Output JSON array to stdout
    console.log(JSON.stringify(errors, null, 2));

    // Exit with 0 if no errors found, 1 if errors exist
    if (errors.length > 0) {
      logToStderr(`Found ${errors.length} error(s)`);
      process.exit(1);
    } else {
      logToStderr('No errors found');
      process.exit(0);
    }
  } catch (error) {
    // ESLint exits with non-zero if there are errors
    if (error.stdout) {
      try {
        // Try to parse the JSON output even if command failed
        const eslintResults = JSON.parse(error.stdout);
        const errors = [];

        for (const result of eslintResults) {
          if (!result.messages || result.messages.length === 0) {
            continue;
          }

          for (const message of result.messages) {
            if (message.severity === 2) {
              errors.push({
                type: message.ruleId || 'lint-error',
                path: path.relative(rootDir, result.filePath),
                obj: message.ruleId || '',
                message: message.message,
                line: message.line || 0,
                column: message.column || 0
              });
            }
          }
        }

        // Output errors as JSON
        console.log(JSON.stringify(errors, null, 2));

        logToStderr(`Found ${errors.length} error(s)`);
        process.exit(1);
      } catch (parseError) {
        logToStderr('ERROR: Failed to parse ESLint JSON output');
        logToStderr(error.stdout || error.message);
        // Output empty array on parse failure
        console.log('[]');
        process.exit(1);
      }
    } else {
      logToStderr('ERROR: ESLint execution failed');
      logToStderr(error.message);
      if (error.stderr) {
        logToStderr(error.stderr);
      }
      // Output empty array on execution failure
      console.log('[]');
      process.exit(1);
    }
  }
}

// Execute main function
try {
  main();
} catch (error) {
  logToStderr(`FATAL ERROR: ${error.message}`);
  // Always output valid JSON even on catastrophic failure
  console.log('[]');
  process.exit(1);
}
