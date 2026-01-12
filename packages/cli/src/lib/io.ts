/**
 * @yellow-plugins/cli - Command I/O Helpers
 *
 * Utilities for loading JSON input, writing JSON output, and handling
 * CLI contract envelopes for automation and deterministic testing.
 *
 * Part of Task I2.T4: CLI Contract Catalog implementation
 *
 * @specification Section 2 API Style, Section 4 Documentation Directive
 * @contracts docs/contracts/cli-contracts.md
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type { BaseCommandOptions, CommandContext, CommandResult } from '../types/commands.js';

import { generateTransactionId } from './logger.js';

/**
 * Load request payload from JSON input or build from CLI arguments.
 *
 * Priority order:
 * 1. --input <file> flag (read from file)
 * 2. --input - flag (read from stdin)
 * 3. Fallback object built from CLI arguments
 *
 * @param options Command options containing input flag
 * @param fallback Fallback object to use when no JSON input provided
 * @param context Command context for logging
 * @returns Merged request object
 *
 * @example
 * ```typescript
 * const request = await loadRequest<InstallRequest>(options, {
 *   pluginId: options.plugin,
 *   version: options.version,
 *   force: options.force,
 *   compatibilityIntent: buildCompatibilityIntent(),
 *   correlationId: context.correlationId,
 *   dryRun: options.dryRun,
 * }, context);
 * ```
 */
export async function loadRequest<T = unknown>(
  options: BaseCommandOptions,
  fallback: Partial<T>,
  context?: CommandContext
): Promise<T> {
  const logger = context?.logger;

  // No JSON input - use fallback from CLI args
  if (!options.input) {
    logger?.debug('No --input flag provided, using CLI arguments');
    return fallback as T;
  }

  try {
    let jsonContent: string;

    // Read from stdin
    if (options.input === '-') {
      logger?.debug('Reading JSON input from stdin');
      jsonContent = await readStdin();
    }
    // Read from file
    else {
      const inputPath = path.resolve(options.input);
      logger?.debug('Reading JSON input from file', { path: inputPath });
      jsonContent = await fs.readFile(inputPath, 'utf-8');
    }

    // Parse JSON
    const parsed = JSON.parse(jsonContent) as T;
    const parsedKeys = parsed && typeof parsed === 'object' ? Object.keys(parsed as object) : [];
    logger?.debug('Successfully parsed JSON input', { keys: parsedKeys });

    // Merge with fallback (JSON takes precedence)
    const merged = {
      ...fallback,
      ...parsed,
    } as T;

    const hasCorrelationId =
      merged && typeof merged === 'object' && 'correlationId' in merged
        ? !!(merged as { correlationId?: unknown }).correlationId
        : false;

    logger?.info('Loaded request from JSON input', {
      source: options.input === '-' ? 'stdin' : options.input,
      hasCorrelationId,
    });

    return merged;
  } catch (error) {
    logger?.error('Failed to load JSON input', {
      error,
      input: options.input,
    });

    throw new Error(
      `Failed to load JSON input from ${options.input}: ${(error as Error).message}`
    );
  }
}

/**
 * Write response payload to JSON output or stdout.
 *
 * Priority order:
 * 1. --output <file> flag (write to file)
 * 2. --output - flag (write to stdout as JSON)
 * 3. No output flag (return without writing, CLI logs to console normally)
 *
 * @param response Response object to write
 * @param options Command options containing output flag
 * @param context Command context for logging
 *
 * @example
 * ```typescript
 * const response: InstallResponse = {
 *   success: true,
 *   status: 'success',
 *   message: 'Successfully installed plugin',
 *   ...
 * };
 *
 * await writeResponse(response, options, context);
 * ```
 */
export async function writeResponse<T = unknown>(
  response: T,
  options: BaseCommandOptions,
  context?: CommandContext
): Promise<void> {
  const logger = context?.logger;

  // No output flag - CLI will log normally to console
  if (!options.output) {
    logger?.debug('No --output flag provided, skipping JSON output');
    return;
  }

  try {
    // Serialize to JSON with pretty formatting
    const jsonContent = JSON.stringify(response, null, 2);

    // Write to stdout
    if (options.output === '-') {
      logger?.debug('Writing JSON output to stdout');
      process.stdout.write(jsonContent + '\n');
    }
    // Write to file
    else {
      const outputPath = path.resolve(options.output);
      logger?.debug('Writing JSON output to file', { path: outputPath });

      // Ensure directory exists
      await fs.mkdir(path.dirname(outputPath), { recursive: true });

      // Atomic write using temp file + rename
      const tempPath = `${outputPath}.tmp`;
      await fs.writeFile(tempPath, jsonContent, 'utf-8');
      await fs.rename(tempPath, outputPath);

      logger?.info('Wrote response to JSON file', {
        path: outputPath,
        bytes: jsonContent.length,
      });
    }
  } catch (error) {
    logger?.error('Failed to write JSON output', {
      error,
      output: options.output,
    });

    throw new Error(
      `Failed to write JSON output to ${options.output}: ${(error as Error).message}`
    );
  }
}

/**
 * Convert domain response to CLI CommandResult format.
 *
 * @param response Typed response object (InstallResponse, UpdateResponse, etc.)
 * @returns CommandResult for CLI handler return
 *
 * @example
 * ```typescript
 * const response: InstallResponse = await installService.install(request);
 * await writeResponse(response, options, context);
 * return toCommandResult(response);
 * ```
 */
export function toCommandResult<T extends { success: boolean; status: string; message: string }>(
  response: T
): CommandResult {
  return {
    success: response.success,
    status: response.status as CommandResult['status'],
    message: response.message,
    data: 'data' in response ? (response.data as Record<string, unknown>) : undefined,
    error: 'error' in response ? (response.error as CommandResult['error']) : undefined,
  };
}

/**
 * Build base response envelope with common metadata.
 *
 * @param result Partial result data from domain logic
 * @param context Command context
 * @returns Base response fields (success, status, message, timestamps, etc.)
 *
 * @example
 * ```typescript
 * const response: InstallResponse = {
 *   ...buildBaseResponse({ success: true, message: 'Installed' }, context),
 *   data: installResult.data,
 * };
 * ```
 */
export function buildBaseResponse<T extends { success: boolean; message: string }>(
  result: T,
  context: CommandContext
): {
  success: boolean;
  status: 'success' | 'error' | 'dry-run' | 'partial';
  message: string;
  transactionId: string;
  correlationId: string;
  timestamp: string;
  cliVersion: string;
} {
  // Determine status based on result
  let status: 'success' | 'error' | 'dry-run' | 'partial';
  if ('status' in result && typeof result.status === 'string') {
    status = result.status as typeof status;
  } else {
    status = result.success ? 'success' : 'error';
  }

  const existingTransactionId = context.logger.getContext().transactionId;
  const transactionId = existingTransactionId ?? generateTransactionId(context.correlationId);

  if (!existingTransactionId) {
    context.logger.setTransactionId(transactionId);
  }

  return {
    success: result.success,
    status,
    message: result.message,
    transactionId,
    correlationId: context.correlationId,
    timestamp: new Date().toISOString(),
    cliVersion: getCLIVersion(),
  };
}

/**
 * Build compatibility intent from current runtime environment.
 *
 * @returns CompatibilityIntent object with Node version, OS, architecture
 *
 * @example
 * ```typescript
 * const request = {
 *   pluginId: 'example',
 *   compatibilityIntent: buildCompatibilityIntent(),
 * };
 * ```
 */
export function buildCompatibilityIntent(): {
  nodeVersion: string;
  os: string;
  arch: string;
  claudeVersion?: string;
} {
  return {
    nodeVersion: process.version.replace(/^v/, ''), // Remove 'v' prefix
    os: process.platform,
    arch: process.arch,
    // claudeVersion would come from environment or config in real implementation
  };
}

/**
 * Get CLI version from package.json.
 * Placeholder implementation - should read from actual package metadata.
 *
 * @returns CLI version string (semver)
 */
function getCLIVersion(): string {
  // TODO: Read from package.json or environment variable
  // For now, return a placeholder that matches the schema pattern
  return '1.0.0';
}

/**
 * Read all data from stdin.
 *
 * @returns Complete stdin content as string
 * @throws Error if stdin read fails
 */
async function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];

    process.stdin.setEncoding('utf-8');

    process.stdin.on('data', (chunk) => {
      chunks.push(chunk.toString());
    });

    process.stdin.on('end', () => {
      resolve(chunks.join(''));
    });

    process.stdin.on('error', (error) => {
      reject(new Error(`Failed to read from stdin: ${error.message}`));
    });

    // Resume stdin in case it's paused
    process.stdin.resume();
  });
}

/**
 * Validate request against JSON schema (future enhancement).
 *
 * This function is a placeholder for future AJV integration to validate
 * request payloads against JSON schemas before processing.
 *
 * @param data Request data to validate
 * @param schemaPath Path to JSON schema file
 * @returns Validation result
 *
 * @example
 * ```typescript
 * const validationResult = await validateSchema(request, 'api/cli-contracts/install.json');
 * if (!validationResult.success) {
 *   throw new Error(`Invalid request: ${validationResult.errors.join(', ')}`);
 * }
 * ```
 */
export async function validateSchema(
  data: unknown,
  schemaPath: string
): Promise<{ success: boolean; errors?: string[] }> {
  // TODO: Implement AJV validation
  // For now, return success (validation will be added in future iteration)
  void data;
  void schemaPath;

  return { success: true };
}
