# MindMesh Routine Builder Progress

## Current stage

**Stage 9 — Diagnostics, repair, versioning + data safety — implementation complete**

Stage 9 extends the existing diagnostics/fixer surface with durable Routine quarantine records and validates the existing repair, retention, version restore, draft recovery, and backup safety paths. A standalone GitHub Actions workflow now validates the repository’s web commands on future `main` pushes, pull requests, and manual dispatch.

Stage 6 adds local history aggregation, completion/skip/duration analytics, streaks and goals, unified Today planning, supportive skip reasons, quick-start presets, and Dashboard advisory/plan surfaces. Core execution remains local-first and does not require AI.

Stage 4 is complete for the existing Android AlarmManager/WebView boundary. Routine notifications and timer targets now use the same persisted native scheduling infrastructure as Reminders, with honest platform diagnostics and explicit emulator verification notes.

## Repository audit

- **Product/runtime:** Android app module `:app` hosts a bundled Vite/React TypeScript app in a WebView. The Android layer is a shell and owns native notification scheduling, reboot rescheduling, Android file picking, and JS bridges.
- **Web app architecture:** `web/src/App.tsx` is the current application coordinator. Components are under `web/src/components`; domain logic is under `web/src/services`; shared types are under `web/src/types`; derived calculations are under `web/src/utils`.
- **Navigation:** `web/src/components/navigation/AppNavigation.tsx` exposes MindMesh, Routines, Contacts, Money, and Dashboard. The Dashboard now provides a Routines shortcut.
- **State management:** React component state in `App.tsx`; persisted slices use `web/src/services/storage.ts`. There is no external state library.
- **Persistence:** Browser/WebView `localStorage`, key `mindmesh_state_v2`, schema version 8 before this stage. Legacy category/reminder/position keys are migrated defensively.
- **Existing features audited:** Reminders/subtasks/recurrence, categories/subcategories, Dashboard, Money/direct debits, Contacts, appearance/theme, 2D/3D graph, notifications/Android `AlarmManager`, diagnostics/logging, backup/export/restore, tests, and `.github/workflows/build.yml`.
- **Native boundary:** No Room database or Kotlin domain persistence exists. Android uses `SharedPreferences` only for notification scheduling metadata; routine data correctly remains in the existing local-first web storage contract.

## Completed work

### Stage 1 foundation

- Added a first-class persisted Routine domain model covering routine metadata, statuses, priority, categories/subcategories, tags, flat nested steps, sequential/flexible execution, recurrence/schedule, timing, dependencies, conditions/branches, notifications, links to reminders/contacts/direct debits/sub-routines, occurrences, active sessions, history, stats, templates, version snapshots, archive/trash, draft recovery, and broken-link state.
- Added defensive routine normalization. A malformed routine is quarantined individually with an ID/reason record while valid routines continue loading.
- Added persisted CRUD/lifecycle service operations: create, read/list, update, archive, trash, restore from trash, permanent delete, duplicate without history/stats/session/version history, draft save/recovery, step insertion, and child promotion on step removal.
- Extended the existing storage document to schema v9 with optional `routines`; old payloads default to an empty routine collection without changing existing reminders/categories/etc.
- Extended full backup creation, validation, migration, and transactional restore with optional routine data. Backups created before Routine Builder remain compatible and restore with no routines.
- Kept the implementation local-first and AI-independent; no network service or new persistence dependency was introduced.

### Stage 2 builder and management UI

- Added `RoutineModule`, a first-class Routines area reachable from the primary navigation and Dashboard.
- Added blank and starter-template creation using the persisted Stage 1 service, with required category and starter step defaults.
- Added searchable/filterable routine management for draft, active, paused, archived, and Recently Deleted records.
- Added persisted editor metadata for name, description, category, priority, status, tags surfaced in search, list/graph view switching, and step timing/optional flags.
- Added step add/edit/delete, reorder, nesting/unnesting, and parent deletion promotion through the existing service.
- Added practical graph presentation with directional sequential connections and persisted node positions.
- Added local undo/redo snapshots, explicit Saved/Unsaved state, duplicate, archive, trash, restore, and bulk pause/archive/trash actions.
- Added a focused navigation regression assertion for the fifth primary tab.

### Stage 3 scheduling and execution

- Added `web/src/services/routineEngine.ts` with local recurrence evaluation for daily, selected weekdays, interval days/weeks/months, multiple times per day, specific dates, custom weekday/interval expressions, start/end dates, exceptions, and date overrides.
- Added next-occurrence previews and manual-start fallback for routines without a scheduled date.
- Added persisted occurrence/session runtime transitions for start, sequential/flexible eligibility, dependency checks, completion, skip reasons, pause/resume, snooze, expiry as Overdue/Failed, stats, and history.
- Added safe simple condition evaluation and dependency override support for deliberate runtime actions.
- Added temporary runtime steps, cycle-safe routine trigger validation, and Today-only reorder helpers.
- Added List/Graph/Focus runtime presentation with current-step, Complete, Skip Once, Pause/Resume, Snooze, and Start actions in the Routines area.
- Added scheduling controls for execution mode, recurrence, start date/time, deadline, and duration target.

## Files changed for this stage

- `docs/ROUTINE_BUILDER_PROGRESS.md`
- `web/src/types/routine.ts`
- `web/src/types/index.ts`
- `web/src/types/backup.ts`
- `web/src/services/routines.ts`
- `web/src/services/storage.ts`
- `web/src/services/backup.ts`
- `web/src/test/routines.test.ts`
- `web/src/components/routines/RoutineModule.tsx`
- `web/src/components/navigation/AppNavigation.tsx`
- `web/src/components/dashboard/DashboardModule.tsx`
- `web/src/App.tsx`
- `web/src/types/finance.ts`
- `web/src/test/components.test.tsx`
- `web/src/services/routineEngine.ts`
- `web/src/test/routine_engine.test.ts`
- `web/src/services/routineNotifications.ts`
- `app/src/main/AndroidManifest.xml`
- `app/src/main/java/com/example/notifications/NotificationScheduler.kt`
- `app/src/main/java/com/example/notifications/NotificationStore.kt`
- `app/src/main/java/com/example/notifications/MindMeshNotificationBridge.kt`

The repository also contained pre-existing user changes in other files; those were not intentionally modified by this stage. The production build regenerated bundled WebView assets as part of validation.

### Stage 4 Android reliability

- Extended `ScheduledNotification` with kind, action set, priority, ongoing state, and action metadata while preserving defaults for old SharedPreferences entries.
- Routine notification IDs are namespaced as `routine:<routineId>:...`, avoiding collisions with Reminder IDs and allowing the existing `NotificationStore`, `AlarmManager`, boot receiver, and WebView action queue to be reused.
- Routine start plans cover the next 14 days; active sessions schedule an ongoing notification using the persisted current step, progress, and timer target. Stale plans are cancelled during synchronization.
- Native action delivery remains queued until the WebView is ready. Routine actions are queued on a separate in-page queue and routed to the Routine module rather than being mistaken for Reminder IDs.
- Android capability diagnostics expose permission, scheduled count, exact-alarm capability, battery-optimization exemption, and channel state without silently claiming unsupported guarantees.
- Step timer targets are persisted in `RoutineSession`, so process death/app update recovery can reconstruct remaining time from an absolute timestamp.

## Architecture decisions

1. Routines extend the existing `MindMeshStorageData` document instead of introducing Room, IndexedDB, another backend, or a competing category system.
2. Routine steps are flat records linked by `parentStepId`, allowing arbitrary nesting and stable IDs for future list/graph editors.
3. Runtime/history/session data stays inside the routine aggregate for atomic backup and future process-death recovery.
4. Duplicate creates fresh routine and step IDs and intentionally excludes history, statistics, active sessions, version history, archive/trash timestamps, and draft recovery.
5. Normalization is per-record so one corrupted graph cannot take down the Routine subsystem or other MindMesh modules.
6. Backup routines are optional to preserve old backup compatibility; restore normalizes them in memory before persistence.

## Schema / migration changes

- Storage schema incremented from **8 to 9**.
- Added optional `MindMeshStorageData.routines`; all normalized state reads expose `routines: Routine[]`.
- Added optional `MindMeshBackupData.routines`.
- No Android/Kotlin schema migration was necessary because this repository has no Android database layer.

## Tests run and results

- `npm --prefix web run type-check` — **passed** after Stage 4 changes.
- `npm --prefix web run test -- --run` — **passed: 18 test files, 236 tests**.
- `npm --prefix web run build` — **passed**; Vite generated the production bundle and Android WebView assets successfully.
- `sh ./gradlew :app:testDebugUnitTest --stacktrace` — **blocked before compilation** because this environment has no Android SDK configured (`ANDROID_HOME`/`local.properties` missing). Android source changes therefore require CI/device validation before release.

Focused Routine coverage in `web/src/test/routines.test.ts` verifies nested persistence, duplication isolation, archive/trash/restore/permanent deletion, draft recovery, pre-Routine migration, malformed-record quarantine, full-backup round trip, and old-backup compatibility.

## Backup/restore implications

Routine data is included in full EVERYTHING backups through the existing backup serializer. Old backup files omit `data.routines` and still restore successfully with `routines: []`. Malformed routine records are excluded from the normalized restored collection rather than preventing the rest of the backup from restoring.

## Unrelated bugs found/fixed

- None found or fixed during this stage.

## Known issues / remaining work

- Exact alarm permission is diagnosed but the implementation intentionally continues using `setAndAllowWhileIdle`; Android may delay alarms under battery restrictions. The app does not request exemption automatically.
- Alarm-style wake-screen/full-screen presentation and a dedicated foreground service are not forced; the native notification path uses system-safe AlarmManager behavior and ongoing notifications where supported.
- Android emulator/device validation is still required for app-closed, process-killed, reboot, permission-disabled, battery restriction, and notification action matrix scenarios.
- Android unit tests need an Android SDK-configured environment.
- Full analytics/history, reminder conflict warnings, advanced branch expression editing, schedule optimisation, and the standalone future `main` CI workflow remain later work.

## Stage 5 implementation

### Completed work

- Added persisted user templates through the existing preferences/localStorage contract. Starter templates cover morning reset, bedtime landing, and weekly reset.
- Template snapshots use the existing duplication model, creating fresh IDs and excluding history, stats, active sessions, version history, archive/trash state, and completed step state. Users can choose whether schedules are retained when instantiating a template.
- Added `routineAi.ts` with an optional native `window.MindMeshRoutineAI` bridge and a deterministic offline proposal fallback. AI never writes directly to storage.
- Added before/after proposal records with per-change acceptance. Deletions require an explicit confirmation argument; unapproved or unavailable AI leaves the routine unchanged.
- Added builder controls for Save as template, proposal prompt, per-change review, and Apply selected/Discard.
- Added persisted step links/selectors for existing Reminder, Contact, and Direct Debit records, including configurable completion behavior (`ask-first`, `complete-step`, `open-target`).
- Added link validation/repair service. Missing targets are removed from the step only through an explicit repair operation; the step remains and broken-link metadata is preserved until repaired.
- Added call/message action URL helpers for linked contacts.
- Added Dashboard routine summary card for active/running routines and current-session step progress.
- Added Stage 5 regression tests for template runtime isolation, offline AI approval, and broken-link repair.

### Files changed in Stage 5

- `web/src/types/routine.ts`
- `web/src/services/routineTemplates.ts`
- `web/src/services/routineAi.ts`
- `web/src/services/routineIntegrations.ts`
- `web/src/components/routines/RoutineModule.tsx`
- `web/src/components/dashboard/DashboardModule.tsx`
- `web/src/App.tsx`
- `web/src/test/routine_stage5.test.ts`
- `docs/ROUTINE_BUILDER_PROGRESS.md`

### Architecture and migration decisions

- No new AI package, web API key, or network dependency was added. The repository already contains Firebase AI on the Android side and advertises a server-side Gemini capability; the WebView uses an optional native bridge when available and remains fully functional offline.
- Templates are stored as a preferences slice so they are covered by the existing full backup/restore path without introducing a competing database or breaking schema 9 payloads.
- Existing shared category IDs and existing Reminder/Contact/Direct Debit IDs are referenced rather than copied. Link repair is non-destructive to the Routine step.
- No storage schema migration was needed; optional Routine fields remain backward-compatible under the existing normalization boundary.

### Dashboard and integration behavior

- Dashboard displays routine counts/progress and links to the existing Routines area.
- Stage 5 deliberately does not add a web API key or install a second AI SDK. The inspected project already has Firebase AI in the Android module and a server-side Gemini capability declaration; the selected optional bridge keeps secrets out of the WebView.
- Reminder-to-routine launch routing and bidirectional Reminder sync prompts still need a follow-up native/web bridge pass; this stage provides persisted Routine-side references and configurable link behavior without silently mutating Reminder schedules.
- Builder link selectors use existing records and do not mutate Reminder, Contact, or Money state automatically.
- Contact links expose `tel:` and `sms:` actions through the integration helper. Reminder synchronization remains opt-in via the link completion behavior; no unrelated schedule is silently changed.

### Tests and validation

- `npm --prefix web run test -- --run src/test/routine_stage5.test.ts` — passed, 3 tests.
- `npm --prefix web run type-check` — passed.
- `npm --prefix web run test -- --run` — passed: 19 test files, 239 tests.
- `npm --prefix web run build` — passed; Vite regenerated the Android WebView bundle.
- Android unit tests remain environment-blocked when no Android SDK is configured.

## Stage 6 implementation

### Completed work

- Added `routineAnalytics.ts` with routine-level completion rate, expected-vs-actual duration, skips, overdue/failed counts, time-of-day distribution, per-step skip/completion stats, bottleneck detection, unrealistic-duration detection, consistency percentage, and streak calculation.
- Added configurable analytics settings contract covering analytics/streak visibility, grace days, skip impact, weekly/monthly goals, gamification mode, and overdue intensity.
- Added quick skip reasons: Forgot, No time, Too tired, Not needed today, Schedule changed, Blocked by something else, and Custom.
- Added routine history display in the builder with recent events, reasons, duration metrics, streak, and supportive duration guidance.
- Added 2/5/10-minute Quick Start controls that start the routine and persist an absolute step timer target.
- Added unified Today-plan aggregation for scheduled routines, due Reminders, and active Direct Debits.
- Added Dashboard “What should I do next?” guidance with an explainable reason, a non-forcing tone, routine progress, and Today-plan preview.
- Added history JSON and CSV export helpers for the next export surface.
- Added Stage 6 tests covering analytics aggregation, skip reasons, streak grace, goals, and Today-plan merging.

### Files changed in Stage 6

- `web/src/services/routineAnalytics.ts`
- `web/src/components/routines/RoutineModule.tsx`
- `web/src/components/dashboard/DashboardModule.tsx`
- `web/src/test/routine_stage6.test.ts`
- `docs/ROUTINE_BUILDER_PROGRESS.md`

### Architecture / safety decisions

- Analytics are derived from persisted Routine occurrences/history and are not duplicated as fragile mutable state.
- Streaks and goals are advisory calculations; they never alter completion or failure outcomes.
- Today-plan merging references existing Reminder and Money records without mutating their schedules.
- Export helpers serialize only routine history/occurrences and contain no external identifiers beyond the persisted local IDs.
- No schema migration was required; all new settings remain optional and backward-compatible.

### Tests and validation

- `npm --prefix web run type-check` — passed.
- `npm --prefix web run test -- --run src/test/routine_stage6.test.ts` — passed: 3 tests.
- `npm --prefix web run test -- --run` — passed: 20 test files, 242 tests.
- `npm --prefix web run build` — passed; Vite regenerated the Android WebView bundle.
- Android unit tests remain environment-blocked when no Android SDK is configured.

### Known issues / remaining work

- Calendar/timeline/graph history navigation, downloadable history UI, editable goals/settings UI, dashboard widget rearrangement/resizing, and full streak/gamification preference persistence remain follow-up polish.
- Minimum Version / Minimum Completed outcome recording needs a dedicated runtime action and analytics event in a later execution refinement.

## Stage 7 implementation

### Completed work

- Added `routineGraph.ts`, an adapter from persisted Routine trees to the existing MindMesh `Node<MeshNodeData>` / `Edge` graph contract. The same routine state therefore drives the list builder, 2D flow view, and existing `SpatialGraph` 3D renderer.
- Added routine visual state mapping for active, current, completed, and upcoming steps. Current steps receive dominant selection styling and animated flow edges; completed steps are dimmed with lower-opacity/dashed paths.
- Added directional sequential edges and distinct dashed dependency edges, including dependency labels for future interaction/tooltips.
- Added persistent manual step positions to the shared graph adapter. Existing routine step positions remain part of the routine aggregate and are not duplicated into a second layout store.
- Added routine-specific visual settings: category-colour inheritance, explicit routine colour, persisted Performance Mode preference, and a `showInSpatialGraph` extension point.
- Replaced the builder’s static graph-only preview with a toggleable 2D flow / 3D explore surface using the existing `SpatialGraph` renderer and global appearance settings. The routine 3D view supports orbit, pan, zoom, active-path animation, and the existing background/node palette.
- Added performance behavior that lowers animation complexity and omits decorative dependency edges while keeping every routine step and sequential flow edge available.
- Added Stage 7 graph adapter regression tests for full-tree mapping, state styling, positions, inheritance, dependencies, and Performance Mode.

### Files changed in Stage 7

- `web/src/types/routine.ts`
- `web/src/types/index.ts`
- `web/src/services/routineGraph.ts`
- `web/src/components/routines/RoutineModule.tsx`
- `web/src/App.tsx`
- `web/src/test/routine_stage7.test.ts`
- `docs/ROUTINE_BUILDER_PROGRESS.md`

### Architecture / safety decisions

- Routine visuals reuse the existing graph renderer and appearance model instead of introducing a parallel canvas, WebGL dependency, or second coordinate system.
- Routine-specific appearance is optional and normalized through the existing routine spread/default path, so pre-Stage 7 records remain valid and continue inheriting global/category styling.
- Performance Mode reduces non-essential visual work only; it never hides the current step, completed steps, or sequential flow needed to understand the routine.
- No migration was required. The optional `Routine.visual` field is backward-compatible with schema 9 and is included automatically in existing routine backup/restore serialization.

### Tests and validation

- `npm --prefix web run type-check` — passed.
- `npm --prefix web run test -- --run src/test/routine_stage7.test.ts` — passed: 2 tests.
- `npm --prefix web run test -- --run` — passed: 21 test files, 244 tests.
- `npm --prefix web run build` — passed; Vite regenerated the Android WebView bundle.
- Android unit tests remain environment-blocked because this workspace has no configured Android SDK.

### Known issues / remaining work

- The shared `SpatialGraph` uses its existing generic node components, so routine-specific dependency explanations are represented in edge metadata but do not yet have a dedicated interaction popover.
- Large-routine LOD currently uses the existing SpatialGraph depth visibility plus Performance Mode’s decorative-edge reduction; a routine-specific collapsed-branch controller and benchmark suite remain future polish.
- Routine graph drag persistence is supported by the existing persisted step positions, but a dedicated pointer-drag editor for the SpatialGraph surface is not enabled; the builder’s 2D flow controls remain the safe editing surface.
- Portrait/landscape and device performance verification still require emulator/device execution; web tests cover deterministic graph output only.

## Stage 8 implementation

### Completed work

- Added `routineTransfer.ts` with standalone Routine JSON export, bulk Routine export, history JSON export, and history CSV export.
- Added import preview before persistence. The preview normalizes the incoming Routine and reports missing categories, Reminders, Contacts, Direct Debits, triggered Routines, and duplicate Routine IDs.
- Added explicit conflict decisions for unlinking, retaining a flagged broken link, choosing an existing category, cancelling, or importing a duplicate. Import never overwrites an existing Routine silently and never drops a link without a reviewed decision.
- Wired Routine Builder controls for single Routine export, history exports, selected bulk export, JSON file selection, conflict preview, and reviewed import.
- Extended full-backup validation summaries with Routine count, active-session count, and Routine history count.
- Hardened transactional restore with a cloned and verified pre-restore safety snapshot. After persistence, Routine IDs and active-session counts are reloaded and compared before restore succeeds; failures roll back to the verified snapshot.
- Preserved full Routine definitions, nested steps, visual settings, schedules, notification settings, templates references, history, occurrences, stats, version history, drafts, archive/trash state, links, and active sessions through the existing full backup serializer.
- Added Stage 8 regression coverage for export formats, missing-link review, duplicate import IDs, routine-heavy active-session/version-history backup restore, malformed routine quarantine, pre-Routine compatibility, and simulated persistence failure with rollback verification.

### Files changed in Stage 8

- `web/src/services/routineTransfer.ts`
- `web/src/components/routines/RoutineModule.tsx`
- `web/src/types/backup.ts`
- `web/src/services/backup.ts`
- `web/src/test/routine_stage8.test.ts`
- `docs/ROUTINE_BUILDER_PROGRESS.md`

### Architecture / migration decisions

- Routine export is intentionally separate from the full MindMesh backup format so a single Routine can be shared without exposing unrelated Contacts, Money, Reminders, or diagnostics data.
- Full backup/restore remains the source of truth for lossless app migration. Routine transfer files are normalized and reviewed before they enter the existing persisted aggregate.
- No schema version change was required. New visual/template/history fields are already optional or part of the existing Routine aggregate and remain compatible with schema 9 and pre-Routine backups.
- Restore verification is deliberately Routine-focused while retaining the existing transactional rollback for all MindMesh state.

### Backup / restore implications

- Current full backups continue to include all Routine source data required for restore.
- Pre-Routine backups with no `data.routines` restore to an empty Routine collection.
- Malformed Routine records generate validation warnings and are quarantined individually during migration; valid Routines and all unrelated MindMesh data continue restoring.
- Active sessions and version snapshots are explicitly covered by the Stage 8 round-trip test.

### Tests and validation

- `npm --prefix web run type-check` — passed.
- `npm --prefix web run test -- --run src/test/routine_stage8.test.ts` — passed: 6 tests.
- `npm --prefix web run type-check` — passed after the rollback regression test was added.
- `npm --prefix web run test -- --run` — passed: 22 test files, 250 tests.
- `npm --prefix web run build` — passed; Vite generated the production bundle and Android WebView assets successfully.
- Android unit tests remain environment-blocked because no Android SDK is configured.
- Android unit tests remain environment-blocked because no Android SDK is configured.

### Unrelated bugs found/fixed

- None found or fixed during Stage 8.

### Known issues / remaining work

- Bulk import of multiple routines currently previews the first routine in a bulk payload; selected bulk export is supported, while multi-routine conflict review needs a later dedicated batch workflow.
- Routine export buttons use the existing browser download path; full backup export continues using the verified Android document writer/File System Access path where available.
- Trash retention policy, dedicated Routine Diagnostics UI, routine version restore UI, and the standalone future-`main` CI workflow remain next-stage work.

## Exact next stage

**Stage 10 — Routine reliability and UX hardening:** exercise Android notification/process/reboot recovery on a configured emulator, add device-level diagnostics for reboot registration and background restrictions, and continue Routine analytics/history and bulk import polish without changing the local-first storage contract.

## Stage 9 implementation

### Completed work

- Confirmed and retained the dedicated Routine Diagnostics tab inside the existing Diagnostics modal. It reports notification permission, alarm capability, schedule registration counts, active/invalid sessions, missing links, schema/migration status, quarantined records, draft recovery, broken links, and Trash retention state.
- Confirmed safe guided repair operations: schedule rebuild/re-registration, stale-session clearing, non-destructive broken-link repair, explicit Trash purge confirmation, prior-version restore, and prior-trash restore. Repair outcomes are re-checked rather than reported from UI labels alone.
- Made malformed Routine records durably inspectable in `mindmesh_routine_quarantine_v1`. Valid routines continue loading; quarantine records are isolated from the main state document and include the original raw record for later repair tooling.
- Kept draft recovery, version snapshots, active sessions, and full-backup rollback behavior intact. No Routine definition is deleted by safe repair operations.
- Added a standalone `routine-builder-ci.yml` workflow. It is independent of the existing workflow and runs the discovered `npm --prefix web` lint, type-check, test, and build commands on `main`, pull requests targeting `main`, and `workflow_dispatch`.
- Added Stage 9 regression tests for durable corruption quarantine, retention-safe Trash cleanup with confirmation, and version restore with a recoverable pre-restore snapshot.

### Files changed in Stage 9

- `web/src/services/storage.ts`
- `web/src/services/routineSafety.ts`
- `web/src/test/routine_stage9.test.ts`
- `.github/workflows/routine-builder-ci.yml`
- `docs/ROUTINE_BUILDER_PROGRESS.md`

### Architecture decisions

- Quarantine is a separate localStorage key so a corrupt Routine cannot prevent the main state document from loading and quarantine metadata does not become an accidental source of truth for valid routines.
- Existing Routine Diagnostics and fixer infrastructure remains the single repair surface; no competing diagnostics screen or persistence layer was introduced.
- Trash purge remains confirmation-gated and retention-based. Version restore creates a new version snapshot before applying the selected prior snapshot, preserving a recoverable path.
- The standalone CI workflow intentionally validates the web product commands only; the existing Android workflow remains untouched and continues to own Android build/test validation.

### Schema / migration changes

- No main storage schema version change. `mindmesh_routine_quarantine_v1` is an optional auxiliary safety store and older pre-Routine state/backups remain compatible.
- Hydration writes only the current quarantine set after normalizing Routine records. It does not overwrite valid Routine data or migrate old unrelated slices.

### Backup / restore implications

- Valid Routine definitions, history, active sessions, drafts, Trash state, and version snapshots remain in the existing full backup format.
- Quarantine records are intentionally not included in normal full backups yet; they are local repair evidence, while valid data remains losslessly backed up. A future quarantine repair/export surface can add an explicit opt-in format without changing the full backup contract.

### Tests and validation

- `npm --prefix web run type-check` — **passed**.
- `npm --prefix web run test -- --run src/test/routine_stage9.test.ts` — **passed: 3 tests**.
- `npm --prefix web run test -- --run` — **passed: 23 test files, 253 tests**.
- `npm --prefix web run build` — **passed**; Vite regenerated the Android WebView bundle.
- Android unit tests remain environment-blocked unless an Android SDK is configured.

### Unrelated bugs found/fixed

- Fixed the data-safety gap where malformed Routine records were logged and discarded from the normalized view but could not be inspected after hydration.

### Known issues / remaining work

- Android alarm, process-death, app-closed, locked-screen, and reboot-rescheduling behavior still needs configured emulator/device verification.
- Quarantine records are inspectable through Routine Diagnostics but do not yet have a user-facing record repair/import action; they remain safely isolated.
- Bulk Routine import conflict review, advanced history browsing, and full analytics/history visualization remain later work.

## Last good commit

No stage commit was created in this workspace. Freebuff’s Changes panel owns commit delivery; review and commit only the intended Stage 9 files and earlier uncommitted Routine Builder files that belong to the product change.
