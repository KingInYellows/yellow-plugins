/**
 * @yellow-plugins/domain - Publish Service Contracts
 *
 * Domain contracts for publish service interface.
 * Defines the service boundary for publish operations.
 *
 * Part of Task I4.T1: Publish Service and CLI Command
 */

import type { PublishRequest, PublishResult } from './types.js';

/**
 * Publish service interface.
 * Orchestrates plugin publishing with validation, git operations, and lifecycle hooks.
 */
export interface IPublishService {
  /**
   * Publish a plugin to the marketplace.
   *
   * Validates manifest, checks git status, runs lifecycle hooks,
   * and optionally commits, tags, and pushes changes.
   *
   * @param request - Publish request parameters
   * @returns Promise resolving to publish result
   */
  publish(request: PublishRequest): Promise<PublishResult>;
}
