/**
 * @yellow-plugins/cli - Command Metadata Types
 *
 * Type definitions for CLI command metadata, handlers, and structured logging.
 * Supports metadata-driven command registration and help generation.
 *
 * Part of Task I1.T4: CLI command manifest and structured logging
 */

import type { Config, FeatureFlags } from '@yellow-plugins/domain';

import type { ILogger } from './logging.js';

/**
 * Feature flag keys that can be required by commands.
 * Re-export for type safety and to avoid duplication.
 */
export type FeatureFlagKey = keyof FeatureFlags;

/**
 * Context passed to command handlers containing configuration and runtime state.
 */
export interface CommandContext {
  /** Merged configuration from all sources */
  readonly config: Config;
  /** Resolved feature flags */
  readonly flags: FeatureFlags;
  /** Correlation ID for this command invocation */
  readonly correlationId: string;
  /** Command name being executed */
  readonly command: string;
  /** Start timestamp of the command */
  readonly startTime: Date;
  /** Structured logger scoped to this invocation */
  readonly logger: ILogger;
}

/**
 * Command options as parsed by yargs.
 * Commands can extend this interface with their specific options.
 */
export interface BaseCommandOptions {
  /** Override config file path (--config) */
  config?: string;
  /** Override flags file path (--flags) */
  flags?: string;
  /** Input file or data (--input) */
  input?: string;
  /** Output file or destination (--output) */
  output?: string;
  /** Verbose output (--verbose) */
  verbose?: boolean;
  /** Dry-run mode without side effects (--dry-run) */
  dryRun?: boolean;
}

/**
 * Result returned by command handlers.
 */
export interface CommandResult {
  /** Success status */
  success: boolean;
  /** Status code or implementation state */
  status: 'success' | 'error' | 'partial' | 'dry-run' | 'not-implemented';
  /** Human-readable message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Error details if applicable */
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * Command handler function signature.
 */
export type CommandHandler<TOptions extends BaseCommandOptions = BaseCommandOptions> = (
  options: TOptions,
  context: CommandContext
) => Promise<CommandResult> | CommandResult;

/**
 * Usage example for a command.
 */
export interface CommandExample {
  /** Example command invocation */
  command: string;
  /** Description of what the example demonstrates */
  description: string;
}

/**
 * Metadata for a CLI command.
 */
export interface CommandMetadata<TOptions extends BaseCommandOptions = BaseCommandOptions> {
  /** Command name (e.g., 'install', 'update') */
  readonly name: string;
  /** Command aliases */
  readonly aliases?: string[];
  /** Short description for help text */
  readonly description: string;
  /** Detailed usage notes */
  readonly usage?: string;
  /** Feature flags required to enable this command */
  readonly requiredFlags?: FeatureFlagKey[];
  /** Specification anchor references for traceability */
  readonly specAnchors?: string[];
  /** Error codes this command may emit */
  readonly errorCodes?: string[];
  /** Usage examples */
  readonly examples?: CommandExample[];
  /** Command handler function */
  readonly handler: CommandHandler<TOptions>;
  /** Command-specific options builder */
  readonly builder?: (yargs: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

/**
 * Registry mapping command names to their metadata.
 */
export type CommandRegistry = Record<string, CommandMetadata<BaseCommandOptions>>;
