# Cross-device validation

Official documentation does not define cross-device behavior for extension user configuration. Complete this matrix with the same account before claiming automatic synchronization.

| Test | Expected observation | Result |
| --- | --- | --- |
| Web A adds an inventory item; Desktop B opens inventory | Item appears and propagation delay is recorded | Pending |
| Desktop B changes a different item; Web A reopens inventory | Change appears without reinstall | Pending |
| A and B edit the same item while both are online | Conflict behavior is recorded | Pending |
| A edits offline and reconnects | Recovery behavior and winning value are recorded | Pending |
| Switch to another account | Inventory is isolated by account | Pending |
| Uninstall/reinstall the same UUID | Data retention behavior is recorded | Pending |
| Upgrade extension with the same UUID | Inventory remains readable | Pending |
| Store 100, 1000 and 5000 items | Capacity, latency and write failures are recorded | Pending |

Also validate these official BETA paths in both Web and Desktop:

- lookup a valid, invalid and duplicate C number;
- copy to Favorites and verify fallback to the personal library;
- import UTF-8 CSV and JSON with Chinese filenames;
- place an in-stock part from the schematic menu;
- confirm that binding a part to the mouse does not deduct inventory.

If cross-device storage validation fails, retain local inventory plus JSON backup and do not label the feature as synchronized. Reliable automatic synchronization would then require a separate backend or a future official cloud-storage API.
