---
name: limitation-fixer
description: Scan the current software project for accidental limitations, incomplete implementations, hardcoded caps, UI-only features, stubs, disabled paths, and brittle constraints; fix verified project-side limitations without weakening security, data integrity, or external provider boundaries.
---

# Limitation Fixer

Use this skill when the user wants the project audited for limitations, artificial caps, unfinished behavior, hidden restrictions, partially wired features, or places where the implementation does less than the product appears to promise.

Default behavior: **scan â†’ classify â†’ repair â†’ validate**.

Do not stop at an audit when a safe project-side fix can be made.

## What counts as a limitation

Search for more than numeric limits. Candidates include:

- hardcoded maximums, minimums, page sizes, item counts, history limits, character limits, time windows, retry counts, or arbitrary thresholds
- `.slice(...)`, `.take(...)`, `.limit(...)`, `maxLength`, `maxItems`, `MAX_*`, `LIMIT_*`, `CAP_*` and similar values that silently restrict user-visible behavior
- TODO / FIXME / HACK / XXX / placeholder / stub / mock / fake / sample / demo-only implementations
- `NotImplemented`, `UnsupportedOperation`, or explicit "not implemented" errors in user-facing paths
- UI controls that render but do nothing
- empty/no-op event handlers
- disabled buttons or navigation with no legitimate reason
- fake success messages or optimistic state that is never persisted
- backend/state/persistence support that exists but is not reachable from the UI
- UI fields that are collected but never saved
- persisted fields that are not restored
- feature flags permanently disabled
- unreachable routes or permanently-false branches
- swallowed errors that silently reduce functionality
- fallback code that permanently masks the real implementation
- temporary development restrictions left in production
- production code using test/mock behavior
- unsupported enum/variant branches that should work
- partial platform implementations
- overly strict schema or form validation not supported by product requirements
- backup/export that omits persisted data
- restore/import that restores only part of exported state
- recurrence, scheduling, notifications, background jobs, sync, import/export, or persistence that is only partly wired
- CI/build workflows that skip supported targets or silently ignore important failures
- hardcoded assumptions that block product customization
- "coming soon", "MVP only", "future", "temporary", or "not supported yet" paths where the feature is expected to work now

## Do not bypass real boundaries

Never weaken or remove:

- authentication
- authorization
- ownership/tenant boundaries
- permission checks
- encryption or secret handling
- signing/integrity verification
- safety-critical validation
- abuse prevention
- security rate limits
- legal/compliance controls
- third-party quotas or billing restrictions
- API/model/provider rate limits
- operating-system restrictions
- app-store/platform security requirements

If a limitation comes from an upstream service or platform, improve handling instead:
pagination, batching, retries/backoff, caching, queues, graceful degradation, useful errors, or supported configuration.

Never attempt to circumvent the upstream restriction.

## Preserve existing behavior

Before editing, identify the project's current invariants from code, tests, docs, schemas, migrations, and configuration.

Preserve:

- existing user data
- stored settings
- working reminder/task behavior
- existing navigation
- backup/export and restore compatibility
- notifications
- accessibility behavior
- public APIs where practical
- supported build targets
- existing workflows

Do not rebuild the app from scratch.

Do not delete a feature simply because it is incomplete.

Prefer the smallest coherent end-to-end fix.

## Phase 1 â€” Map the repository

Inspect the project before editing.

Identify:

- application targets
- source roots
- UI/view layer
- state management
- persistence/database/storage
- services/API clients
- background workers/jobs
- notification and scheduling code
- import/export/backup code
- tests
- CI/CD workflows
- build configuration
- feature flags and environment configuration

Read relevant project instructions, README files, architecture notes, migrations, tests, and existing skills.

Use repository/file search broadly.

If parallel/subagent capabilities exist, split discovery across:

- hardcoded caps and truncation
- TODO/stub/incomplete code
- UI-to-state wiring
- persistence and round-trip integrity
- feature flags/configuration
- error swallowing/fallbacks
- tests and workflow gaps

Do not edit from keyword matches alone. Inspect context.

## Phase 2 â€” Aggressive scan

Search for text such as:

`TODO`
`FIXME`
`HACK`
`XXX`
`temporary`
`placeholder`
`stub`
`mock`
`fake`
`sample`
`demo`
`not implemented`
`unsupported`
`coming soon`
`MVP`
`future`
`disabled`
`hardcoded`
`limit`
`maximum`
`minimum`
`truncate`
`slice`
`pagination`
`feature flag`
`fallback`
`catch`
`ignore`
`no-op`
`noop`

Also inspect structural patterns:

- fixed thresholds in user-facing flows
- arrays/results sliced before rendering
- serializers that omit fields
- export/restore schema mismatch
- form values never written to state/storage
- empty click handlers
- constant fake success/failure values
- broad catch blocks returning defaults
- permanently-false feature conditions
- impossible-to-enable flags
- unreachable routes
- incomplete `switch` / `when` / enum cases
- hardcoded weekday/time/business rules that should be configurable
- platform implementation gaps
- tests encoding temporary limitations
- CI `continue-on-error` or skipped steps without justification

## Phase 3 â€” Classify findings

Classify every candidate before fixing it.

### A â€” Accidental project limitation
The project clearly intends to support more than the implementation allows.

Action: fix it.

### B â€” Incomplete implementation
The feature exists visually or architecturally but is only partly wired.

Action: complete the full path.

### C â€” Performance/resource safeguard
The limit protects responsiveness, memory, CPU, disk, battery, network, or concurrency.

Action: do not blindly remove it. Prefer pagination, streaming, virtualization, batching, chunking, queues, configuration, or adaptive behavior.

### D â€” External/provider/platform limit
The restriction comes from an API, cloud provider, OS, app store, model, package, protocol, or account plan.

Action: preserve the external boundary and improve handling.

### E â€” Security/data-integrity boundary
The restriction protects access, secrets, signing, integrity, permissions, abuse resistance, or data safety.

Action: preserve it. Only fix bugs that make the control stricter than intended while keeping the protection intact.

### F â€” Intentional product rule
Docs/tests/schema clearly show the restriction is deliberate.

Action: leave it unless the user explicitly requests changing the product rule.

### G â€” Ambiguous
Intent cannot be established safely.

Action: avoid destructive edits. Prefer configuration or report the finding while continuing to fix unambiguous issues.

## Phase 4 â€” Prioritize

Fix in this order:

1. data loss
2. incomplete backup/export/restore
3. fake-success or UI-only behavior
4. broken persistence / failed round trips
5. disabled core user flows
6. hardcoded caps causing silent truncation
7. scheduling/notification/background gaps
8. configuration and feature-flag mistakes
9. swallowed errors hiding broken behavior
10. platform parity gaps
11. lower-impact convenience limitations

## Phase 5 â€” Repair end-to-end

For each safe finding:

1. Trace:
   input â†’ validation â†’ state â†’ persistence/service â†’ output/UI â†’ reload/restore.

2. Fix the root cause.

3. Update all required:
   types, models, schemas, serializers, migrations, state/store, services, UI, tests, docs.

4. Preserve compatibility:
   - migrate stored data when needed
   - supply defaults for old records
   - keep older backup/import formats readable where practical
   - do not silently discard unknown data

5. Replace arbitrary caps using the right architecture:
   - pagination
   - virtualization
   - chunking
   - batching
   - streaming
   - configurable values
   - adaptive limits

6. Replace fake success states with real result handling.

7. Replace swallowed failures with explicit handling and useful diagnostics.

8. Do not leave a half-finished implementation.

## Phase 6 â€” Validate

Run all relevant checks available in the project:

- formatting
- lint
- typecheck
- unit tests
- integration tests
- builds
- platform-specific builds
- schema/migration validation
- import/export round-trip tests
- targeted regression tests

Add tests proving where practical:

- the old limitation is gone
- the newly-supported behavior works
- old behavior still works
- data survives reload/restore
- failures are visible rather than silently reported as success

If UI/browser/device testing tools are available, use them for affected flows.

Fix regressions before continuing.

## Phase 7 â€” Final diff review

Before finishing:

- review every changed file
- remove unrelated refactors
- confirm no security or permission boundary was weakened
- confirm no provider limit was circumvented
- confirm migrations are safe
- do not weaken/delete tests just to make CI green
- rerun relevant validation after final review

If a code-review agent/tool is available, run it against the final diff.

## Phase 8 â€” Report

Return a compact summary with:

- limitations found
- class Aâ€“G
- what was fixed
- what was intentionally preserved and why
- tests/builds run and results
- remaining external/ambiguous constraints
- genuinely necessary product decisions

Do not claim a fix passed unless it was actually verified.

## MindMesh-specific preservation rules

When this skill runs inside the MindMesh repository, explicitly preserve existing:

- reminders and recurrence behavior
- categories and subcategories
- completed reminder/task data
- contacts
- Money Management data
- dashboard/statistics data
- settings
- local persistence
- notifications
- navigation
- backup/export/import/restore compatibility

Pay extra attention to:

- UI-only features
- partial backup implementations
- reminder notification wiring
- recurrence/scheduling
- casual pay-rate configuration
- weekday/time-specific pay rules
- direct-debit dates and due-by dates
- variable general expenses
- settings that appear configurable but are hardcoded
- workflow/build validation gaps

Do not rebuild MindMesh from scratch.