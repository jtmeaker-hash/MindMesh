# Persistence and backup contract

Any feature that introduces new persisted user data must update the MindMesh backup serializer, restore/import logic, schema migration logic where required, and backup/restore tests before the feature is considered complete.

New fields must be optional or receive safe defaults when loading older localStorage and backup payloads. Restore must validate and migrate in memory before replacing the current state.

## Node positions and layout recovery

Backups always carry the current custom node positions (`data.nodePositions`), and restore reapplies them exactly before the live state is replaced.

Importing a backup also records its node positions under a dedicated key (`mindmesh_last_imported_positions_v1`), separate from the live layout. This means resetting node positions or auto-arranging the graph only clears the current layout; the last imported backup's positions stay recoverable and can be reapplied from Settings without importing the full backup again. This recovery key is derived from a backup rather than user-authored data, so it is intentionally not itself part of the backup payload.

## Connection brightness and contrast

Connection brightness and connection contrast are stored on the existing appearance slice (`data.appearance.connectionBrightness` and `data.appearance.connectionContrast`), so they are serialized by the current full-backup path with no separate key or format change. Both fields arrived after the first appearance release, so normalization treats a missing value as "use the default" (`connectionBrightness` 1, `connectionContrast` 0.35) and clamps anything outside the supported range. Appearance data saved before the fields existed therefore still validates and restores rather than being reported as malformed.

## Zoomed-out node visibility

Reminders and steps are hidden purely as a rendering effect when the node view is zoomed sufficiently far out. Their data, saved state and positions are untouched, the transition is driven by camera distance with a hysteresis band to prevent flicker, and primary nodes (root, categories) always remain visible.
