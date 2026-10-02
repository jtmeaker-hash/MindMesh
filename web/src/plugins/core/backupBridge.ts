/**
 * Backup bridge.
 *
 * The Core backup/restore service must be able to include plugin data without
 * importing the plugin runtime (which would create an import cycle, since
 * plugins depend on Core services). The PluginManager installs a provider here
 * at startup; the backup service only talks to this tiny interface.
 *
 * A plugin's data is always backed up — including when the plugin is disabled —
 * so disabling a plugin never risks losing its data.
 */
import type { PluginBackupSection } from '../../types/plugin';

export interface PluginRestoreOutcome {
  restored: string[];
  skipped: string[];
  errors: Record<string, string>;
}

export interface PluginBackupProvider {
  /** Serializes every installed plugin that declares a backup handler. */
  exportSections(): Record<string, PluginBackupSection>;
  /** Applies plugin sections after the core state has been persisted. */
  restoreSections(sections: Record<string, PluginBackupSection>): PluginRestoreOutcome;
  /** Ids of plugins that can participate in backup/restore. */
  listBackupPluginIds(): string[];
}

let provider: PluginBackupProvider | null = null;

export function setPluginBackupProvider(next: PluginBackupProvider | null): void {
  provider = next;
}

export function getPluginBackupProvider(): PluginBackupProvider | null {
  return provider;
}

/** Safe export used by the backup service; never throws. */
export function exportPluginBackupSections(): Record<string, PluginBackupSection> {
  if (!provider) return {};
  try {
    return provider.exportSections();
  } catch {
    return {};
  }
}

/** Safe restore used by the backup service; plugin failures are isolated. */
export function restorePluginBackupSections(
  sections: Record<string, PluginBackupSection> | undefined
): PluginRestoreOutcome {
  if (!sections || !provider) return { restored: [], skipped: [], errors: {} };
  try {
    return provider.restoreSections(sections);
  } catch (err) {
    return { restored: [], skipped: [], errors: { '*': err instanceof Error ? err.message : String(err) } };
  }
}
