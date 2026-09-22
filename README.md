�
￼ 

�
MindMesh

�
A visual Android reminder, routine, life-management and personal organisation app built around an explorable node mesh instead of a traditional checklist. 

�
￼ ￼ ￼ ￼ ￼ ￼ 

About
MindMesh is a visual organisation system designed for people who do not naturally think in flat lists.
Instead of treating reminders, routines, projects and everyday information as isolated rows, MindMesh turns them into a connected graph. A central node branches into categories, categories branch into reminders or routines, and those items can branch again into subtasks, steps and related information.
The result is a workspace that behaves more like a map of what is going on in your life than a conventional to-do app.
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
[!IMPORTANT] MindMesh is under active development. Features, storage schemas, UI behaviour, diagnostics and native Android integrations may change between builds.
Core Features
Visual Mesh
The visual mesh is the centre of MindMesh.
Central MindMesh root node.
User-created categories and nested subcategories.
Reminders displayed as connected nodes rather than list rows.
Subtasks branching from their parent reminder.
Persistent node-position data.
Active and completed task states.
Category-driven organisation for larger meshes.
Interactive graph rendering powered by XYFlow.
Visual structure intended to scale from simple reminders into larger personal systems.
Reminders & Tasks
MindMesh combines visual organisation with practical reminder behaviour.
Create, edit and complete reminders.
Due dates and times.
Categories and subcategories.
Multi-step subtasks.
Recurring reminder support.
Completed-task history.
Overdue tracking.
Reminder editing without rebuilding the task.
Optional AI-assisted reminder enhancement architecture.
Dashboard statistics generated from reminder activity.
Native Android Notifications
MindMesh does not rely on browser-only notifications inside the Android app.
The Android layer contains a dedicated native notification bridge and scheduler that can:
Schedule reminder notifications through Android.
Restore scheduled notifications after app startup or updates.
Handle Android runtime notification permission.
Open the relevant reminder from a notification.
Pass notification actions back into the MindMesh web UI.
Keep notification events queued until the embedded app is ready.
Routine Builder
MindMesh includes a dedicated Routine system for repeatable workflows that are more structured than a single reminder.
Routine support includes:
Multi-step routines.
Task, sub-routine, condition and branch step types.
Daily, weekly, monthly and custom recurrence.
Runtime routine sessions.
Child-step completion rules.
Routine history and statistics.
Draft recovery.
Broken-link handling.
Routine transfer/import-export support.
Trash and recovery handling.
Diagnostics and quarantine support for malformed routine data.
AI proposal architecture for assisted routine editing.
Visual routine graph generation using the MindMesh node system.
The Routine Builder has its own CI coverage while also remaining part of the wider app regression surface.
Money Management
MindMesh is expanding beyond task management into practical personal finance tracking.
The Money module currently has dedicated navigation for:
Overview
Bills
Income
Extra Income
Tips
Categories
Settings
Bills & Direct Debits
Bill data can be used to track recurring obligations with fields and behaviour such as:
Title and amount.
Custom categories.
Payment frequency.
Next payment date.
Due-by date.
Optional end date.
Notes.
Active or paused state.
Notification settings.
Optional links back into the reminder system.
Income
Income tracking is designed to support both fixed and casual work.
Casual-pay configuration is being expanded around real-world rate rules, including:
Base pay.
Time-of-day rate changes.
Weekday evening rates.
Saturday rates.
Sunday rates.
Custom day/time rules.
Pay-cycle tracking.
Pay-cycle overrides.
Extra Income & Tips
MindMesh can also represent irregular money that does not fit a normal salary cycle.
Examples include:
Extra shifts.
Cash jobs.
Marketplace sales.
Freelance work.
Refunds.
Side-hustle income.
Hospitality tips.
General Expenses
General expense tracking is intended for spending that has no exact fixed amount or reliable repeat interval, such as fuel, groceries, maintenance and unexpected costs.
Dashboard
The Dashboard turns stored MindMesh data into a quick operational view.
Tracked or derived information includes:
Active reminders.
Completed reminders.
Overdue reminders.
Oldest overdue item.
Tasks completed today.
Recurring-task activity.
Completion statistics.
Category-level performance.
Money configuration and financial summaries.
Upcoming obligations.
The goal is not to replace the mesh — it is to provide a fast summary when you need the numbers instead of the map.
Contacts
MindMesh also includes a local contact-management module.
Contact functionality includes:
Contact name and display name.
Primary and secondary phone numbers.
Email.
Address.
Birthday.
Relationship.
Notes.
Custom contact categories.
Search and sorting.
Local contact import architecture.
Duplicate detection and merge handling.
Reminder integration.
Backup coverage for contacts, categories and relationship data.
Backup & Restore
MindMesh treats backup compatibility as core functionality rather than an afterthought.
The current backup format stores the wider application state, including:
Categories.
Reminders.
Routines.
Node positions.
Money data.
Contacts.
Contact categories.
Contact relationships.
Appearance configuration.
Notification settings.
Notification history.
Preferences.
Diagnostics preferences.
Statistics.
Current backup format version: 3
Current internal app data version documented by the backup service: 1.4.0
Native Android Export
On Android, backup export uses the system document picker rather than pretending a file was exported inside the WebView.
The native bridge:
Opens Android's save-document flow.
Lets the user choose the destination.
Writes the MindMesh JSON backup to the returned URI.
Verifies the native result.
Returns status back to the MindMesh interface.
Restore uses Android's file picker and passes the selected backup file into the embedded app for validation and migration.
Compatibility Contract
New persisted features are expected to update:
Backup serialization.
Restore/import behaviour.
Migration logic where required.
Safe defaults for older data.
Backup and restore tests.
MindMesh should validate and migrate imported data before replacing the user's current state.
Diagnostics & Fixer
MindMesh contains an on-device diagnostics system designed to make real-device problems easier to identify.
Diagnostics cover areas such as:
Build and app version.
Storage readability.
Schema version.
Backup health.
Notification state.
Appearance configuration.
Navigation configuration.
Money storage.
Routine integrity.
Startup state.
Runtime logs.
The app can export diagnostic reports as text or JSON.
A dedicated fixer layer can also identify supported problems and apply targeted repairs rather than requiring the user to wipe all app data.
Appearance & Visual Customisation
MindMesh is built around a strong visual identity because the graph itself is part of how the app is used.
Appearance work includes:
Custom node colours.
Custom branch / connection colours.
Aqua styling.
Orange styling.
Matrix-green styling.
Dark and light backgrounds.
User-selected background imagery.
Void-style visual themes.
Optional falling-code / Matrix-inspired background.
3D-inspired mesh presentation and depth work.
The long-term direction is an explorable digital space rather than a conventional productivity dashboard with a graph bolted onto it.
App Architecture
MindMesh uses a hybrid Android architecture.
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
The React application provides the majority of MindMesh's interactive UI and graph behaviour.
The Android host uses Kotlin, Jetpack Compose and WebViewAssetLoader to run the bundled interface locally while exposing native functionality through dedicated bridges.
This gives MindMesh:
A fast React-based graph UI.
Native Android notification scheduling.
Native file-picker based backup/export.
Android lifecycle integration.
A local-first runtime that does not require a hosted web app for normal operation.
Technology
MindMesh currently uses:
React 18
TypeScript
Vite
XYFlow / React Flow
Vitest
Testing Library
Lucide React
Kotlin
Jetpack Compose / Material 3
Android WebView / WebViewAssetLoader
Android native notification scheduling
Room
Kotlin Coroutines
Retrofit + OkHttp
Moshi
Firebase platform dependencies
Robolectric
Roborazzi
GitHub Actions
Requirements
To run the Android app
Android 7.0 / API 24 or newer.
Notification permission on Android versions that require it.
Local storage available to the app.
Internet access only for features that use external services; core local MindMesh data is designed around device storage.
The Android project currently targets API 36.
To build from source
Recommended environment:
Git
Node.js 22+
npm
JDK 21
Android SDK
Android Studio for normal Android development
Build From Source
Clone the repository:
git clone https://github.com/jtmeaker-hash/MindMesh.git
cd MindMesh
Install the web dependencies:
npm ci --prefix web
Run the web app locally:
npm --prefix web run dev
Run lint:
npm --prefix web run lint
Run TypeScript checking:
npm --prefix web run type-check
Run the web test suite:
npm --prefix web run test
Create the production web bundle:
npm --prefix web run build
Run Android unit tests:
./gradlew :app:testDebugUnitTest
Build a debug APK:
./gradlew assembleDebug
The APK will be created under:
app/build/outputs/apk/debug/
On Windows, use gradlew.bat instead of ./gradlew.
CI / GitHub Actions
MindMesh currently includes multiple GitHub Actions workflows.
Main CI
.github/workflows/build.yml
The primary workflow runs on pushes and pull requests targeting main and performs:
Dependency installation.
ESLint.
TypeScript type checking.
Environment diagnostics.
Vitest unit tests.
Production Vite build.
Android unit tests.
Android debug APK build.
Debug APK artifact upload.
Routine Builder CI
.github/workflows/routine-builder-ci.yml
Used for focused Routine Builder validation.
Regression Workflow
.github/workflows/mindmesh-routine-regression.yml
Regression coverage exists to catch wider behavioural breakage alongside feature-specific CI.
Project Structure
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
Development Rules
MindMesh development follows a few important principles:
Do not rebuild the application from scratch to add a feature.
Preserve existing reminder behaviour when expanding other systems.
Treat stored user data and backup compatibility as critical.
New persisted data must be represented in backup and restore logic.
Native behaviour must be genuinely native when the feature depends on Android capabilities.
Run whole-app regression coverage, not only tests for the feature being edited.
Prefer targeted migration and repair over destructive resets.
Keep web and Android bridge contracts in sync.
Development Status
MindMesh is evolving quickly.
Recent development has focused heavily on:
Mobile layout and rendering reliability.
Routine Builder expansion.
App-wide regression coverage.
Reminder notification reliability.
Native backup export and restore.
Full-state backup compatibility.
On-device diagnostics and automated fixes.
Contact management and local contact importing.
Money-management expansion.
Casual pay-rate modelling.
General expenses.
Dashboard statistics.
Visual customisation and 3D-inspired presentation.
Preserving compatibility while the storage schema grows.
Bug reports are most useful when they include:
Reproducible steps.
Device and Android version.
MindMesh app/build version.
Exported diagnostics.
Relevant screenshots.
Whether the problem survives an app restart.
Contributing
Contributions, testing, focused bug reports and pull requests are welcome.
A useful contribution should ideally:
Describe the problem clearly.
Keep unrelated changes out of the same pull request.
Preserve working reminder, notification and backup behaviour.
Add or update tests where practical.
Run the web lint, type-check and test suites.
Run Android unit tests.
Confirm that the debug APK builds successfully.
Check backup compatibility when persisted models change.
Repository
GitHub: https://github.com/jtmeaker-hash/MindMesh
License
A project licence has not yet been specified in this repository.
Add a LICENSE file before treating MindMesh as licensed for redistribution or reuse.
�
MindMesh — turn reminders, routines, money and everyday life into one connected visual system. 
