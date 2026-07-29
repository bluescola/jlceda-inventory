# Developer Guide

[Chinese developer guide](https://github.com/bluescola/jlceda-inventory/blob/main/docs/%E5%BC%80%E5%8F%91%E6%8C%87%E5%8D%97.md) | **English**

This document is the technical entry point for contributors to JLCEDA Personal Component Inventory. The user-facing workflows are documented in the repository README; this guide covers the development environment, architecture, safety boundaries, verification, and release process.

## Environment

- Node.js `>=20.17.0`
- npm with lockfile-based installation
- JLCEDA Professional V3 for host validation
- Windows PowerShell for the documented local commands
- CI currently runs on Node.js 24

Install exactly the dependencies recorded in `package-lock.json`:

```powershell
npm ci
```

Do not replace the SDK build layout or update dependencies as an incidental part of a feature change. SDK, TypeScript, ESLint, and build-baseline updates should be reviewed and committed separately from product behavior.

## Commands

Run the complete verification sequence before a code release:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Other supported commands are:

```powershell
npm run compile
npm run build:diagnostic
npm run fix
```

- `compile` rebuilds the host bundle and self-contained IFrame resources without creating the final extension archive.
- `build` compiles the project and packages the release `.eext` file.
- `build:diagnostic` creates a diagnostic build for targeted host testing. Diagnostic evidence must not be presented as a normal release artifact.
- `fix` applies the configured ESLint fixes. Review its diff before keeping the result.

## Build and Packaging

The repository inherits the official SDK build baseline in `build/` and `config/`. The supported host output remains a browser IIFE named `edaEsbuildExportName`, and the manifest entry remains `./dist/index`.

The build performs these high-level steps:

1. Remove old generated `dist/` and root `iframe/` output.
2. Compile each source IFrame from `src/platform/jlceda-v3/iframe` into self-contained HTML resources.
3. Bundle `src/index.ts` and its dependencies into `dist/index.js`.
4. Apply `.edaignore` and package the extension under `build/dist/`.

Generated root `dist/` and `iframe/` files must not be edited manually. Change their sources and rebuild instead.

The expected release artifact is named like:

```text
build/dist/jlceda-inventory_v0.5.22.eext
```

Inspect the final archive rather than assuming that a successful bundle contains every required manifest, documentation, image, locale, IFrame, and entry file.

## Directory and Dependency Boundaries

The required dependency direction is:

```text
src/index.ts
  -> platform/jlceda-v3/bootstrap
    -> platform/jlceda-v3 adapters and presentation
      -> feature application services and ports
        -> feature domain rules
```

Important directories are:

```text
src/features/                         Platform-independent domain and application logic
  inventory/                          Versioned inventory, writes, backup validation, and limits
  component-catalog/                  EDA model lookup port
  marketplace-catalog/                Marketplace evidence and navigation port
  order-import/                       LCSC order parsing and bounded file handling
  common-library/                     Personal-library copy port
  inventory-search/                   Search normalization and relevance ranking
  design-stock-check/                 SCH, PCB, and BOM demand aggregation
  bom-analysis/                       BOM reading, mapping, comparison, and preparation
  package-scan/                       Bounded package-code parsing
  project-planning/                   Demand snapshots, procurement, purchases, and cost analysis
src/platform/jlceda-v3/               JLCEDA Professional V3 integration
  bootstrap/                          Dependency composition
  eda/                                Official library, design, file, URL, and placement adapters
  persistence/                        Extension storage and automatic backup
  iframe/                             Source HTML, CSS, and TypeScript for custom panels
  presentation/                       Controllers, bridge protocols, native dialogs, and diagnostics
locales/                              Simplified Chinese and English runtime strings
images/                               Extension logo and marketplace screenshots
tests/unit/                           Automated domain, application, protocol, and adapter tests
build/ and config/                    Official SDK-derived build and packaging baseline
```

`src/features` must not reference the global `eda` object, `ILIB_*` host types, or any other JLCEDA runtime global. Add or extend a port in the feature layer and implement it under `src/platform/jlceda-v3`.

Official API calls belong in the platform layer. This keeps SDK changes localized and allows inventory, import, planning, and search logic to run under Node.js tests.

Add an abstraction only when it represents a real platform boundary, shared invariant, or repeated workflow. Prefer existing services, ports, adapters, protocol helpers, and fixtures over a second route to the same behavior.

## Inventory and Data Safety

### Versioned Primary Document

The primary inventory is the versioned `inventory.v1.document` value in JLCEDA extension user configuration. The current implementation uses schema v9. Migrations from older supported schemas must preserve existing item IDs, quantities, categories, history, references, and revision semantics.

All inventory changes must pass through application services and revision checks. IFrames submit bounded user intent; they never receive direct repository write access.

When a workflow changes multiple inventory rows, its atomicity must be explicit. BOM stock-out and reversal commit as complete batches. Duplicate imports and repeated operations must retain their established idempotency checks.

### Capacity and Validation

The primary document and backup share the same capacity model. Limits cover serialized UTF-8 bytes, inventory items, categories, order batches and files, BOM transactions and batches, project snapshots and demand lines, purchase records, and substitute links.

Validate limits before expensive parsing, allocation, protocol transfer, or persistence. Do not create a primary document that the same extension cannot reopen, transmit to an IFrame, or restore from backup.

External BOMs, order files, QR-code text, URLs, marketplace fields, backup JSON, and IFrame messages are untrusted input. Preserve existing controls for:

- text normalization and control-character removal;
- bounded lengths, row counts, worksheets, and columns;
- finite safe integers and quantity products;
- supported URL and URI schemes;
- schema and cross-reference validation;
- bridge protocol versions and request scope;
- one-time operation IDs and duplicate-write prevention.

### Backup and Restore Ordering

The JLCEDA extension configuration is the primary data source. A local JSON file is a backup and explicit transfer artifact, not a second independently writable database.

The write order is fixed:

```text
validate intent -> save primary inventory -> refresh enabled backup -> report backup status
```

A backup, status-save, or notification failure must not roll back a successful primary inventory write.

Complete restore must validate first, show a preview, require confirmation, and save a pre-restore recovery point before replacing primary inventory. If the primary restore write fails, reinstate the previous recovery point. Reject malformed, future-schema, invalid-reference, and over-capacity documents before a primary write.

### Web and Desktop

JLCEDA Web and Desktop have been observed to maintain independent primary inventory values. They must be described and tested as separate runtime states. JSON export and restore is the supported explicit transfer path; do not describe this as automatic cloud synchronization.

Desktop fixed-folder automatic backup must degrade clearly on Web. Desktop path selection, permission loss, missing folders, and external-interaction permission changes must never cause a successful primary inventory write to be discarded.

### Repository Hygiene

Do not commit inventory exports, diagnostic logs, backup files, manual test data, credentials, personal absolute paths, order details, phone numbers, or other user data. `logs/` and `manual-test/` are local evidence locations only.

## Platform Adaptation

The JLCEDA host sandbox is not a normal browser or Node.js process. It does not guarantee a global `URL`, `structuredClone`, usable `fetch`, direct local paths on Web, or stable BETA APIs.

Use the project's existing bundled URI parser and explicit JSON-safe cloning or field copies. Never add a browser-global dependency to feature logic because it happened to work in one host build.

The following capabilities are treated as unstable and must remain behind platform adapters and runtime capability checks:

- device lookup and copy;
- personal and Favorites library category reads;
- SCH and PCB component reads, including selected components;
- file selection, save, direct-path write, and folder selection;
- IFrame, storage, timer, and bridge operations;
- schematic pointer placement;
- opening the official marketplace.

The complete classification-tree API may be unavailable or deprecated. The existing fallback derives only categories already used by library devices and must continue warning that empty categories can be missing.

The current Desktop folder-selection compatibility path calls a public client-request API to reach the existing `app://api/client/openDir` bridge after host validation. The internal URI is isolated in the platform layer and must be replaced when JLCEDA provides a stable public folder picker that returns an absolute directory. Do not expose this bridge to feature code.

Long-lived IFrame sessions exchange versioned, request-scoped messages through storage and timers. Requests, operations, and responses must carry the expected session identifiers. A closed panel must stop polling and must not receive a late write-back.

Background inventory snapshots may update data in the long-lived overview, but must preserve search, category, filters, sorting, pagination, selection, scroll, and focus. Only an explicit user workflow such as locating newly selected design components may replace the active view scope.

## Testing Strategy

Automated coverage should scale with the risk of the change.

### Domain and Application Tests

Use Node.js tests for platform-independent rules, including:

- schema migration and backup validation;
- revision conflicts and atomic writes;
- duplicate order and BOM detection;
- cancellation and failure without partial writes;
- file, protocol, and document limits;
- quantity precision and safe-integer handling;
- search normalization and sorting;
- backup and restore failure ordering;
- substitute-link and project-planning references.

When modifying inventory, orders, BOM, projects, backups, or restore, cover the affected success, cancellation, failure, duplicate, over-limit, and legacy-data paths.

### Protocol and Adapter Tests

IFrame protocols must test malformed input, version or scope mismatch, replayed operation IDs, stale responses, native close races, and payload budgets. Platform adapters should test capability absence, rejected host calls, and Web/Desktop fallback behavior without leaking host globals into feature code.

### Host Validation

Automated tests do not prove that a BETA API, native picker, window focus rule, or mouse-placement call works in a real JLCEDA host. Clearly distinguish:

- automated test results;
- JLCEDA Web validation;
- JLCEDA Desktop validation;
- destructive failures covered only through injected tests.

Do not record an unexecuted host case as passed. Use a diagnostic build only for scoped reproduction, retain sanitized evidence locally, and rebuild the normal release artifact afterward.

At minimum, every code release still runs:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Documentation-only changes must at least pass `git diff --check`; CI remains responsible for the full verification result.

## Release Checklist

### Metadata and Versioning

- Keep the stable extension `uuid` and `name` unchanged.
- Synchronize the version in `extension.json`, `package.json`, and the root entries in `package-lock.json`.
- Keep `name`, `uuid`, `displayName`, `description`, `version`, `license`, `repository`, and at least one valid `categories` value in `extension.json`.
- Keep `entry` at `./dist/index` and verify that `dist/index.js` exists in the archive.
- Use a custom project-owned logo. The marketplace requires a clear PNG or JPEG, at least 200 x 200 pixels, no more than 5 MB, and preferably a 1:1 aspect ratio.

### User Documentation and Localization

- Update both `README.md` and `README.en.md` for user-visible workflows.
- Update both `CHANGELOG.md` and `CHANGELOG.en.md` for the release.
- Add or update both `locales/zh-Hans.json` and `locales/en.json` for user-visible runtime text.
- Move implementation detail into `docs/` instead of burying normal usage under internal architecture notes.
- Keep ordinary repository-document links in marketplace-facing READMEs as absolute `https://github.com/bluescola/jlceda-inventory/blob/main/...` URLs.

Marketplace screenshot paths are a special case. Use exactly:

```markdown
![Description](images/example.png)
```

Do not add the `./` prefix to README screenshot paths. Keep approved preview images inside the package so the marketplace can process them. The manifest logo path may remain `./images/logo.png` because it is parsed as a manifest asset, not a README link.

### Verification and Archive Audit

- Run lint, type checking, tests, and the release build.
- Inspect the archive file list and extract `extension.json` and README content for review.
- Confirm that the entry, locales, IFrames, logo, and intended screenshots are present.
- Confirm that ignored source screenshots, SVG logo sources, logs, backups, order data, manual test data, secrets, and personal paths are absent.
- Check image dimensions, format, file size, and ownership.
- Check every README image reference against a file in the archive.
- Run `git diff --check` and review the complete diff before committing.
- Record automated and real-host verification separately in release notes or the relevant validation document.

## Detailed Documentation

All links below are absolute so they work from GitHub and from the JLCEDA extension marketplace.

- [Documentation index](https://github.com/bluescola/jlceda-inventory/blob/main/docs/README.md)
- [Architecture](https://github.com/bluescola/jlceda-inventory/blob/main/docs/architecture.md)
- [Official SDK baseline](https://github.com/bluescola/jlceda-inventory/blob/main/docs/official-baseline.md)
- [Reliability roadmap](https://github.com/bluescola/jlceda-inventory/blob/main/docs/roadmap.md)
- [Cross-device validation checklist](https://github.com/bluescola/jlceda-inventory/blob/main/docs/cross-device-validation.md)
- [Order import format](https://github.com/bluescola/jlceda-inventory/blob/main/docs/order-import-format.md)
- [Unified component-entry boundary](https://github.com/bluescola/jlceda-inventory/blob/main/docs/component-entry-boundary.md)
- [Inventory-overview and category boundary](https://github.com/bluescola/jlceda-inventory/blob/main/docs/inventory-overview-boundary.md)
- [EDA category import and entry](https://github.com/bluescola/jlceda-inventory/blob/main/docs/eda-category-import-and-entry.md)
- [Local device-model integration boundary](https://github.com/bluescola/jlceda-inventory/blob/main/docs/local-device-model-integration.md)
- [Search relevance decision](https://github.com/bluescola/jlceda-inventory/blob/main/docs/relevance-sorting-decision.md)
- [Manual host test guide](https://github.com/bluescola/jlceda-inventory/blob/main/docs/%E6%89%8B%E5%8A%A8%E6%B5%8B%E8%AF%95%E6%8C%87%E5%8D%97.md)
- [Feature research and product decisions](https://github.com/bluescola/jlceda-inventory/blob/main/docs/%E6%8F%92%E4%BB%B6%E5%8A%9F%E8%83%BD%E8%B0%83%E7%A0%94.md)

## License and Contributions

The project uses the [Apache License 2.0](https://github.com/bluescola/jlceda-inventory/blob/main/LICENSE). Contribution and implementation credits are recorded in [CONTRIBUTORS.md](https://github.com/bluescola/jlceda-inventory/blob/main/CONTRIBUTORS.md).

Keep commits focused and reviewable. The established commit-title prefix is `JLCEDA Inventory`, followed by a Chinese change type and a concise result. Update documentation and tests in the same change when behavior, protocol, workflow, or validation conclusions change.
