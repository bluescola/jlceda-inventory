<p align="right">
  <a href="./README.md">简体中文</a> | <strong>English</strong>
</p>

# JLCEDA Personal Component Inventory

A personal component inventory extension for JLCEDA Professional V3. It records components on hand, completes LCSC part-number information from the JLCEDA library, and helps prioritize existing stock during schematic design.

The current release is an installable `0.1.0` MVP. The extension does not require the developer to operate a custom server. Source code, CI, and release files are hosted on GitHub, while inventory is written to JLCEDA extension user configuration.

## Implemented

- Look up parts in the official JLCEDA library by LCSC part number and store supplier, manufacturer part number, package, and library references.
- Add custom components with exact, estimated, or unknown quantities.
- Edit quantities, mark parts depleted, restore stock, and remove records.
- Copy catalog-backed inventory parts to Favorites, with an automatic fallback to the personal library.
- Rank existing inventory first by LCSC part number, manufacturer part number, or name.
- Select an in-stock part and attach it to the pointer for schematic placement.
- Import CSV/JSON order files with quantity, estimation type, depleted status, storage location, and duplicate-handling rules.
- Export a versioned JSON backup.
- Use Simplified Chinese or English menus and runtime messages.

## Synchronization and Server

This extension has no custom backend and does not require users to configure a database. Inventory is stored with `SYS_Storage.setExtensionUserConfig()`.

Official documentation describes this API as "extension user configuration," but does not guarantee cross-computer synchronization, capacity, propagation delay, or concurrent-conflict behavior. This repository therefore marks cross-computer synchronization as **pending V3 two-device validation** rather than presenting it as an officially guaranteed cloud database. Follow the [cross-device validation checklist](docs/cross-device-validation.md) and regularly use "Export inventory backup" until validation is complete.

GitHub can host source code, CI builds, and release files, but it cannot act directly as the runtime database.

## Installation

1. Download `jlceda-inventory_v0.1.0.eext` from a Release or CI artifact.
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
    component-catalog/      Component lookup port
    order-import/           CSV/JSON order parsing
    common-library/         Common-library copy port
    stock-recommendation/   Inventory-first ranking
  platform/jlceda-v3/       JLCEDA Professional V3 API adapters
    bootstrap/              Dependency composition
    eda/                    Library, file, i18n, and placement adapters
    persistence/            Official user-configuration storage
    presentation/           Official native-dialog workflows
  index.ts                  Single official extension entry point
build/                      Official SDK packaging baseline
config/                     Official SDK esbuild baseline
locales/                    Runtime and extension.json translations
tests/                      Pure business unit tests
docs/                       Architecture, baseline, and validation notes
```

See [Architecture](docs/architecture.md) for dependency and SDK upgrade rules, and [Order import format](docs/order-import-format.md) for recognized columns.

## Current Limitations

- JLCEDA currently provides no public marketplace-order API, so orders are imported from CSV/JSON files.
- `LIB_Device`, `LIB_Device.copy()`, file selection, and pointer placement are official BETA APIs. They are isolated in the platform layer and still require validation in both Web and Desktop clients.
- The official iframe API does not publish a communication contract with the extension runtime. The first release uses official native dialogs for write operations; a full table UI will be connected after its communication path passes V3 device testing.
- Successful pointer placement only means a component was attached to the pointer, not that the user completed placement, so inventory is not deducted automatically.

## License

[Apache-2.0](LICENSE)
