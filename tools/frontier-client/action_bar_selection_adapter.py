"""Expose cargo consumables in the action bar's empty-slot selection menu."""

from functools import wraps


def _evejs_iter_consumable_actions(integration):
    manager = getattr(integration, "_item_action_manager", None)
    ship_id = getattr(integration, "_loaded_ship_id", None)
    if manager is None or ship_id is None:
        return

    try:
        inventory = integration._inventory_cache_service.GetInventoryFromId(
            ship_id
        )
        rows = inventory.List(integration._evejs_action_bar_flag_cargo)
    except Exception:
        return

    seen_type_ids = set()
    for row in rows:
        try:
            item = integration._evejs_action_bar_db_row_to_item(row)
            type_id = item.type_id
            if type_id in seen_type_ids or not manager.has_available_action(item):
                continue
            seen_type_ids.add(type_id)
            yield manager.get_action(type_id)
        except Exception:
            continue


def _evejs_add_available_consumable_entries(integration, menu, slot_index):
    placed_keys = {
        slot.action.key
        for slot in integration._slots
        if slot.action is not None
    }
    available = []
    for action in _evejs_iter_consumable_actions(integration):
        if action.key in placed_keys or action.item_component is None:
            continue
        type_id = action.item_component.type_id
        available.append((
            type_id,
            integration._evejs_action_bar_evetypes.GetName(type_id),
            action,
        ))
    available.sort(key=lambda row: row[1] or "")

    menu.AddCaption("Add consumable")
    if not available:
        menu.AddEntry(text="No available consumables", isEnabled=False)
        return

    for type_id, name, action in available:
        icon_id = integration._evejs_action_bar_evetypes.GetIconID(type_id)
        menu.AddEntry(
            text=name,
            texturePath=integration._evejs_action_bar_get_icon_file(icon_id),
            func=lambda selected=action: integration._set_slot_action(
                slot_index=slot_index,
                action=selected,
            ),
        )


def _evejs_install_action_bar_selection(namespace):
    integration_type = namespace.get("ActionBarIntegration")
    evetypes = namespace.get("evetypes")
    get_icon_file = namespace.get("GetIconFile")
    if any(value is None for value in (
        integration_type,
        evetypes,
        get_icon_file,
    )):
        raise RuntimeError(
            "Frontier action-bar selection patch could not find its client types"
        )

    original_add_entries = integration_type._add_available_module_entries
    if getattr(
        original_add_entries,
        "_evejs_action_bar_selection_patch",
        False,
    ):
        return

    db_row_to_item = namespace.get("_evejs_action_bar_db_row_to_item")
    if db_row_to_item is None:
        from itemaction.client.item import db_row_to_item

    flag_cargo = namespace.get("_evejs_action_bar_flag_cargo")
    if flag_cargo is None:
        from inventorycommon.const import flagCargo as flag_cargo

    integration_type._evejs_action_bar_db_row_to_item = staticmethod(
        db_row_to_item
    )
    integration_type._evejs_action_bar_flag_cargo = flag_cargo
    integration_type._evejs_action_bar_evetypes = evetypes
    integration_type._evejs_action_bar_get_icon_file = staticmethod(
        get_icon_file
    )

    @wraps(original_add_entries)
    def add_available_entries(self, menu, slot_index):
        original_add_entries(self, menu, slot_index)
        _evejs_add_available_consumable_entries(self, menu, slot_index)

    add_available_entries._evejs_action_bar_selection_patch = True
    integration_type._add_available_module_entries = add_available_entries
