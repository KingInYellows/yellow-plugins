/**
 * @yellow-plugins/domain - Update Module
 *
 * Entry point for update service exports.
 * Part of Task I3.T2: Changelog-aware update pipeline
 */

export { UpdateService } from './updateService.js';
export type { IUpdateService } from './contracts.js';
export type {
  UpdateCheckRequest,
  UpdateCheckResult,
  UpdateExecutionRequest,
  UpdateExecutionResult,
  BatchUpdateResult,
  PluginUpdateCheck,
} from './types.js';
