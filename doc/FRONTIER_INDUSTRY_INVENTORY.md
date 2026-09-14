# Frontier Industry inventory

The `industry` service implements the build 3502403 Smart Assembly inventory
contract:

- `get_facility_details(facility_id)` returns the persisted blueprint and input/output totals.
- `load_blueprint(facility_id, blueprint_id)` selects a recipe supported by that facility.
- `deposit_input_items(facility_id, {item_id: quantity})` moves input stacks into escrow.
  A null quantity means the entire source stack.
- `withdraw_input_items` and `withdraw_output_items` take
  `(facility_id, {type_id: quantity}, inventory_id, inventory_flag)`.

Transfer replies are `(moved_quantities_by_type, jettisoned_quantities_by_type)`.
Requests either move their exact quantities or fail without changing inventory;
this implementation does not jettison overflow. Multiple source stacks of one
type are aggregated for capacity validation and consumed as needed on withdrawal.
Positive safe integer quantities are required; deposits also enforce the selected
blueprint's allowed input types and per-type storage limits.

Transfers require the facility owner in the same solar system within 5 km.
Construction and activation block access. Supported personal inventories include
the active ship's cargo and supported specialized holds, plus owned nearby cargo
containers and active Mobile Depots within their normal interaction range.
Withdrawals check destination capacity and hold item restrictions.

Contents use normal durable inventory rows owned by the facility owner, located
at the facility item ID. Server-only flags `20000` and `20001` distinguish input
and output escrow. `moveItemsToLocations` commits all source and destination
changes in one atomic operation. Each changed row receives its own inventory
notification, and the gateway receives a complete `InputItemsChangeNotice` or
`OutputItemsChangeNotice` snapshot, including an empty snapshot when depleted.

Blueprint selection is saved under `customInfo.evejsFrontierIndustry` while
preserving other assembly metadata. Changing blueprints requires empty input and
output escrow. Re-selecting the current blueprint is rejected because the client
clears its displayed contents on a successful load.

This inventory implementation leaves the production scheduler separate; it does
not manufacture new output items.

## Authored data

`server/src/services/frontier/industryStaticData.json` contains build 3502403's
native facility and recipe definitions, including resource hashes. Regenerate it
with the Frontier Python 3.12 environment and a local client/resource cache:

```text
python tools/frontier-static/extract-industry-static.py --client-root <build-directory> --out server/src/services/frontier/industryStaticData.json
```

Use `--resfiles-root` if the cache is outside the build directory or its parent.
After changing TypeScript, run `npm run build`. The `frontierIndustry*.test.js`
tests cover blueprint compatibility, persistence, atomic transfer math, access,
destination restrictions, notifications, and service replies. Run the inventory
suite through `scripts/Tests/run-isolated-tests.js` with Frontier build 3502403
static data and disposable Frontier fixtures, never against the live game store.
