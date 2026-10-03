# Plugin Migration — Stage 1 Audit & Feature-Parity Inventory

This document is the **Stage 1 (Audit)** artifact for the MindMesh plugin
migration. It maps the *complete existing* Money Management and Car Maintenance
implementations — storage, models, services, notifications, UI routes, backup,
diagnostics, native bridge and tests — and records a **parity checklist** proving
that wrapping each feature as a plugin preserved every capability.

The migration was **architectural only**. No feature was rewritten, no stored
data was reset, no schema was broken, and no UI was redesigned. The two features
are wrapped by thin host adapters (`MoneyManagementRoute`, `CarMaintenanceRoute`)
that render the *existing, unchanged* module components.

> Existing working behaviour is authoritative. The feature lists below describe
> what already exists in the repository, not a new specification.

---

## 1. Audit method

1. Enumerated every file that makes up each feature (module, services, utils,
   types, modals, notifications).
2. Listed each user-visible capability and calculation, then located the exact
   implementation and its test(s).
3. Verified the plugin wrapper changes *registration only* — the module that
   renders and the services that compute are the same modules the app used
   before.
4. Confirmed data adoption is additive/idempotent and non-destructive.
5. Ran the full test suite and the production build (see §10).

---

## 2. Core vs plugin boundary (audit result)

**Core (always present, no plugin required to boot)**

| System | Location |
| --- | --- |
| Reminder engine | `services/reminders.ts`, `services/recurrence.ts` |
| Steps / subtasks | `services/steps.ts` |
| Categories / subcategories | `services/categories.ts`, `services/routineGraph.ts` |
| Storage/database infrastructure | `services/storage.ts` |
| Notification + scheduler infrastructure | `services/notifications.ts`, Android `NotificationScheduler.kt` |
| Backup / restore infrastructure | `services/backup.ts` |
| Settings infrastructure | `services/appearance.ts`, `App.tsx` settings |
| Graph infrastructure | `components/graph/SpatialGraph.tsx`, `services/nodePositions.ts` |
| Android native bridge | `services/notifications.ts` → native scheduler |
| Diagnostics | `services/diagnostics.ts` |
| Plugin Manager / Registry / API | `plugins/core/*` |

**Plugin-owned (optional)**

| Plugin | Route component | Renders |
| --- | --- | --- |
| `money-management` | `plugins/money-management/MoneyManagementRoute.tsx` | `components/money/MoneyModule.tsx` (unchanged) |
| `car-maintenance` | `plugins/car-maintenance/CarMaintenanceRoute.tsx` | `components/vehicles/VehicleModule.tsx` (unchanged) |

`App.tsx` renders plugin UI **generically** from `pluginManager.getEnabledRoutes()`
and never imports `MoneyModule` or `VehicleModule` directly. The only Core file
that references concrete plugins is `plugins/registerBuiltins.ts`.

```
PLUGIN ──▶ CORE API        ✅  (enforced)
CORE   ──▶ MONEY/CAR       ❌  (only registerBuiltins.ts names them)
```

---

## 3. Money Management — implementation inventory

**Sources:** `components/money/*` (module + 8 modals), `utils/finance.ts`,
`utils/payRates.ts`, `types/finance.ts`, `services/moneyNotifications.ts`,
`services/moneyIntelligence.ts`, `services/storage.ts`.

**UI sub-tabs (`MoneySubTab`):** Overview, Direct Debits, Income & Pay,
Extra Income, Tips, Expenses, Settings (categories).

### Parity checklist

| # | Capability | Implementation | Covered by |
| --- | --- | --- | --- |
| M1 | Income configuration (employment type, frequency, next pay date, employer) | `IncomeConfigModal`, `types/finance.ts`, `normalizeIncomeConfig` | `finance.test.ts`, `pay_rates.test.ts` |
| M2 | Pay cycles (bounds + summary + overrides) | `calculatePayCycleBounds`, `calculatePayCycleSummary`, `getCurrentPayCycleSummary` | `finance.test.ts` |
| M3 | Casual hourly pay rates (base/sat/sun/public holiday/evening/night/overtime/custom) | `HourlyRateConfig`, `resolveHourlyRate` | `pay_rates.test.ts` |
| M4 | Custom rate rules (day/time windows, fixed vs multiplier, priority) | `CasualPayRateRule`, `payRates.ts` (`selectRateAt`, `calculateRuledShiftPay`, `calculateShiftPayWithRules`) | `pay_rates.test.ts` |
| M5 | Shift entry + estimate (start/end, break, rate type, paid hours) | `ShiftCalculatorModal`, `calculateShiftDurationHours`, `calculateShiftEstimate` | `pay_rates.test.ts`, `finance.test.ts` |
| M6 | Shift statistics | `computeShiftStats` | `finance.test.ts` |
| M7 | Bills / direct debits CRUD | `DirectDebitModal`, `normalizeDirectDebit` | `direct_debit_due_by.test.tsx` |
| M8 | Direct debit vs bill semantics (bill can become overdue; DD rolls on) | `resolveDirectDebitKind`, `getDirectDebitStatus`, `reconcileDirectDebits` | `direct_debit_due_by.test.tsx`, `finance.test.ts` |
| M9 | Payment due dates + due-by deadlines | `dueByDate`, `getDueByOffsetDays`, `advanceDueByForNextPayment` | `direct_debit_due_by.test.tsx` |
| M10 | Recurrence (weekly→annually, every X days/weeks/months, custom; month-clamping) | `BillFrequency`, `getNextBillOccurrence`, `advanceBillForNextOccurrence`, `addMonthsClamped` | `finance.test.ts`, `recurrence.test.ts` |
| M11 | Expenses (one-off, merchant, payment method, estimated) | `ExpenseModal`, `Expense`, `normalizeExpense` | `expenses.test.tsx` |
| M12 | Repeating expenses + non-date-bound "per pay cycle" expenses | `ExpenseRepeat`, `resolveExpenseRepeat`, `getExpenseCycleContribution` | `recurring_expenses_direct_debits.test.tsx` |
| M13 | Expense summaries | `calculateExpenseSummary`, `sortExpensesNewestFirst` | `expenses.test.tsx` |
| M14 | Extra income (sources, linked reminders, pay-cycle inclusion) | `ExtraIncomeModal`, `ExtraIncome` | `finance.test.ts` |
| M15 | Tips (shift type, venue, stats + summaries) | `TipEntryModal`, `calculateTipSummaries`, `computeTipStats` | `finance.test.ts` |
| M16 | Direct debit / bill categories | `billCategories`, `DirectDebitCategory` | `components.test.tsx` |
| M17 | Upcoming money timeline | `getUpcomingMoneyTimeline`, `formatTimelineDayLabel` | `finance.test.ts` |
| M18 | Direct debit notifications ("withdrawn today") | `moneyNotifications.ts` (`collectDirectDebitNotifications`) | `finance.test.ts`, `notifications.test.ts` |
| M19 | Upcoming-payment reminders / intelligence | `moneyIntelligence.ts` | `finance.test.ts` |
| M20 | Settings (categories, notification toggles) | `MoneyModule` Settings sub-tab, plugin setting `notifyUpcomingPayments` | `components.test.tsx` |
| M21 | Persisted values + non-destructive normalisation | `MoneyState`, `normalizeMoneyState` | `storage.test.ts`, `plugin_backup.test.ts` |
| M22 | Backup / restore participation | `plugins/money-management/index.ts` `backup` handler | `plugin_backup.test.ts`, `backup_export.test.ts` |
| M23 | Diagnostics | plugin `health()`, `services/diagnostics.ts` `packages`/`plugins` | `diagnostics.test.ts` |

**Storage:** Core slice `money` inside `localStorage mindmesh_state_v2`
(`loadMoneyState`/`saveMoneyState`). Adopted in place by migration
`money-management.legacy-hydration` (schema v0 → v1) — normalises, never deletes.

---

## 4. Car Maintenance — implementation inventory

**Sources:** `components/vehicles/*` (`VehicleModule`, `VehicleForms`,
`VehicleUi`), `services/vehicleMaintenance.ts`, `services/vehicleNotifications.ts`,
`services/vehicleDiagnostics.ts`, `types/vehicle.ts`, `services/storage.ts`.

**UI tabs:** Overview, Next Service, Items, Issues, History, Settings.

### Parity checklist

| # | Capability | Implementation | Covered by |
| --- | --- | --- | --- |
| C1 | Vehicle info (nickname, make, model, year, plate, VIN, engine, photo, notes) | `Vehicle` model, `VehicleForms` | `vehicle_ui.test.tsx`, `vehicle_maintenance.test.ts` |
| C2 | Current odometer + odometer records | `Vehicle.currentOdometerKm`, `recordOdometer`, `OdometerRecord` | `vehicle_maintenance.test.ts` |
| C3 | Last service km + date (incl. external baseline) | `lastServiceKm`, `lastServiceDate` | `vehicle_maintenance.test.ts` |
| C4 | Service interval (km + months) | `serviceIntervalKm`, `serviceIntervalMonths` | `vehicle_maintenance.test.ts` |
| C5 | Automatically calculated next service | `computeNextService` | `vehicle_maintenance.test.ts` |
| C6 | Kilometres remaining until service | `computeNextService` / `getVehicleServiceStatus` | `vehicle_maintenance.test.ts` |
| C7 | Service status thresholds (ok/approaching/urgent/due/overdue) | `VehicleThresholds`, `getVehicleServiceStatus` | `vehicle_maintenance.test.ts` |
| C8 | Next-service plan items (required/recommended, cost estimates) | `NextServiceItem`, `resolveItemEstimatedTotal`, `nextServiceCostSummary` | `vehicle_maintenance.test.ts` |
| C9 | Previous service work / service history (append-only) | `ServiceRecord`, `getLatestServiceRecord`, `applyServiceCompletion` | `vehicle_maintenance.test.ts` |
| C10 | Serviceable item list (catalogue + custom) + last replacement | `MaintenanceItem`, `DEFAULT_MAINTENANCE_CATALOG`, `seedMaintenanceItemsForVehicle` | `vehicle_maintenance.test.ts` |
| C11 | Next replacement km/date per item + condition | `computeMaintenanceItemStatus` | `vehicle_maintenance.test.ts` |
| C12 | Parts estimates (estimated vs actual, quantity, supplier) | `PartEstimate` | `vehicle_maintenance.test.ts` |
| C13 | Known issues (severity, priority, status, costs, photos) | `KnownVehicleIssue`, `KNOWN_ISSUE_STATUS_LABELS` | `vehicle_maintenance.test.ts` |
| C14 | Issue priority/status flow (promote to next service, reopen, open count) | `promoteKnownIssueToNextService`, `reopenKnownIssue`, `isIssueOpen`, `countOpenIssues` | `vehicle_maintenance.test.ts` |
| C15 | Service types catalogue | `ServiceTypeDefinition`, `DEFAULT_SERVICE_TYPES` | `vehicle_maintenance.test.ts` |
| C16 | Average km/week + time estimates | `averageKmPerWeek`, `estimateWeeksForKm`, `estimateDateForKm` | `vehicle_maintenance.test.ts` |
| C17 | Recurring odometer update reminder + recurring service/maintenance/issue notifications | `vehicleNotifications.ts` (`buildDesiredVehicleNotifications`) | `vehicle_notifications.test.ts` |
| C18 | Notification settings (master switch, per-type toggles, remind hour, odometer mode) | `VehicleNotificationSettings` | `vehicle_notifications.test.ts` |
| C19 | No-duplicate / cycle-rolling notification jobs | `VehicleNotificationJob`, deterministic `id`/cycle keys | `vehicle_notifications.test.ts` |
| C20 | Settings tab | `VehicleModule` Settings tab | `vehicle_ui.test.tsx` |
| C21 | Persisted values + non-destructive normalisation | `VehicleState`, `normalizeVehicleState` | `storage.test.ts`, `plugin_backup.test.ts` |
| C22 | Backup / restore participation | `plugins/car-maintenance/index.ts` `backup` handler | `plugin_backup.test.ts`, `backup_export.test.ts` |
| C23 | Diagnostics | `vehicleDiagnostics.ts`, plugin `health()` | `diagnostics.test.ts` |

**Storage:** Core slice `vehicles` inside `mindmesh_state_v2`
(`loadVehicleState`/`saveVehicleState`). Adopted in place by migration
`car-maintenance.legacy-hydration` (schema v0 → v1) — normalises, never deletes.

---

## 5. Storage & zero-data-loss migration

| Concern | Result |
| --- | --- |
| Physical data movement | **None.** Logical isolation only; slices stay in the compatible payload. |
| Plugin registry slice | New optional `plugins` slice, defaulted safely (`normalizePluginRegistryState`). |
| Legacy adoption | Idempotent `*.legacy-hydration` migrations normalise in place; write only on change. |
| Re-running migration | No-op (completed ids recorded in `completedMigrations`). |
| Failure handling | Migration failure does not remove original data; retained payloads preserved. |
| Forbidden operations | No `DROP`/`DELETE ALL`/reset used for conversion. |
| First-run invisibility | `bootstrapSync` + `detectExistingData` auto-enable a previously-used feature. |

---

## 6. Notifications & background tasks

- Vehicle/notification logic is **pure desired-state**; the shared engine
  (`services/notifications.ts`) reconciles it against the native scheduler, so
  reminders survive app closure and never duplicate.
- Money direct-debit notifications remain driven by `moneyNotifications.ts`.
- Disabling a plugin hides its UI and stops its scheduling **without cancelling
  unrelated Core notifications**: `App.tsx` passes `vehicleState` to the Core
  notification builder only when `car-maintenance` is enabled.
- Removing plugin tabs redirects the user back to a Core tab rather than blanking
  the app.

---

## 7. Backup / restore

- Additive format — historical backups (no `plugins` field) restore unchanged.
- Every registered plugin with a backup handler contributes a **full section
  regardless of enable/disable state**; `enabled` is configuration only.
- Sections are generic — Core has no Money/Car special cases.
- Unknown / uninstalled plugin payloads are **retained verbatim** in
  `mindmesh_plugin_retained_v1` and adopted (restore → migrate → verify) when the
  plugin becomes available; a failed adoption keeps the retained copy.
- Explicit `Delete plugin data` is the only path that clears retained payloads.

See `docs/persistence-and-backups.md` and `docs/plugin-architecture.md`.

---

## 8. Diagnostics

- `services/diagnostics.ts` registers `checkPluginHealth` (id `plugins.health`,
  category `plugins`) via `describePlugins()`: API/Core versions, installed /
  enabled / disabled counts, compatibility, migration status, load status, last
  error and retained count.
- Plugin Manager modal surfaces per-plugin status, permissions and load errors.

---

## 9. Native bridge

- No plugin gains unrestricted Android access. `PluginContext.nativeBridge`
  exposes only `available(capability)`.
- The Android notification scheduler (`NotificationScheduler.kt`) is Core-owned
  and unchanged; plugins participate through the shared notification engine.

---

## 10. Validation results

Executed from the repository root:

| Check | Command | Result |
| --- | --- | --- |
| Lint | `npm --prefix web run lint` | ✅ clean |
| Type check | `npm --prefix web run type-check` | ✅ clean |
| Tests | `npm --prefix web run test` | ✅ **667 passed / 53 files** |
| Production build | `npm --prefix web run build` | ✅ built (`tsc && vite build`) |
| Android unit tests | `./gradlew :app:testDebugUnitTest` | ✅ BUILD SUCCESSFUL |
| Android debug build | `./gradlew :app:assembleDebug` | ✅ BUILD SUCCESSFUL (~2m19s) |
| Plugin manifest validation | `node scripts/package-plugin.mjs --id <id> --dir <dir> --check` | ✅ both plugins valid |

Plugin-specific regression tests:

- `web/src/test/plugin_system.test.ts` — 13 tests (registry, lifecycle,
  isolation, manifest/package validation).
- `web/src/test/plugin_backup.test.ts` — 14 tests (the 10 required integrity
  scenarios: enabled/disabled/absent round-trips, adoption, multi-plugin, older
  schema migration, migration failure, core-only and legacy backups).
- `web/src/test/plugin_installer.test.ts` — runtime installer (ZIP parsing, the
  stored/deflated entry paths, package validation, install/stage/idempotency,
  uninstall provenance, failure surfacing and factory-reset purging).
- `web/src/test/plugin_migration_data.test.ts` — realistic *populated* Money and
  Car datasets (income, bills, extra income, tips, shifts, expenses; vehicles,
  odometer/service history, maintenance items, issues, plan items, estimates)
  run end-to-end through the plugin legacy-hydration migration, lifecycle and
  backup round-trip.

Feature regression suites preserved and passing: `finance.test.ts`,
`pay_rates.test.ts`, `expenses.test.tsx`,
`recurring_expenses_direct_debits.test.tsx`, `direct_debit_due_by.test.tsx`,
`vehicle_maintenance.test.ts`, `vehicle_notifications.test.ts`,
`vehicle_ui.test.tsx`, `backup_export.test.ts`, `diagnostics.test.ts`.

---

## 11. Existing workflows (preserved)

`main-release.yml`, `pr-debug.yml`, `readme-update.yml` are untouched. Plugin
workflows are additional and isolated:

- `.github/workflows/plugin-money-management.yml`
- `.github/workflows/plugin-car-maintenance.yml`

Each is path-scoped to its plugin branch, supports `workflow_dispatch`, validates
the manifest/integrity via `scripts/package-plugin.mjs`, and uploads
`MindMesh-Money-Management-Plugin-vX.Y.Z` /
`MindMesh-Car-Maintenance-Plugin-vX.Y.Z`.

---

## 12. Follow-ups — resolved

All three previously-open follow-ups are now implemented and covered by tests.

- **Runtime installer for downloaded `.mindmesh-plugin.zip` packages — done.**
  `plugins/core/zip.ts` reads the archive without dependencies (stored and
  deflated entries, bounded against zip bombs); `plugins/core/installer.ts`
  extracts and parses the package descriptor; `PluginManager.installPackage()`
  validates it through the existing `PluginLoader`, records it in the
  installed-package store and reconciles it with the plugin implementation
  present in this build. `scripts/package-plugin.mjs` now embeds the descriptor
  (`mindmesh-package.json`) in the archive so integrity is verifiable at install.
  **Downloaded code is never evaluated** — a package for a plugin this build
  does not contain is *staged*, not executed; distribution plugins ship compiled
  into the app. The Plugin Manager exposes install from file and per-package
  state. See `docs/plugin-architecture.md`.
- **Factory reset purges retained plugin data — done.**
  `resetMindMeshEntirely()` now clears both the retained plugin-data store
  (`mindmesh_plugin_retained_v1`) and the installed-package store, so an
  explicitly destructive reset cannot leave hidden plugin data behind. The
  confirmation copy names plugin data.
- **Populated-dataset regression coverage — done.**
  `plugin_migration_data.test.ts` drives fully populated Money and Car datasets
  through the migration, lifecycle and backup round-trip. Writing it surfaced and
  fixed a real gap: `initialize()` did not run migrations for plugins that were
  auto-enabled on upgrade, so an installed build's `*.legacy-hydration`
  migration never executed on the launch that introduced it.
