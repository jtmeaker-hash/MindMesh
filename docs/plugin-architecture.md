# MindMesh Plugin Architecture

MindMesh Core can run optional features as **plugins**. This document describes
the contract, the safety guarantees, the storage/backup model and the branch +
CI structure.

The first plugins are **Money Management** and **Car Maintenance**. Both were
already working features; they were *wrapped*, not rewritten. Their behaviour,
stored data, calculations, notifications, settings and backup integration are
unchanged.

---

## Core vs plugins

**Core** (always present) owns the essential infrastructure:

- reminder engine, steps/subtasks, categories/subcategories
- database/storage infrastructure
- notification + scheduler infrastructure
- backup/restore infrastructure
- settings, graph infrastructure, Android native bridge
- diagnostics
- **Plugin Manager, Plugin Registry, Plugin API**

Plugins depend on Core. **Core never depends on a specific plugin.** Core only
sees plugins through generic interfaces:

```
PLUGIN ──▶ CORE API        ✅
CORE ──▶ MONEY MANAGEMENT  ❌
CORE ──▶ CAR MAINTENANCE   ❌
```

`App.tsx` renders plugin UI generically from the registry's enabled routes; it
does not import `MoneyModule` or `VehicleModule` directly. The only place that
knows about concrete built-ins is `web/src/plugins/registerBuiltins.ts`.

---

## Source layout

```
web/src/plugins/
├── core/
│   ├── types.ts            # Plugin API contract (MindMeshPlugin, PluginContext, ...)
│   ├── version.ts          # semver compatibility helpers
│   ├── manifest.ts         # manifest + package validation
│   ├── registry.ts         # available/installed/enabled + status resolution
│   ├── manager.ts          # lifecycle: enable/disable/delete/migrations/backup provider
│   ├── context.ts          # controlled PluginContext factory
│   ├── loader.ts           # downloaded-package validation
│   ├── backupBridge.ts     # Core backup ↔ plugin handlers (no import cycle)
│   ├── runtime.ts          # process-wide manager singleton + diagnostics summary
│   ├── usePluginRuntime.ts # React subscription hook
│   └── components/PluginManagerModal.tsx
├── money-management/
│   ├── plugin.manifest.json
│   ├── manifest.ts / index.ts / migrations.ts / MoneyManagementRoute.tsx
└── car-maintenance/
    ├── plugin.manifest.json
    ├── manifest.ts / index.ts / migrations.ts / CarMaintenanceRoute.tsx
```

---

## Plugin contract

A plugin declares a manifest and lifecycle. See `core/types.ts` for the exact
types; conceptually:

```ts
interface MindMeshPlugin {
  manifest: PluginManifest;      // id, version, minimumCoreVersion, apiVersion, schemaVersion
  defaultEnabled?: boolean;
  activate(context: PluginContext): void | Promise<void>;
  deactivate(context: PluginContext): void | Promise<void>;
  deleteData?(context: PluginContext): void;
  routes?: PluginRoute[];
  settings?: PluginSetting[];
  graphNodeTypes?: PluginNodeType[];
  backup?: PluginBackupHandler;
  migrations?: RuntimePluginMigration[];
}
```

### PluginContext (controlled API)

Plugins interact with MindMesh only through controlled APIs — never raw
application state:

`storage`, `notifications`, `scheduler`, `reminders`, `graph`, `backup`,
`settings`, `diagnostics`, `nativeBridge`.

---

## Enable / disable / delete

**Enable** validates the plugin package, checks Core compatibility, dependencies
and permissions, runs required migrations, activates the plugin and registers its
routes.

**Disable** deactivates the plugin, stops its plugin-specific runtime work,
hides its UI and **retains its data**.

> **Disabling a plugin never deletes its data.** Data removal is a separate,
> explicitly confirmed **Delete plugin data** action.

A plugin that throws during load/activation is **isolated**: Core keeps running,
the plugin is marked `Error`, the cause is recorded and shown in the Plugin
Manager and Diagnostics.

---

## Plugin statuses

`Installed`, `Enabled`, `Disabled`, `Update Available`, `Incompatible`,
`Missing Dependency`, `Migration Required`, `Error`.

Settings → Plugins (also the options menu → **Plugins**) shows each plugin's
name, description, version, required Core version, status, permissions,
enable/disable control and any load error.

---

## Storage model

Logical isolation, not forced physical isolation. Plugin-owned data continues to
live in the existing, compatible slices:

```
MindMesh Core payload (localStorage mindmesh_state_v2)
├── categories, reminders, routines, nodePositions
├── settings, appearance, notifications
├── plugins            # plugin registry install/enable state
├── money              # Money Management plugin data
└── vehicles           # Car Maintenance plugin data
```

This is deliberate: moving data into separate physical stores would risk user
data for no functional gain. `PluginRegistry` owns install/enable state;
`PluginContext.storage` gives any plugin its own namespaced key/value space.

---

## Zero-data-loss migration

Migration is **additive and idempotent**:

1. The plugin registry is a new optional slice (`plugins`), defaulted safely.
2. On first load after upgrade, the Plugin Manager registers each built-in
   plugin and **auto-enables it** (and/or when the legacy feature data shows the
   feature was previously active). The upgrade is invisible: the feature just
   keeps working.
3. Plugin schema migrations run once and are recorded (`completedMigrations`).
   Running them again is a no-op.
4. No `DROP TABLE` / `DELETE ALL` / reset is ever used to convert a feature.

The existing Money and Car data is adopted in place and normalised
non-destructively; record counts are preserved (covered by regression tests).

---

## Backup / restore

The backup format extends additively — existing backups remain importable. Every
plugin section carries its own identity and version metadata:

```json
{
  "core": { "...": "existing fields unchanged" },
  "plugins": {
    "money-management": {
      "payloadVersion": 1,
      "pluginId": "money-management",
      "name": "Money Management",
      "version": "1.2.0",
      "schemaVersion": 1,
      "enabled": false,
      "settings": { "notifyUpcomingPayments": true },
      "lastModified": "2026-01-01T00:00:00.000Z",
      "data": {}
    }
  }
}
```

### Non-negotiable data-safety rule

**Plugin state never determines whether user data is included in a backup.**
Enabled, disabled, unavailable and temporarily uninstalled plugins all keep their
existing data until the user explicitly deletes it.

- Plugin data is **always** backed up, including for **disabled** plugins.
- A plugin section is **generic**: the Core backup engine has no special cases
  for Money Management or Car Maintenance, so future plugins participate simply
  by declaring a `backup` handler.
- The `enabled` field is configuration only. `enabled: false` never means the
  `data` may be dropped.

### Retained data for unavailable plugins

Restoring a backup whose plugin is not installed (or has no backup handler) does
**not** discard that payload. The section is stored verbatim in a separate
retained-data store (`mindmesh_plugin_retained_v1`), outside the live state
payload, and marked as belonging to an unavailable plugin (`enabled: false`).

When the plugin later becomes available:

1. the retained payload is detected by its unique plugin id;
2. it is restored into the plugin's store;
3. the plugin's supported migrations run;
4. only after restore + migration both succeed is the retained copy dropped.

A failed apply or a throwing migration therefore **never destroys the original
retained data**. Retained payloads keep travelling with every subsequent backup
until the plugin adopts them, so the data is never lost in the meantime.

- A plugin section that fails to restore is logged and retained (not skipped);
  it never fails the whole restore or destroys the restored core data.
- Backups created before the plugin architecture (no plugin sections) restore
  unchanged, and older `{ version, schemaVersion, data }` sections are
  backfilled with identity metadata on load.

### Uninstall protection

Plugin code/binary removal and plugin user data removal are separate concerns.
Removing a plugin never implicitly deletes its stored data, backup data, history
or restoration settings. Permanent deletion is a distinct, user-confirmed
**Delete plugin data** action in the Plugin Manager; it is the only path that may
clear a retained payload.

---

## Plugin package format

Downloaded plugins use the `.mindmesh-plugin.zip` format with a
`manifest.json` and an integrity descriptor:

```
money-management-v1.2.0.mindmesh-plugin.zip
car-maintenance-v1.0.3.mindmesh-plugin.zip
```

`scripts/package-plugin.mjs` validates the manifest, checks Core/Plugin API
compatibility, computes integrity (`fnv1a`) and a `sha256` checksum, and emits
the artifact. The runtime (`core/manifest.ts`, `core/loader.ts`) validates the
same descriptor before installation and rejects malformed/incompatible packages
gracefully. Downloaded plugin code has **no** unrestricted Android access — all
capabilities go through the Plugin API.

---

## Versioning

Each plugin has its own version, independent of Core:

```
MindMesh Core:    1.8.0
Money Management: 1.2.0
Car Maintenance:  1.0.3
```

Manifests state `minimumCoreVersion` and `apiVersion`, so a plugin can be updated
without forcing an unrelated plugin or Core release.

---

## Branch model

```
main
├── <temporary active PR branch>   # one at a time; delete after merge
├── plugin/money-management        # persistent plugin distribution branch
├── plugin/car-maintenance         # persistent plugin distribution branch
└── plugin/<future-plugin>
```

- **main** is the stable release. It is never a scratch branch.
- Exactly **one** normal development PR branch at a time, deleted after merge.
- Plugin branches are **persistent** because plugins are independently developed,
  tested, versioned, packaged, downloaded, updated and diagnosed. They are
  intentional distribution branches, not abandoned PR branches.

---

## CI

Existing workflows are preserved:

- `.github/workflows/main-release.yml` — stable release validation (unchanged).
- `.github/workflows/pr-debug.yml` — PR/debug validation (unchanged).
- `.github/workflows/readme-update.yml` — README maintenance (unchanged).

New, isolated plugin workflows:

- `.github/workflows/plugin-money-management.yml`
- `.github/workflows/plugin-car-maintenance.yml`

Each runs only for its own plugin branch and its own paths, and uploads a
clearly named artifact (`MindMesh-Money-Management-Plugin-vX.Y.Z`,
`MindMesh-Car-Maintenance-Plugin-vX.Y.Z`). A Money change never builds Car
Maintenance, and vice versa.

---

## Diagnostics

Diagnostics include a **Plugin system** check and a Plugins section: Plugin API
version, installed/enabled/disabled plugins, versions, compatibility, migration
status, load status, last plugin error and plugin storage health. A plugin
failure is always diagnosable.
