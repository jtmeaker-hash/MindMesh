<p align="center">
  <img src="app/src/main/res/mipmap-xxxhdpi/ic_launcher.webp" alt="MindMesh" width="150" />
</p>

<h1 align="center">MindMesh</h1>

<p align="center">
  <strong>A visual Android reminder, routine, life-management and personal organisation app built around an explorable node mesh instead of a traditional checklist.</strong>
</p>

<p align="center">
  <a href="https://github.com/jtmeaker-hash/MindMesh/actions/workflows/main-release.yml">
    <img src="https://github.com/jtmeaker-hash/MindMesh/actions/workflows/main-release.yml/badge.svg" alt="Release" />
  </a>
  <a href="https://github.com/jtmeaker-hash/MindMesh/actions/workflows/pr-debug.yml">
    <img src="https://github.com/jtmeaker-hash/MindMesh/actions/workflows/pr-debug.yml/badge.svg" alt="PR Validation" />
  </a>
  <img src="https://img.shields.io/badge/Android-7.0%2B-brightgreen" alt="Android 7.0+" />
  <img src="https://img.shields.io/badge/App-1.4.0-7c3aed" alt="MindMesh 1.4.0" />
  <img src="https://img.shields.io/badge/React-TypeScript-3178c6" alt="React / TypeScript" />
  <img src="https://img.shields.io/badge/Kotlin-Jetpack%20Compose-blueviolet" alt="Kotlin / Jetpack Compose" />
</p>

---

## About

MindMesh is a visual organisation system designed for people who do not naturally think in flat lists.

Instead of treating reminders, routines, projects and everyday information as isolated rows, MindMesh turns them into a connected graph. A central node branches into categories, categories branch into reminders or routines, and those items can branch again into subtasks, steps and related information.

The result is a workspace that behaves more like a **map of what is going on in your life** than a conventional to-do app.

```text
                         ┌─────────────┐
                         │  MindMesh   │
                         └──────┬──────┘
                ┌───────────────┼────────────────┐
                │               │                │
          ┌─────▼─────┐   ┌────▼────┐     ┌─────▼─────┐
          │   Car     │   │ Projects │     │  Health   │
          └─────┬─────┘   └────┬─────┘     └─────┬─────┘
                │               │                │
        ┌───────▼──────┐   ┌────▼────────┐   ┌───▼────────┐
        │ Registration │   │  MindMesh   │   │  Dentist   │
        └───────┬──────┘   └────┬────────┘   └────────────┘
                │               │
          ┌─────▼─────┐   ┌────▼───────────┐
          │ Pay Rego  │   │ Fix / Improve  │
          └───────────┘   └────────────────┘
```

> [!IMPORTANT]
> MindMesh is under active development. Features, storage schemas, UI behaviour, diagnostics and native Android integrations may change between builds.

---

## Core Features

### Visual Mesh

The visual mesh is the centre of MindMesh.

- Central MindMesh root node.
- User-created categories and nested subcategories.
- Reminders displayed as connected nodes rather than list rows.
- Subtasks branching from their parent reminder.
- Persistent node-position data.
- Active and completed task states.
- Category-driven organisation for larger meshes.
- Interactive graph rendering powered by XYFlow.
- Visual structure intended to scale from simple reminders into larger personal systems.

### Reminders & Tasks

MindMesh combines visual organisation with practical reminder behaviour.

- Create, edit and complete reminders.
- Due dates and times.
- Categories and subcategories.
- Multi-step subtasks.
- Recurring reminder support.
- Completed-task history.
- Overdue tracking.
- Reminder editing without rebuilding the task.
- Optional AI-assisted reminder enhancement architecture.
- Dashboard statistics generated from reminder activity.

### Native Android Notifications

MindMesh does not rely on browser-only notifications inside the Android app.

The Android layer contains a dedicated native notification bridge and scheduler that can:

- Schedule reminder notifications through Android.
- Restore scheduled notifications after app startup or updates.
- Handle Android runtime notification permission.
- Open the relevant reminder from a notification.
- Pass notification actions back into the MindMesh web UI.
- Keep notification events queued until the embedded app is ready.

---

## Smart Assistance (local Smart Engine)

MindMesh has a built-in Smart Engine that provides the app's AI-like assistance without an external AI service.

It is deliberately **not** a generative model. It is a deterministic, rule-based interpreter that:

- Runs entirely on-device and works offline.
- Needs no API key and makes no network request for interpretation.
- Never writes anything on its own: every change is proposed first, shown as a preview, and applied only after the user confirms it.
- Asks for missing or ambiguous details instead of guessing, and refuses to write a low-confidence proposal.
- Never silently alters reminders, contacts, financial entries, categories, settings or notifications.

Smart Engine behaviour is unit-tested and separate from the UI so it stays predictable, and its preferences are stored and backed up with the rest of the app state.

What it supports today:

- Reminder title/description enhancement for the existing enhancement UI.
- Reminder summaries and structured graph-view summary facts.
- Natural-language reminder creation and editing proposals.
- Date, relative-date and recurrence parsing (weekly, fortnightly, monthly, quarterly, yearly and every-X).
- Category, subcategory and subtask suggestions.
- Category and subcategory creation proposals.
- Bill/direct-debit creation proposals, money-entry classification and bill-category suggestion.
- Pay-cycle, upcoming-bills and remaining-money calculations from stored money data.
- Dashboard, contact and diagnostics answers built only from data already on the device.

Assistance is reachable from the header menu under **Smart Assistance**, where it can be previewed, confirmed or cancelled. Each capability has its own toggle in **Settings → Smart**, and confirmation for writes is always required and cannot be turned off.

---

## Routine Builder

MindMesh includes a dedicated Routine system for repeatable workflows that are more structured than a single reminder.

Routine support includes:

- Multi-step routines.
- Task, sub-routine, condition and branch step types.
- Daily, weekly, monthly and custom recurrence.
- Runtime routine sessions.
- Child-step completion rules.
- Routine history and statistics.
- Draft recovery.
- Broken-link handling.
- Routine transfer/import-export support.
- Trash and recovery handling.
- Diagnostics and quarantine support for malformed routine data.
- AI proposal architecture for assisted routine editing.
- Visual routine graph generation using the MindMesh node system.

The Routine Builder has its own CI coverage while also remaining part of the wider app regression surface.

---

## Money Management

MindMesh is expanding beyond task management into practical personal finance tracking.

The Money module currently has dedicated navigation for:

- **Overview**
- **Bills**
- **Income**
- **Extra Income**
- **Tips**
- **Categories**
- **Settings**

### Bills & Direct Debits

Bill data can be used to track recurring obligations with fields and behaviour such as:

- Title and amount.
- Custom categories.
- Payment frequency.
- Next payment date.
- Due-by date.
- Optional end date.
- Notes.
- Active or paused state.
- Notification settings.
- Optional links back into the reminder system.

### Income

Income tracking is designed to support both fixed and casual work.

Casual-pay configuration is being expanded around real-world rate rules, including:

- Base pay.
- Time-of-day rate changes.
- Weekday evening rates.
- Saturday rates.
- Sunday rates.
- Custom day/time rules.
- Pay-cycle tracking.
- Pay-cycle overrides.

### Extra Income & Tips

MindMesh can also represent irregular money that does not fit a normal salary cycle.

Examples include:

- Extra shifts.
- Cash jobs.
- Marketplace sales.
- Freelance work.
- Refunds.
- Side-hustle income.
- Hospitality tips.

### General Expenses

General expense tracking is intended for spending that has no exact fixed amount or reliable repeat interval, such as fuel, groceries, maintenance and unexpected costs.

---

## Dashboard

The Dashboard turns stored MindMesh data into a quick operational view.

Tracked or derived information includes:

- Active reminders.
- Completed reminders.
- Overdue reminders.
- Oldest overdue item.
- Tasks completed today.
- Recurring-task activity.
- Completion statistics.
- Category-level performance.
- Money configuration and financial summaries.
- Upcoming obligations.

The goal is not to replace the mesh — it is to provide a fast summary when you need the numbers instead of the map.

---

## Contacts

MindMesh also includes a local contact-management module.

Contact functionality includes:

- Contact name and display name.
- Primary and secondary phone numbers.
- Email.
- Address.
- Birthday.
- Relationship.
- Notes.
- Custom contact categories.
- Search and sorting.
- Local contact import architecture.
- Duplicate detection and merge handling.
- Reminder integration.
- Backup coverage for contacts, categories and relationship data.

---

## Backup & Restore

MindMesh treats backup compatibility as core functionality rather than an afterthought.

The current backup format stores the wider application state, including:

- Categories.
- Reminders.
- Routines.
- Node positions.
- Money data.
- Contacts.
- Contact categories.
- Contact relationships.
- Appearance configuration.
- Notification settings.
- Notification history.
- Preferences.
- Diagnostics preferences.
- Statistics.
- Smart Assistance preferences.

Current backup format version: **3**

Current internal app data version documented by the backup service: **1.4.0**

### Native Android Export

On Android, backup export uses the system document picker rather than pretending a file was exported inside the WebView.

The native bridge:

1. Opens Android's save-document flow.
2. Lets the user choose the destination.
3. Writes the MindMesh JSON backup to the returned URI.
4. Verifies the native result.
5. Returns status back to the MindMesh interface.

Restore uses Android's file picker and passes the selected backup file into the embedded app for validation and migration.

### Compatibility Contract

New persisted features are expected to update:

- Backup serialization.
- Restore/import behaviour.
- Migration logic where required.
- Safe defaults for older data.
- Backup and restore tests.

MindMesh should validate and migrate imported data before replacing the user's current state.

---

## Diagnostics & Fixer

MindMesh contains an on-device diagnostics system designed to make real-device problems easier to identify.

Diagnostics cover areas such as:

- Build and app version.
- Storage readability.
- Schema version.
- Backup health.
- Notification state.
- Appearance configuration.
- Navigation configuration.
- Money storage.
- Routine integrity.
- Startup state.
- Runtime logs.

The app can export diagnostic reports as text or JSON.

A dedicated fixer layer can also identify supported problems and apply targeted repairs rather than requiring the user to wipe all app data.

---

## Appearance & Visual Customisation

MindMesh is built around a strong visual identity because the graph itself is part of how the app is used.

Appearance work includes:

- Custom node colours.
- Custom branch / connection colours.
- Separate connection brightness and contrast controls.
- Collision-aware graph layout that keeps nodes and their labels from overlapping.
- Zoom-aware level of detail that simplifies node content and connection intensity as the camera pulls back.
- Aqua styling.
- Orange styling.
- Matrix-green styling.
- Dark and light backgrounds.
- User-selected background imagery.
- Void-style visual themes.
- Optional falling-code / Matrix-inspired background.
- 3D-inspired mesh presentation and depth work.

The long-term direction is an explorable digital space rather than a conventional productivity dashboard with a graph bolted onto it.

---

## App Architecture

MindMesh uses a hybrid Android architecture.

```text
                 MindMesh UI
                     │
                     ▼
          React 18 + TypeScript
                     │
                     ▼
          XYFlow Visual Node Graph
                     │
                     ▼
              Vite Web Build
                     │
                     ▼
      Bundled Android WebView Assets
                     │
          ┌──────────┴──────────┐
          │                     │
          ▼                     ▼
 Kotlin / Compose Host     Local Web State
          │
   ┌──────┼─────────┐
   │      │         │
   ▼      ▼         ▼
Native   Backup   Android
Alerts   Bridge   File Picker
```

The React application provides the majority of MindMesh's interactive UI and graph behaviour.

The Android host uses Kotlin, Jetpack Compose and `WebViewAssetLoader` to run the bundled interface locally while exposing native functionality through dedicated bridges.

This gives MindMesh:

- A fast React-based graph UI.
- Native Android notification scheduling.
- Native file-picker based backup/export.
- Android lifecycle integration.
- A local-first runtime that does not require a hosted web app for normal operation.

---

## Technology

MindMesh currently uses:

- **React 18**
- **TypeScript**
- **Vite**
- **XYFlow / React Flow**
- **Vitest**
- **Testing Library**
- **Lucide React**
- **Kotlin**
- **Jetpack Compose / Material 3**
- **Android WebView / WebViewAssetLoader**
- **Android native notification scheduling**
- **Room**
- **Kotlin Coroutines**
- **Retrofit + OkHttp**
- **Moshi**
- **Firebase platform dependencies**
- **Robolectric**
- **Roborazzi**
- **GitHub Actions**

---

## Requirements

### To run the Android app

- Android 7.0 / API 24 or newer.
- Notification permission on Android versions that require it.
- Local storage available to the app.
- Internet access only for features that use external services; core local MindMesh data is designed around device storage.

The Android project currently targets API 36.

### To build from source

Recommended environment:

- Git
- Node.js 22+
- npm
- JDK 21
- Android SDK
- Android Studio for normal Android development

---

## Build From Source

Clone the repository:

```bash
git clone https://github.com/jtmeaker-hash/MindMesh.git
cd MindMesh
```

Install the web dependencies:

```bash
npm ci --prefix web
```

Run the web app locally:

```bash
npm --prefix web run dev
```

Run lint:

```bash
npm --prefix web run lint
```

Run TypeScript checking:

```bash
npm --prefix web run type-check
```

Run the web test suite:

```bash
npm --prefix web run test
```

Create the production web bundle:

```bash
npm --prefix web run build
```

Run Android unit tests:

```bash
./gradlew :app:testDebugUnitTest
```

Build a debug APK:

```bash
./gradlew assembleDebug
```

The APK will be created under:

```text
app/build/outputs/apk/debug/
```

Build a signed release APK:

```bash
./gradlew assembleRelease
```

The release build reuses the repository's existing signing configuration (`app/build.gradle.kts` → `signingConfigs.release`), which reads the `KEYSTORE_PATH`, `STORE_PASSWORD` and `KEY_PASSWORD` environment variables and defaults the keystore to `my-upload-key.jks` in the repository root. The signed APK is created under:

```text
app/build/outputs/apk/release/
```

On Windows, use `gradlew.bat` instead of `./gradlew`.

---

## CI / GitHub Actions

MindMesh separates release validation from pull request validation. Debug APKs are never built on `main`, and release APKs are never built for pull requests.

### Main — Build + Test + Release APK

```text
.github/workflows/main-release.yml
```

Triggered by pushes to `main` (merged pull requests) and by manual dispatch. This is the authoritative release validation workflow and the only workflow that builds a release APK. It performs:

1. Dependency installation.
2. ESLint.
3. TypeScript type checking.
4. Required and full regression web test suite (Vitest).
5. Production Vite build, bundled into the Android WebView assets.
6. Android unit tests.
7. Release signing validation using repository secrets, which are never printed.
8. Signed release APK build plus signature verification.
9. Release APK artifact upload.

Documentation-only pushes are ignored, so an automated README commit cannot trigger a repeated release build.

### Pull Requests — Build + Test + Debug APK

```text
.github/workflows/pr-debug.yml
```

Applies automatically to every pull request that targets `main` when the pull request is opened, reopened, synchronised with new commits, or updated. It runs web lint, type checking, the required and regression test suites, the production web bundle build, Android unit tests and a debug APK build, then uploads the debug APK as a workflow artifact. It never builds a release APK and never edits `README.md`.

### README — Update After Merge

```text
.github/workflows/readme-update.yml
```

Runs once when a pull request is merged into `main`. While a pull request is open the README is left alone: the pull request workflow keeps a pending documentation summary in a single sticky pull request comment that is refreshed in place on every push instead of being duplicated. After the merge, this workflow takes the final summary and inserts one entry into the managed **Recent Merged Changes** section, preserving every other README section.

---

## Project Structure

```text
MindMesh/
├── .claude/
│   └── skills/
│       └── limitation-fixer/
├── .github/
│   └── workflows/
├── app/
│   └── src/main/
│       ├── assets/web/          # Bundled production React app
│       ├── java/com/example/
│       │   ├── backup/          # Native backup/export bridge
│       │   ├── notifications/   # Native Android notification system
│       │   └── ui/              # Compose host/theme
│       └── res/
├── docs/
│   ├── ROUTINE_BUILDER_PROGRESS.md
│   └── persistence-and-backups.md
├── web/
│   ├── src/
│   │   ├── components/
│   │   ├── services/
│   │   ├── types/
│   │   └── utils/
│   └── package.json
├── build.gradle.kts
├── settings.gradle.kts
└── README.md
```

---

## Development Rules

MindMesh development follows a few important principles:

1. **Do not rebuild the application from scratch to add a feature.**
2. **Preserve existing reminder behaviour when expanding other systems.**
3. **Treat stored user data and backup compatibility as critical.**
4. **New persisted data must be represented in backup and restore logic.**
5. **Native behaviour must be genuinely native when the feature depends on Android capabilities.**
6. **Run whole-app regression coverage, not only tests for the feature being edited.**
7. **Prefer targeted migration and repair over destructive resets.**
8. **Keep web and Android bridge contracts in sync.**

---

## Development Status

MindMesh is evolving quickly.

Recent development has focused heavily on:

- Mobile layout and rendering reliability.
- Routine Builder expansion.
- App-wide regression coverage.
- Reminder notification reliability.
- Native backup export and restore.
- Full-state backup compatibility.
- On-device diagnostics and automated fixes.
- Contact management and local contact importing.
- Money-management expansion.
- Casual pay-rate modelling.
- General expenses.
- Dashboard statistics.
- Visual customisation and 3D-inspired presentation.
- The local Smart Engine and Smart Assistance surface.
- Preserving compatibility while the storage schema grows.

Bug reports are most useful when they include:

- Reproducible steps.
- Device and Android version.
- MindMesh app/build version.
- Exported diagnostics.
- Relevant screenshots.
- Whether the problem survives an app restart.

---

## Recent Merged Changes

This section is maintained automatically. When a pull request is merged into `main`, the repository's README workflow inserts one entry describing the merged change, grouped from the pull request rather than from individual commits. Entries are never duplicated, and no other part of this README is rewritten.

<!-- mindmesh-release-notes:start -->
<!-- mindmesh-release-notes:end -->

---

## Contributing

Contributions, testing, focused bug reports and pull requests are welcome.

A useful contribution should ideally:

1. Describe the problem clearly.
2. Keep unrelated changes out of the same pull request.
3. Preserve working reminder, notification and backup behaviour.
4. Add or update tests where practical.
5. Run the web lint, type-check and test suites.
6. Run Android unit tests.
7. Confirm that the debug APK builds successfully.
8. Check backup compatibility when persisted models change.

---

## Repository

**GitHub:** https://github.com/jtmeaker-hash/MindMesh

---

## License

A project licence has not yet been specified in this repository.

Add a `LICENSE` file before treating MindMesh as licensed for redistribution or reuse.

---

<p align="center">
  <strong>MindMesh — turn reminders, routines, money and everyday life into one connected visual system.</strong>
</p>
