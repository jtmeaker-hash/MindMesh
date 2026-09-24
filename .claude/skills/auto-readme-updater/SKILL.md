---
name: auto-readme-updater
description: "Use after every prompt that changes the repository. Review and update the root README so it accurately reflects the current implementation."
---

# Auto README Updater

Keep the repository README synchronized with the actual project after every repository-changing task.

The README review is part of the definition of done.

## Steps

1. Complete the user's requested task first.

2. Review all files changed by the task.

3. Locate the repository's main README.

   Prefer:
   - `README.md`
   - `README`
   - `.README`

   Do not create a duplicate README if one already exists.

4. Compare the README against the current implementation.

5. Update the README when the task changes anything that users or developers should know about, including:
   - Features
   - UI or navigation
   - Settings
   - App behaviour
   - Reminders
   - Graph functionality
   - Money management
   - Dashboard features
   - Contacts
   - Backup or restore
   - Import/export
   - Notifications
   - Diagnostics
   - AI features
   - Data storage
   - Architecture
   - Dependencies
   - Installation
   - Build instructions
   - Testing
   - GitHub Actions
   - CI/CD
   - Supported platforms
   - Known limitations
   - Project status

6. Update existing README sections instead of blindly adding new sections.

7. Remove or correct documentation that became outdated because of the task.

8. Verify the final README before finishing.

## Source Of Truth

The repository implementation is the source of truth.

Never state that a feature is complete simply because:
- The user requested it.
- A prompt described it.
- A specification mentions it.
- A TODO says it should exist.
- The README already claims it exists.

Inspect the implementation before documenting functionality as working.

If functionality is incomplete, describe it accurately as:
- In development
- Partially implemented
- Planned

Do not present unfinished functionality as complete.

## Preserve README Quality

Preserve the existing README's:
- Branding
- Badges
- Screenshots
- Images
- Tables
- Links
- Structure
- Formatting
- Code blocks
- Project-specific style

Do not replace a polished README with generic boilerplate.

Do not unnecessarily rewrite unrelated sections.

## Avoid Duplicate Documentation

Before adding information:
1. Search the README for the feature.
2. Update the existing description when possible.
3. Remove obsolete statements.
4. Resolve contradictions.
5. Avoid describing the same feature multiple times.

## Bug Fixes

Review the README after bug fixes.

Do not add pointless documentation for minor internal fixes.

Update the README when a bug fix changes documented behaviour.

Example:

If the README says manual node positioning is unsupported and the task fixes manual node positioning, remove or update that limitation.

## Feature Changes

When a feature is added:
- Add it to the appropriate existing section.

When a feature changes:
- Update its existing documentation.

When a feature is removed:
- Remove obsolete documentation.

When a limitation is fixed:
- Remove or revise that limitation.

## GitHub Actions

If the task changes files inside:

`.github/workflows/`

review the README's development or CI/CD documentation.

Use the actual workflow names from the repository.

Describe what each important workflow does without copying the YAML implementation.

## Installation And Build Changes

If installation or build behaviour changes, inspect the actual configuration before changing README instructions.

Check relevant files such as:
- `package.json`
- `build.gradle`
- `build.gradle.kts`
- `settings.gradle`
- `settings.gradle.kts`
- `gradle.properties`
- `AndroidManifest.xml`
- `capacitor.config.*`
- `vite.config.*`
- `.github/workflows/*`

Never invent commands, filenames, environment variables, or configuration.

## Version Information

If the task changes the app version and the README displays a version, update the README to match.

Do not bump the project version just because the README was updated.

## Changelog Behaviour

If the README contains a changelog, recent updates section, or development status section, only add meaningful project-level changes.

Group related changes together.

Do not turn the README into a commit history.

For example, prefer:

`Improved graph navigation, including zoom, camera movement, node positioning and selection.`

instead of several tiny entries for each individual fix.

## Final Check

Before declaring a repository-changing task complete, verify:

- The requested work is complete.
- The implementation was inspected.
- The README was reviewed.
- New important functionality is documented.
- Removed functionality is no longer documented.
- Known limitations are accurate.
- Commands and file paths are correct.
- Workflow names are correct.
- Version information matches when applicable.
- No duplicate documentation was introduced.
- No unfinished feature is described as complete.
- Existing README formatting and quality were preserved.

## Completion Rule

Every repository-changing task should finish with:

`TASK COMPLETE + IMPLEMENTATION VERIFIED + README REVIEWED`

README review is mandatory.

README modification is not mandatory when the existing README is already accurate.

Do not make meaningless README edits just to create a file change.