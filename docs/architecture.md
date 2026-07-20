# Architecture

## Dependency rule

```text
src/index.ts
  -> platform/jlceda-v3/bootstrap
    -> platform/jlceda-v3 adapters
      -> features ports and application services
        -> features domain
```

`src/features` must not reference the global `eda` object or `ILIB_*` types. All official API calls belong under `src/platform/jlceda-v3`. This keeps SDK upgrades localized and allows inventory, import, and ranking rules to run in Node-based unit tests.

## Official baseline boundary

- `build/` and `config/` are inherited from the official SDK template.
- `extension.json`, `src/index.ts`, `locales/`, `images/`, README, and CHANGELOG are extension-owned.
- The host bundle remains one browser IIFE named `edaEsbuildExportName`, as required by the SDK template.
- The extension entry remains `./dist/index`.

See [official-baseline.md](official-baseline.md) for exact versions.

## Modules

| Module | Responsibility |
| --- | --- |
| `features/inventory` | Versioned document, identity normalization, quantity rules, duplicate merge and CRUD |
| `features/component-catalog` | Platform-neutral catalog contract |
| `features/order-import` | CSV/JSON parsing, aliases, quantity precision and depleted state |
| `features/common-library` | Platform-neutral copy contract |
| `features/stock-recommendation` | Exact/partial matching with in-stock priority |
| `platform/jlceda-v3/eda` | Official library, filesystem, i18n and schematic API adapters |
| `platform/jlceda-v3/persistence` | `SYS_Storage` inventory repository |
| `platform/jlceda-v3/presentation` | Native dialog workflows that are safe inside the extension runtime |

## Persistence

The current repository stores a schema-versioned document under `inventory.v1.document`. The manifest UUID is the storage identity and must never change after release.

This schema is intentionally behind `InventoryRepository`. If official user configuration does not synchronize reliably, a future backend or event-based synchronization adapter can replace it without changing inventory rules.

## UI decision

`SYS_IFrame.openIFrame()` is BETA and the official guide does not document a bridge between iframe JavaScript and the extension runtime. The first release therefore uses official native dialogs for all reads and writes. A future table UI must depend on a `UiBridge` port and may only ship after the same bridge works in both V3 Web and Desktop clients.

## BETA containment

The following official APIs are treated as unstable and never called from feature code:

- `LIB_Device.get/search/getByLcscIds/copy`
- `SYS_FileSystem.openReadFileDialog`
- `SCH_PrimitiveComponent.placeComponentWithMouse`
- `SYS_IFrame` when a future UI is added
