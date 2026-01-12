/**
 * @yellow-plugins/cli - Logging Types
 *
 * Type definitions for structured logging with dual-channel output.
 * Supports JSON logs to stdout and human-readable logs to stderr.
 *
 * Part of Task I1.T4: CLI command manifest and structured logging
 */

/**
 * Log levels following standard severity ordering.
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  AUDIT = 'audit',
}

/**
 * Structured log entry written to stdout as JSON.
 */
export interface StructuredLogEntry {
  /** ISO timestamp */
  timestamp: string;
  /** Log level */
  level: LogLevel;
  /** Command being executed */
  command: string;
  /** Correlation ID for this invocation */
  correlationId: string;
  /** Human-readable message */
  message: string;
  /** Additional structured data */
  data?: Record<string, unknown>;
  /** Duration in milliseconds (for timing logs) */
  durationMs?: number;
  /** Error code if applicable */
  errorCode?: string;
}

/**
 * Logger context passed when creating a logger instance.
 */
export interface LoggerContext {
  /** Command name */
  command: string;
  /** Correlation ID for this invocation */
  correlationId: string;
}

/**
 * Logger interface providing structured and human-readable logging.
 */
export interface ILogger {
  /**
   * Log debug information (verbose mode only).
   */
  debug(message: string, data?: Record<string, unknown>): void;

  /**
   * Log informational messages.
   */
  info(message: string, data?: Record<string, unknown>): void;

  /**
   * Log warnings.
   */
  warn(message: string, data?: Record<string, unknown>): void;

  /**
   * Log errors.
   */
  error(message: string, data?: Record<string, unknown>): void;

  /**
   * Log audit events (always logged regardless of level).
   */
  audit(message: string, data?: Record<string, unknown>): void;

  /**
   * Log command timing information.
   */
  timing(message: string, durationMs: number, data?: Record<string, unknown>): void;

  /**
   * Get the current logger context.
   */
  getContext(): Readonly<LoggerContext>;
}
