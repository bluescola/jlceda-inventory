<p align="right">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

# JLCEDA Personal Component Inventory

A personal component inventory extension for JLCEDA Professional V3. It treats LCSC marketplace product information and JLCEDA device models as independent states and helps prioritize existing stock during schematic design.

The current release is `0.4.3`. The extension does not require the developer to operate a custom server. Source code, CI, and release files are hosted on GitHub, while inventory is written to JLCEDA extension user configuration.

## Implemented

- Query the JLCEDA system library first when adding a C-number part. Use model information immediately on a match, and open the LCSC marketplace for confirmation only when lookup is missing or fails.
- Keep marketplace products and EDA models independent; products without an EDA model can still be saved and managed as inventory.
- Use the same one-screen IFrame form for both LCSC-number and custom components, entering identity, quantity, category, location, and notes without a chain of native single-field dialogs.
- Display separate marketplace-evidence and EDA-model statuses, with retryable model matching.
- Add custom components with exact, estimated, or unknown quantities.
- Keep the inventory overview mounted as the parent window. Its two-column category manager, details, full editor, delete confirmation, duplicate comparison, and EDA model rematching all run in an upper modal layer without losing search, filters, pagination, scroll, or selection state.
- Require a non-negative integer quantity, show a specific warning for negative values, mark zero as depleted automatically, and allow depleted state changes in the same form.
- Re-query the EDA library after a C-number change and present the new model properties as per-field suggestions without forcing them over user-maintained inventory data.
- Compare an existing record with the pending edit before merging duplicate identities, and use record revisions to avoid overwriting newer cross-computer changes.
- Reload the latest record before deletion and require an irreversible confirmation showing its name, part number, and quantity.
- Import catalog-backed inventory parts into the personal library, detect parts already present in the personal or Favorites library, and use Favorites only as a best-effort target through the official BETA API.
- Manage large inventories from a categorized overview: its primary search covers LCSC and supplier IDs, manufacturer part numbers, names, manufacturers, and packages; components can be dragged onto the two-level category tree, while separate top-level/child fields and Select all filtered results support controlled bulk classification.
- Rank exact search matches above prefixes and partial matches, then prefer in-stock items among equally relevant results. Search belongs to the overview itself and is never presented as a menu command or virtual component.
- Select an in-stock part and attach it to the pointer for schematic placement.
- Batch-import LCSC order-detail `.xls`/`.xlsx` files from one multi-field window that sets the default state and duplicate strategy together, previews every file and expected inventory change, and reports parsing, model matching, and write progress. Order numbers and SHA-256 fingerprints prevent repeated imports while CSV/JSON remain supported.
- Export a versioned JSON backup, with destination and overwrite confirmation handled by the EDA system save dialog.
- Use Simplified Chinese or English menus and runtime messages.

## Synchronization and Server

This extension has no custom backend and does not require users to configure a database. Inventory is stored with `SYS_Storage.setExtensionUserConfig()`.

Official documentation describes this API as "extension user configuration," but does not guarantee cross-computer synchronization, capacity, propagation delay, or concurrent-conflict behavior. This repository therefore marks cross-computer synchronization as **pending V3 two-device validation** rather than presenting it as an officially guaranteed cloud database. Follow the [cross-device validation checklist](docs/cross-device-validation.md) and regularly use "Export inventory backup" until validation is complete.

GitHub can host source code, CI builds, and release files, but it cannot act directly as the runtime database.

## Installation

1. Download `jlceda-inventory_v0.4.3.eext` from a Release or CI artifact.
2. Open JLCEDA Professional V3.
3. Go to "Advanced -> Extension Manager -> Import" and select the `.eext` file.
4. Start from the "Component Inventory" menu in the top navigation.

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

See the [documentation index](docs/README.md), [architecture](docs/architecture.md), [roadmap](docs/roadmap.md), and [order import format](docs/order-import-format.md).

## Current Limitations

- JLCEDA currently provides no public marketplace-order API, so orders are imported from LCSC Excel order-detail exports or user-prepared CSV/JSON files.
- The supported LCSC product API requires approved credentials, request signing, and IP authorization, while marketplace pages do not allow cross-origin reads from extensions. The no-server build therefore opens the official marketplace for user confirmation only when EDA-model lookup is missing or fails; it does not scrape pages or claim automatic marketplace retrieval.
- `LIB_Device`, `LIB_Device.copy()`, file selection, and pointer placement are official BETA APIs. They are isolated in the platform layer and still require validation in both Web and Desktop clients.
- The unified create form and inventory overview use the official IFrame, extension user-configuration, and timer APIs. Requests, operations, and responses are session-scoped and temporary data is removed on completion. Because the IFrame API remains BETA, startup failures are reported explicitly instead of silently switching to a different sequential-input workflow; both Web and Desktop clients still require testing before release.
- Successful pointer placement only means a component was attached to the pointer, not that the user completed placement, so inventory is not deducted automatically.

## Contributors

This project was not implemented by the repository maintainer alone. The main implementation work was completed collaboratively with **OpenAI Codex** under the maintainer's requirements, decisions, and acceptance. See [CONTRIBUTORS.md](CONTRIBUTORS.md) for details.

## License

[Apache-2.0](LICENSE)
