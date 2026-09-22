# Persistence and backup contract

Any feature that introduces new persisted user data must update the MindMesh backup serializer, restore/import logic, schema migration logic where required, and backup/restore tests before the feature is considered complete.

New fields must be optional or receive safe defaults when loading older localStorage and backup payloads. Restore must validate and migrate in memory before replacing the current state.
