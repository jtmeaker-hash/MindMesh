# MindMesh

MindMesh is a visual reminder, planning, and personal-management app built around a connected node graph instead of a traditional checklist.

The idea is simple: start with one central **MindMesh** node, branch into categories such as **Car**, **Health**, **Errands**, **Projects**, or **Money**, then branch again into reminders, subtasks, routines, and supporting information.

MindMesh is designed to make tasks feel more connected and easier to understand at a glance.

---

## What MindMesh is

Traditional task apps usually show information as lists.

MindMesh instead represents information as a visual structure:

```text
MindMesh
├── Car
│   ├── Registration
│   │   ├── Pay rego
│   │   └── Book inspection
│   └── Service
├── Health
│   ├── Dentist
│   └── Medication
├── Projects
│   └── MindMesh
│       ├── Fix notifications
│       ├── Improve backup system
│       └── UI upgrades
└── Money
    ├── Income
    ├── Direct Debits
    ├── Expenses
    └── Tips
```

The goal is to give users a more spatial, visual way to manage reminders and everyday life.

---

## Core Features

### Visual node-based task system

- Central MindMesh node
- User-created categories
- Reminders branching from categories
- Subtasks branching from reminders
- Nested subcategories
- Active and completed task views
- Visual connections between related information
- Expandable structure designed for larger personal knowledge/task networks

### Reminders

MindMesh supports reminder-based task management with features being developed around:

- Due dates and times
- Notification support
- Editable reminders
- Reminder descriptions and summaries
- Subtasks
- Recurring reminders
- Categories and subcategories
- Completed-task history
- Optional AI-assisted description enhancement
- Reminder statistics and dashboard data

### Completed tasks

Completed reminders are separated from the active task tree so the main workspace stays useful instead of becoming overloaded.

Completed tasks can be browsed through a secondary structure organised by category.

### Routines

Routine functionality is being expanded to support reusable and repeating task structures while keeping the same node-based MindMesh layout.

---

## Money Management

MindMesh is also being expanded into a lightweight personal money-management system.

Planned and in-progress areas include:

### Overview

A high-level view of upcoming bills, income, remaining money, expenses, and recent activity.

### Direct Debits & Bills

Bills can include:

- Title
- Amount
- Category
- Frequency
- Next payment date
- Payment due-by date
- Optional end date
- Notes
- Active or paused status
- Notification settings
- Optional linked MindMesh reminder

Supported recurrence is intended to include:

- Weekly
- Fortnightly
- Monthly
- Quarterly
- Yearly
- Every X days
- Every X weeks
- Every X months
- Custom recurrence

### Income

Income tracking is being designed for both fixed and casual work.

Casual pay configuration is intended to support custom rates based on:

- Day of week
- Time of day
- Weekday base rate
- Evening rates
- Saturday rates
- Sunday rates
- Other custom pay rules

### Extra Income

Track irregular income such as:

- Extra shifts
- Cash jobs
- One-off payments
- Other additional income

Entries can be titled and categorised.

### Tips

Dedicated tip tracking for hospitality and other tip-based work.

### General Expenses

Support is being added for expenses that do not always have a fixed amount or reliable recurrence, such as:

- Fuel
- Groceries
- Maintenance
- Unexpected costs
- Miscellaneous spending

---

## Dashboard

The dashboard is intended to provide quick visual information across the app.

Metrics include or are planned to include:

- Completed reminders
- Uncompleted reminders
- Active reminders
- Overdue reminders
- Recurring reminders
- Average completion time
- Completion statistics by category
- Upcoming bills
- Income and expense summaries
- Money remaining after upcoming bills

---

## Contacts

MindMesh includes / is being expanded with personal contact-management features such as:

- Name
- Phone number
- Address
- Relationship
- Contact photo
- Local contact import
- Category and subcategory organisation

---

## Backup & Restore

A major project goal is that user data remains portable across app updates.

The backup system is designed to preserve the full MindMesh state, including areas such as:

- Categories
- Subcategories
- Reminders
- Subtasks
- Completed tasks
- Routines
- Settings
- Appearance preferences
- Statistics
- Contacts
- Money-management data
- Other locally stored MindMesh data

Backward compatibility is important: existing backups should continue working as new features and schema versions are introduced.

---

## Diagnostics

MindMesh includes diagnostics aimed at making the app easier to debug on real devices.

Diagnostics can cover areas such as:

- App/build information
- Schema versions
- Startup checks
- Notification configuration
- Theme/customisation checks
- Storage and backup behaviour
- Feature integrity
- Regression checks

The project also uses automated workflows to catch regressions before changes are merged or released.

---

## Customisation

MindMesh is being designed with a strong visual customisation layer.

Planned and implemented styling options may include:

- Custom node colours
- Custom connection colours
- Aqua theme
- Orange theme
- Matrix green theme
- Light or dark backgrounds
- Imported background images
- Void-style visual mode
- Optional falling-code / Matrix-style background
- 3D-inspired visual presentation

The long-term visual direction is an explorable connected space rather than a flat checklist UI.

---

## Local-First Approach

MindMesh currently focuses heavily on local-device functionality.

The project aims to keep core features useful without requiring a permanent cloud connection.

Important priorities include:

- Local persistence
- Reliable backup/export
- Restore support
- Notification reliability
- App-update compatibility
- Minimal dependence on external services for core reminder functionality

Cloud sync and broader multi-device features can be added separately without replacing the local-first foundation.

---

## Project Structure

The repository contains the MindMesh application, Android integration, web/UI code, automated tests, diagnostics, and GitHub workflows.

Typical areas you may encounter include:

```text
.github/
  workflows/

web/
  source files
  tests
  package.json

android / native project files
  Kotlin / Gradle configuration

README.md
```

The exact structure may evolve as MindMesh grows.

---

## Development

Clone the repository:

```bash
git clone <YOUR_REPOSITORY_URL>
cd MindMesh
```

Install web dependencies where required:

```bash
npm --prefix web install
```

Run web tests:

```bash
npm --prefix web run test
```

Android builds are handled through the project's Gradle configuration and GitHub Actions workflows.

For local Android builds, use the Gradle wrapper from the appropriate Android project directory, for example:

```bash
./gradlew assembleDebug
```

On Windows:

```powershell
gradlew.bat assembleDebug
```

Check the repository's current workflow files and package scripts before building, as commands may change while development is active.

---

## Development Principles

Changes to MindMesh should follow a few important rules:

1. **Do not rebuild the app from scratch when adding features.**
2. **Preserve existing reminder functionality.**
3. **Keep backups compatible across updates wherever possible.**
4. **Reuse existing architecture, components, state management, routing, and persistence before introducing replacements.**
5. **Run regression checks for the entire app, not only the feature currently being changed.**
6. **Treat notification reliability, backup integrity, and stored user data as critical functionality.**
7. **Avoid UI-only implementations for features that are expected to persist or perform native actions.**

---

## Status

MindMesh is under active development.

Some sections described in this README are already implemented, while others are actively being expanded or refined.

Current development work has included areas such as:

- Reminder and category systems
- Android builds
- Notifications
- Backup/export behaviour
- Diagnostics
- UI rendering and layout fixes
- Routine improvements
- Contacts
- Money management
- Dashboard functionality
- Visual customisation
- Automated regression workflows

Expect the structure and feature set to continue evolving.

---

## Contributing

MindMesh is currently an actively developed project.

When making changes:

- Keep commits focused
- Avoid removing existing functionality unless intentionally replacing it
- Add or update tests for meaningful behaviour changes
- Run the full regression workflow before merging important changes
- Confirm backup compatibility when storage schemas change
- Document major architecture or workflow changes

---

## License

A licence has not yet been specified.

If this repository will be public or accept outside contributions, add a `LICENSE` file before distributing the project.

---

## MindMesh

**Turn tasks, reminders, routines, money, and everyday information into one connected visual mesh.**
