<p align="right">
  <a href="./CHANGELOG.md">简体中文</a> | <strong>English</strong>
</p>

# Changelog

## 0.4.3 - 2026-07-21

- Give expanded child categories a restrained contrasting surface. Component assignment now uses Pointer Events with document-level fallback listeners instead of relying on unstable HTML5 drag-and-drop or pointer capture in the embedded EDA browser.
- Split bulk category moves into independent horizontal top-level and child selectors, and add Select all filtered results/Clear selection commands. Users can filter by Unclassified, package, manufacturer, or text and classify the complete result set without automatic category guessing.
- Move order import into one multi-field window that sets the default stock state and duplicate strategy together, previews every selected file, and shows parsing, EDA model matching, and inventory write progress in place.
- Deduplicate model lookups by normalized C number and limit them to four concurrent requests. Diagnostic progress is throttled, failed previews remain retryable, and one preview cannot be submitted concurrently or more than once.
- Fix premature backup and diagnostic export notices. The extension now follows the official `saveFile(): Promise<void>` contract and leaves destination selection to the system save dialog without claiming a result before the user chooses a path.

## 0.4.2 - 2026-07-21

- Support in-place category renaming by double-click, sibling drag reordering, and horizontally wrapping category chips. The overview now previews three child categories per top-level category and expands the remainder on demand.
- Add a component drag handle and compact drag card containing the name, part number, quantity, current category, and location. Dropping onto Unclassified or a top-level/child category updates the component category directly.
- Record a reversible marketplace-verification state after opening the matching C-number search. Saving validates that state against the host session, stores a `user-confirmed` marketplace reference, and marks confirmed products without an EDA model as marketplace-sourced.

## 0.4.1 - 2026-07-21

- Fix devices already located in the personal or Favorites library being reported as copy failures. They are now treated as successful without creating duplicates.
- Prefer the current workspace's documented personal library as the copy destination, then try Favorites on rejection; failure to resolve either library no longer prevents trying the other.
- Check target libraries by LCSC part number before copying, report unavailable targets, rejected copies, and API errors separately, and write privacy-safe attempt statuses to diagnostics.

## 0.4.0 - 2026-07-21

- Turn the inventory overview into a persistent long-lived session. Details, full editing, delete confirmation, duplicate comparison, and EDA model rematching now run in its upper modal layer; operation snapshots update in place while preserving search, filters, pagination, scroll, and selection state.
- Replace inline category tools with a two-column manager in the same window: top-level categories on the left and child categories on the right, with create, rename, sibling reorder, and delete confirmation actions.
- Unify LCSC-number and custom component entry in one multi-field form covering identity, quantity mode, category, location, and notes instead of chaining native single-field dialogs.
- Bind EDA lookup, duplicate preview, and final merging to host-issued one-time tokens and record revisions. Changing the C number invalidates stale model results, and the first duplicate result performs no inventory write.
- Enable marketplace navigation only after the current C-number EDA lookup is missing or failed. Opening the marketplace is for manual verification and never claims that product data was read or confirmed automatically.
- Allow multiple Excel/CSV/JSON order files to be selected at once, with a per-file preview of order numbers, line quantities, duplicate reasons, and expected add/merge/skip results before writing.
- Upgrade inventory documents to schema v4, atomically record order-import batches, and prevent historical or same-batch repeats using order numbers and SHA-256 file fingerprints while migrating v1/v2/v3 documents losslessly.

## 0.3.5 - 2026-07-21

- Upgrade inventory browsing and search to a complete categorized overview with a prominent primary search, two-level user categories, stock/model filters, sorting, pagination, a responsive category drawer, and bulk category moves. Search is no longer a menu command or virtual component.
- Upgrade inventory documents to schema v3 and migrate existing records losslessly into Unclassified. Categories can be created, renamed, reordered, and deleted; deleting one only moves its records back to Unclassified.
- Improve host-event compatibility for the overview sort selector, make category sorting follow the user-managed category order, and clear an applied search automatically when its input becomes empty.
- Support direct LCSC `.xls`/`.xlsx` order-detail imports by locating offset headers, parsing unit-suffixed quantities, skipping items marked not to ship, and avoiding duplicate imports from hidden empty template sheets; CSV/JSON remain compatible.

## 0.3.4 - 2026-07-21

- Restore the previously displayed quantity and quantity type when `Depleted` is selected and then cleared in the full editor. These interactions remain form drafts and update inventory only after saving.
- Add a `Choose existing` button to the storage location field, populated with distinct locations from current inventory while retaining free-form entry.

## 0.3.3 - 2026-07-21

- Make Simplified Chinese the manifest default so Chinese environments still show `元器件库存` and `关于库存扩展` when locale resources are stale, while providing complete English manifest translations.
- Read the current JLCEDA language during activation and before every plugin command, keeping dialogs, fields, statuses, and prompts synchronized after switching between Chinese and English.

## 0.3.2 - 2026-07-21

- Merge inventory-first recommendations into the inventory overview as inventory search, with direct access from results to details, editing, and deletion. Exact matches rank before partial matches, in-stock items win equally relevant ties, and an empty query explicitly includes depleted records.

## 0.3.1 - 2026-07-21

- Fix new menus, inventory details, and edit forms showing English or raw translation keys when the host retains stale locale resources after an upgrade. Register bundled Chinese and English messages through the official multilingual API at startup, with a local fallback.
- Add the missing Supplier ID field translation and verify the actual Chinese window title, field labels, marketplace status, EDA status, and record source passed to the IFrame.
- Use a language-neutral numeric timestamp format and remove hard-coded English from the inventory IFrame loading and connection-failure states.

## 0.3.0 - 2026-07-21

- Add a dedicated inventory details and full-edit IFrame. Details show all user fields and system statuses read-only and can open the same full editor directly.
- Edit name, C number, supplier ID, manufacturer, MPN, package, description, quantity, exact/estimated precision, depleted state, location, and notes together. Quantity is required; negatives and fractions are rejected, while zero marks the item depleted automatically.
- Re-query the EDA system library after a C-number change. Matching model fields are offered as per-field suggestions, while a miss preserves user input without forced replacement.
- Show side-by-side details when an edited identity duplicates an existing record. Confirmation performs an atomic quantity merge; cancellation writes nothing, and both revisions are checked against concurrent changes.
- Reload the latest record before deletion and require an irreversible confirmation showing its name, part number, and stock quantity.

## 0.2.9 - 2026-07-20

- Consistently remove invisible Unicode formatting and unsafe control characters from forms, manual additions, order imports, and EDA model display fields to prevent package, part-number, quantity parsing, and matching errors.
- Preserve line breaks, tabs, and the ZWNJ/ZWJ characters needed for multilingual shaping.
- Sanitize existing schema-v2 inventory on read without changing IDs, quantities, revisions, or timestamps; subsequent exports and saves use the cleaned content.

## 0.2.8 - 2026-07-20

- Merge the multi-field form HTML, CSS, and JavaScript into one self-contained IFrame resource so hosts that only load the entry HTML cannot produce a blank window.
- Add a visible pre-script loading state and a top-level initialization error message so every startup outcome has visible content.
- Upgrade the temporary bridge protocol to v2 with script-start, request-read, form-render, and failure diagnostics; start the ready timeout only after the window opens successfully.

## 0.2.7 - 2026-07-20

- Fix the IFrame window ID containing a host-forbidden `.`, which caused the multi-field form to be rejected before loading.
- Change the window ID to the letter-and-hyphen-only `jlceda-inventory-product-details`.

## 0.2.6 - 2026-07-20

- Add before-call, boolean-return, and original-exception diagnostics around `openIFrame()` to distinguish a host `false` result from a thrown error.
- Record the static path, window ID, dimensions, error name, and stage while continuing to exclude part numbers, form contents, titles, and request IDs.
- Preserve the essential open-stage metadata in simplified release diagnostics as well.

## 0.2.5 - 2026-07-20

- Replace the non-editable React multi-field dialog with the official IFrame, extension storage, and timer APIs.
- Let users enter the product name, manufacturer, manufacturer part number, package, and description together in one browser form with complete initial-value prefilling.
- Add session isolation, title-bar close race protection, temporary-data cleanup, and IFrame lifecycle diagnostics while retaining native sequential fallback when startup fails.

## 0.2.4 - 2026-07-20

- Align the React product form with the documented minimal `Modal -> Dialog` structure and remove the double overlay configuration that can intercept input focus.
- Add content-free diagnostics for the first field click, change, and blur so focus failures can be distinguished from event-bridge failures.
- Give inputs stable field names and cover the single-modal structure with a unit test.

## 0.2.3 - 2026-07-20

- Restore React multi-field form as primary with sequential native dialogs as fallback.
- Extract a testable product-details session and add full input-to-submit coverage that asserts diagnostics never store field contents.
- Emit field-change and submit diagnostics with field names and lengths only; simplified release logs keep those metadata keys.
- Adjust component-dialog layout/overlay to reduce non-focusable inputs; both onChange and onBlur update the session.

## 0.2.2 - 2026-07-20

- Fix marketplace product entry: on current V3 hosts the React multi-field form renders but its text inputs reject keyboard input, so the flow now uses proven sequential native dialogs for name, manufacturer, package, and related fields.

## 0.2.1 - 2026-07-20

- Prevent consecutive native input dialogs from being requested while the previous host modal may still be closing.
- Add viewable, persistent, and exportable diagnostics for the LCSC add workflow; diagnostic builds retain full steps while release builds keep simplified logs.
- Show the actual stored inventory fields and an explicit success result after a save completes.
- Add a one-screen, multi-field product form for marketplace fallback; automatically use sequential native inputs when the component API is unavailable and record the fallback in the same diagnostic trace.

## 0.2.0 - 2026-07-20

- Separate LCSC marketplace product evidence from optional JLCEDA device-model references.
- Query the EDA system library first when adding a C-number part, and open the domestic marketplace for confirmation only when model lookup is missing or fails.
- Align marketplace fallback fields with EDA device-property names while keeping product packages distinct from EDA model footprints.
- Allow marketplace products without an EDA model to remain fully usable for stock management and recommendations.
- Show independent marketplace and EDA-model statuses in inventory lists and details.
- Add marketplace navigation and retryable EDA-model matching for existing inventory records.
- Migrate schema-v1 `catalogReference` data to schema-v2 `edaModelReference` without changing the storage key or extension UUID.
- Preserve imported order rows when EDA-model lookup is missing or fails.
- Fix inventory writes in the JLCEDA extension sandbox where `structuredClone` is unavailable; values such as quantity `99` with an empty storage location can now be saved.
- Remove the prefilled `C` from the LCSC part-number input so complete identifiers can be pasted directly; this workflow requires the `C` prefix.
- Add bilingual contributor disclosure for OpenAI Codex's role in the main implementation, debugging, tests, documentation, and build verification.

## 0.1.0 - 2026-07-20

- Add a modular JLCEDA Professional V3 extension baseline.
- Add official catalog lookup by LCSC part number.
- Add exact, estimated, unknown, and depleted inventory states.
- Add native inventory management and inventory-first recommendation workflows.
- Add CSV/JSON order import with duplicate handling and per-row depleted status.
- Add common-library copy with Favorites-to-personal-library fallback.
- Add schematic mouse placement for catalog-backed in-stock parts.
- Add JSON backup export and Simplified Chinese/English localization.
- Add domain tests, CI, architecture documentation, and cross-device validation notes.
