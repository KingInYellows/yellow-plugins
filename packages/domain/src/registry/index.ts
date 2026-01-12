/**
 * @yellow-plugins/domain - Registry Module
 *
 * Public API for registry management functionality.
 * Part of Task I2.T2: Cache manager + registry persistence
 */

export { RegistryService } from './registryService.js';
export type { IRegistryService } from './contracts.js';
export type {
  InstalledPlugin,
  InstalledPluginRegistry,
  RegistryBackup,
  RegistryMetadata,
  RegistryOperationResult,
  RegistryQuery,
  RegistryUpdateOptions,
  TelemetrySnapshot,
} from './types.js';
export { InstallState } from './types.js';
