<p align="right">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

# JLCEDA Personal Component Inventory

A personal component inventory extension for JLCEDA Professional V3. It treats LCSC marketplace product information and JLCEDA device models as independent states and helps prioritize existing stock during schematic design.

The current release is `0.5.16`. The extension does not require the developer to operate a custom server. Source code, CI, and release files are hosted on GitHub, while inventory is written to JLCEDA extension user configuration.

## Implemented

- Run read-only stock checks against the current schematic, PCB, or an external BOM. Aggregate demand by board quantity, distinguish exact shortages from review/stocktake/unmatched states, and export shortage CSV files.
- Read CSV, TXT, XLS, and XLSX BOMs with text-encoding, worksheet, and header detection; map columns explicitly and compare two BOM versions for additions, removals, quantity changes, and identity changes. Stock check and stock-out accept exactly one BOM, version diff accepts exactly two, and each file is limited to 10 MiB, 32 worksheets, 128 columns per worksheet, and 10,000 data rows.
- Store per-item minimum stock and favorites, filter/export replenishment and stocktake work, configure overview columns, and maintain datasheet URLs plus cabinet/box/row/column locations.
- Read one or more selected SCH/PCB components, show all matching inventory records together with an unmatched count, deduplicate inventory by ID, and scroll-highlight a single result. Partial matches show a dedicated warning above the table with the missing designators and component identities. Locating again while the overview remains visible, minimized, or hidden replaces its old content with the new selection. EDA model rematching accepts only an exact result for the inventory record's current C number; a miss remains unbound and must not fall back to a name, manufacturer part number, or another C number. The legacy keyword-candidate entry still present in `0.5.13` is pending removal and is not considered a supported capability. Package QR input previews raw content plus parsed `pc`, `pm`, and `qty` before opening the existing inventory draft workflow.
- Commit an explicitly confirmed BOM stock-out atomically, block semantic duplicates, allow a confirmed identical demand as a new production run, and reverse a complete batch with linked entries. This ledger covers only BOM stock-out and reversal, not ordinary edits or order receipt.
- Persist project/document demand snapshots, show diffs before resynchronization, generate board-aware procurement suggestions, and store purchase/cost records separately. Demand snapshots and purchase records place Actions immediately after Name, while procurement suggestions prioritize the suggested quantity and status ahead of technical identifiers and source details. Purchase dates are stored as calendar-only `YYYY-MM-DD` values, with legacy timestamps normalized on read. User-confirmed substitute relationships are ranked for manual review only and never drive automatic matching or deduction.
- On Desktop, initial automatic-backup setup opens the native folder picker directly. After a folder is selected, the extension creates `jlceda-inventory-latest.json` and enables backup only after a successful test write. Existing saved paths remain usable and a new folder can be selected at any time; cancelling the picker leaves settings unchanged. Restore strictly validates schema, budgets, references, and ledger closure, stages a recovery point, and reinstates the previous recovery point if the primary restore fails. Version `0.5.5` passed the specified Desktop cases for folder selection, permission rejection, disable/re-enable, consecutive saves, external restore, and recovery-snapshot restore. Version `0.5.16` additionally passed folder/restore compatibility without the global `URL`, Desktop restart persistence, primary-save isolation when either the backup path disappears or external-interaction permission is disabled at runtime, backup after create, favorite, full-edit, merge, delete, and order-import writes, and pre-write rejection of malformed JSON, future schemas, and invalid backup fields. Web now also passed explicit fallback, manual-save, and file-restore checks. Web and Desktop do not automatically share primary inventory and require explicit JSON transfer. Non-destructive P0 host validation is complete; destructive disk and primary-storage failures remain covered by automated injection, and two-device behavior is tracked separately as P1.

- Query the JLCEDA system library first when adding a C-number part. Use model information immediately on a match, and open the LCSC marketplace for confirmation only when lookup is missing or fails.
- Keep marketplace products and EDA models independent; products without an EDA model can still be saved and managed as inventory.
- Use the same one-screen IFrame form for both LCSC-number and custom components, entering identity, quantity, category, location, and notes without a chain of native single-field dialogs.
- Show the inventory package and EDA model footprint prominently in the list and details, alongside separate marketplace-evidence and EDA-model statuses with exact rematching by the inventory record's current C number.
- Add custom components with exact, estimated, or unknown quantities.
- Keep the inventory overview mounted as the parent window with a host-native collapsed minimize control whose full-width title bar remains available for manual restore. Moving the window, clicking the EDA workspace, switching applications, minimizing, restoring, or maximizing never hides it implicitly. Place hides it explicitly and restores it on failure; only explicit close ends the session.
- Require a non-negative integer quantity, show a specific warning for negative values, mark zero as depleted automatically, and allow depleted state changes in the same form.
- Re-query the EDA library after a C-number change and present the new model properties as per-field suggestions without forcing them over user-maintained inventory data.
- Compare an existing record with the pending edit before merging duplicate identities, and use record revisions to avoid overwriting newer cross-computer changes.
- Reload the latest record before deletion and require an irreversible confirmation showing its name, part number, and quantity.
- Import catalog-backed inventory parts into the personal library, detect existing personal-library devices idempotently, and verify copied devices by reading them back instead of treating Favorites or an unverified API return as success.
- Manage large inventories from a categorized overview whose primary search covers LCSC and supplier IDs, manufacturer part numbers, names, manufacturers, and packages. The sidebar separates system and two-level user categories; rows and selected groups can be dragged directly onto a category. Actions, number, stock, package, and EDA model follow the name, with lower-frequency fields placed later.
- Explicitly and idempotently import the two-level category tree from a personal or Favorites library without moving inventory items automatically. When the full tree API is unavailable, fall back to categories already used by library devices and warn that empty categories may be omitted.
- Rank exact search matches above prefixes and partial matches, then prefer in-stock items among equally relevant results. Search belongs to the overview itself and is never presented as a menu command or virtual component.
- Open the categorized inventory overview from Place from inventory, search or browse its two-level categories, and attach any in-stock row with an available model to the pointer. The Place action hides the overview explicitly and inventory is not deducted automatically.
- Batch-import LCSC order-detail `.xls`/`.xlsx` files from one multi-field window that sets the default state and duplicate strategy together, previews every file and expected inventory change, and reports parsing, model matching, and write progress. Order numbers and SHA-256 fingerprints prevent repeated imports while CSV/JSON remain supported. A selection is limited to 100 files, each at most 10 MiB; workbooks are limited to 32 worksheets, 128 columns per worksheet, and 10,000 data rows.
- Use Save inventory backup as to create an independent versioned JSON snapshot. Destination and overwrite confirmation are handled by the EDA system save dialog rather than the fixed automatic-backup path.
- Use Simplified Chinese or English menus and runtime messages.

## Synchronization and Server

This extension has no custom backend and does not require users to configure a database. Inventory is stored with `SYS_Storage.setExtensionUserConfig()`.

Official documentation describes this API as "extension user configuration," but does not guarantee cross-computer synchronization, capacity, propagation delay, or concurrent-conflict behavior. A same-account, same-computer `0.5.16` check confirmed that Web and Desktop maintain independent primary inventories with no automatic propagation, while the same JSON can be transferred manually without content loss. Two-Desktop-device behavior remains pending, so this storage must not be presented as a cloud database. Follow the [cross-device validation checklist](docs/cross-device-validation.md); configure automatic backup on Desktop, save snapshots regularly on Web, and transfer data explicitly through JSON.

GitHub can host source code, CI builds, and release files, but it cannot act directly as the runtime database.

## Installation

1. Download `jlceda-inventory_v0.5.16.eext` from a Release or CI artifact.
2. Open JLCEDA Professional V3.
3. Go to "Advanced -> Extension Manager -> Import" and select the `.eext` file.
4. Enable the extension under Installed; enable "Show in top menu" to keep its entry in the top row.
5. Open Inventory overview or another command from the grouped "Component Inventory" top menu. The extension does not register a separate top-level shortcut.

## Development

Node.js `>=20.17.0` is required.

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The packaged extension is written to `build/dist/`.

## Directory Structure

```text
src/
  features/                 Pure business features with no direct eda access
    inventory/              Inventory model, rules, and repository port
    component-catalog/      EDA device-model lookup port
    marketplace-catalog/    Marketplace evidence and navigation port
    order-import/           LCSC Excel and CSV/JSON order parsing
    common-library/         Common-library copy port
    inventory-search/       Inventory search and result ranking
    design-stock-check/     Current-design demand and stock checks
    bom-analysis/           Generic BOM reading, mapping, and diffs
    package-scan/           JLC/LCSC package-code parsing
    project-planning/       Project snapshots, procurement, and cost
  platform/jlceda-v3/       JLCEDA Professional V3 API adapters
    bootstrap/              Dependency composition
    eda/                    Library, file, i18n, and placement adapters
    persistence/            Official user-configuration storage
    iframe/                 Isolated browser-form source
    presentation/           IFrame adapter, native dialogs, and diagnostics
  index.ts                  Single official extension entry point
build/                      Official SDK packaging baseline
config/                     Official SDK esbuild baseline
locales/                    Runtime and extension.json translations
tests/                      Pure business unit tests
docs/                       Project documentation and roadmap
```

See the [documentation index](docs/README.md), Chinese [0.5.16 new-feature test methods](docs/手动测试指南.md), [architecture](docs/architecture.md), [reliability roadmap](docs/roadmap.md), and [order import format](docs/order-import-format.md).

## Current Limitations

- JLCEDA currently provides no public marketplace-order API, so orders are imported from LCSC Excel order-detail exports or user-prepared CSV/JSON files.
- The supported LCSC product API requires approved credentials, request signing, and IP authorization, while marketplace pages do not allow cross-origin reads from extensions. The no-server build therefore opens the official marketplace for user confirmation only when EDA-model lookup is missing or fails; it does not scrape pages or claim automatic marketplace retrieval.
- `LIB_Device`, `LIB_Device.copy()`, library-category reads, file selection, and pointer placement are official BETA APIs. They are isolated in the platform layer and still require validation in both Web and Desktop clients; when the full classification tree is unavailable, import can only discover categories used by devices.
- SCH/PCB component reads, selected-component reads, direct path writes, and the new operational IFrames also depend on official BETA APIs. Automated checks cover capability detection, fallback, protocols, and native-close races, but cannot replace host validation in Web and Desktop.
- Project demand currently accumulates each snapshot independently and cannot identify a schematic and PCB that represent the same physical board. Keeping both snapshots will double-count demand and affect procurement suggestions, so one must currently be removed or omitted.
- The unified create form and inventory overview use the official IFrame, extension user-configuration, and timer APIs. Requests, operations, and responses are session-scoped and temporary data is removed on completion. Because the IFrame API remains BETA, startup failures are reported explicitly instead of silently switching to a different sequential-input workflow; both Web and Desktop clients still require testing before release.
- Successful pointer placement only means a component was attached to the pointer, not that the user completed placement, so inventory is not deducted automatically.
- `SYS_Storage` has no host-level atomic CAS. The extension rejects stale writes within one runtime instance but cannot promise strong consistency across simultaneous extension runtimes or devices.

## Contributors

This project was not implemented by the repository maintainer alone. The main implementation work was completed collaboratively with **OpenAI Codex** under the maintainer's requirements, decisions, and acceptance. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for details.

## License

[Apache-2.0](LICENSE)
