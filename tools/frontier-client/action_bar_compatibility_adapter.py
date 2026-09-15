"""Expose ordinary fitted modules through Frontier's Creation action bar."""

from functools import wraps


_EVEJS_CREATION_TEMPLATE_TYPE_IDS = frozenset((95276, 95735, 95968))


def _evejs_get_item(provider, item_id):
    try:
        return provider._godma.GetItem(item_id)
    except Exception:
        return None


def _evejs_is_ordinary_ship(provider, ship_id):
    ship = _evejs_get_item(provider, ship_id)
    type_id = getattr(ship, "typeID", None)
    return ship is not None and type_id not in _EVEJS_CREATION_TEMPLATE_TYPE_IDS


def _evejs_is_ordinary_module(provider, module_item_id, ship_id=None):
    module = _evejs_get_item(provider, module_item_id)
    if module is None:
        return False
    location_id = getattr(module, "locationID", None)
    if ship_id is not None and location_id != ship_id:
        return False
    return _evejs_is_ordinary_ship(provider, location_id)


def _evejs_iter_ship_modules(provider, ship_id):
    ship = _evejs_get_item(provider, ship_id)
    modules = getattr(ship, "modules", ()) or ()
    if isinstance(modules, dict):
        modules = modules.values()

    seen = set()
    for candidate in modules:
        module = candidate
        if isinstance(candidate, int):
            module = _evejs_get_item(provider, candidate)
        item_id = getattr(module, "itemID", None)
        if module is None or not item_id or item_id in seen:
            continue
        seen.add(item_id)
        yield module


def _evejs_is_regular_action_bar_slot(provider, module):
    """Return whether *module* occupies a high, medium, or low power slot."""
    flag_id = getattr(module, "flagID", None)
    if flag_id is None:
        return False
    invconst = provider._evejs_action_bar_invconst
    slot_ranges = (
        (
            getattr(invconst, "flagLoSlot0", 11),
            getattr(invconst, "flagLoSlot7", 18),
        ),
        (
            getattr(invconst, "flagMedSlot0", 19),
            getattr(invconst, "flagMedSlot7", 26),
        ),
        (
            getattr(invconst, "flagHiSlot0", 27),
            getattr(invconst, "flagHiSlot7", 34),
        ),
    )
    return any(first <= flag_id <= last for first, last in slot_ranges)


def _evejs_get_regular_charge(provider, module_item_id):
    module = _evejs_get_item(provider, module_item_id)
    if module is None:
        return None

    location_id = getattr(module, "locationID", None)
    flag_id = getattr(module, "flagID", None)
    try:
        state_manager = provider._godma.GetStateManager()
    except Exception:
        return None

    try:
        charge = state_manager.GetSubLocation(location_id, flag_id)
        if charge is not None:
            return provider._module_charge_from_item(charge)
    except Exception:
        pass

    try:
        category_charge = provider._evejs_action_bar_invconst.categoryCharge
        for item in state_manager.GetItemsInLocation(location_id):
            if (
                getattr(item, "categoryID", None) == category_charge
                and getattr(item, "flagID", None) == flag_id
            ):
                return provider._module_charge_from_item(item)
    except Exception:
        pass
    return None


def _evejs_build_regular_module_refs(provider, ship_id):
    ability_id = provider._evejs_action_bar_ability_id
    module_ref_type = provider._evejs_action_bar_module_ref_type
    result = []
    for module in _evejs_iter_ship_modules(provider, ship_id):
        type_id = getattr(module, "typeID", None)
        if not type_id or not _evejs_is_regular_action_bar_slot(provider, module):
            continue

        abilities = []
        if provider.has_activatable_default_effect(type_id):
            abilities.extend((
                ability_id.ACTIVATE_EFFECT,
                ability_id.DEACTIVATE_EFFECT,
            ))
        if provider.has_online_effect(type_id):
            abilities.extend((ability_id.ONLINE, ability_id.OFFLINE))

        charge = _evejs_get_regular_charge(provider, module.itemID)
        result.append(module_ref_type(
            item_id=module.itemID,
            type_id=type_id,
            abilities=abilities,
            loaded_type_id=getattr(charge, "type_id", None),
            loaded_count=getattr(charge, "quantity", 0),
        ))
    return result


def _evejs_command_time(provider, result):
    if result is None:
        return None
    return provider._evejs_action_bar_gametime.now_sim()


def _evejs_default_effect_name(provider, module_item_id):
    item = _evejs_get_item(provider, module_item_id)
    if item is None:
        return None
    try:
        effect = provider._godma.GetStateManager().GetDefaultEffect(item.typeID)
    except Exception:
        return None
    return getattr(effect, "effectName", None)


def _evejs_activate_regular_module(
    provider,
    ship_id,
    module_item_id,
    ability_id,
    params,
):
    abilities = provider._evejs_action_bar_ability_id
    state_manager = provider._godma.GetStateManager()

    if ability_id == abilities.ACTIVATE_EFFECT:
        effect_name = _evejs_default_effect_name(provider, module_item_id)
        if effect_name is None:
            return None
        result = state_manager.Activate(
            module_item_id,
            effect_name,
            params.get("target_id"),
            params.get("repeat"),
        )
    elif ability_id == abilities.DEACTIVATE_EFFECT:
        effect_name = _evejs_default_effect_name(provider, module_item_id)
        if effect_name is None:
            return None
        result = state_manager.Deactivate(module_item_id, effect_name)
    elif ability_id == abilities.ONLINE:
        result = state_manager.Activate(module_item_id, "online", None, None)
    elif ability_id == abilities.OFFLINE:
        result = state_manager.Deactivate(module_item_id, "online")
    elif ability_id == abilities.UNLOAD:
        result = provider._godma.GetDogmaLM().UnloadAmmo(
            ship_id,
            [module_item_id],
            ship_id,
            None,
        )
        provider.on_module_reloaded(module_item_id)
        # The legacy dogma method has a void response on success.
        if result is None:
            result = True
    else:
        return None
    return _evejs_command_time(provider, result)


def _evejs_install_action_bar_compatibility(namespace):
    provider_type = namespace.get("ModuleActionProvider")
    ability_id = namespace.get("AbilityId")
    module_ref_type = namespace.get("ModuleRef")
    gametime = namespace.get("gametime")
    invconst = namespace.get("invconst")
    if any(value is None for value in (
        provider_type,
        ability_id,
        module_ref_type,
        gametime,
        invconst,
    )):
        raise RuntimeError(
            "Frontier action-bar patch could not find its client types"
        )

    original_get_modules = provider_type.get_activatable_modules
    if getattr(
        original_get_modules,
        "_evejs_action_bar_compatibility_patch",
        False,
    ):
        return

    provider_type._evejs_action_bar_ability_id = ability_id
    provider_type._evejs_action_bar_module_ref_type = module_ref_type
    provider_type._evejs_action_bar_gametime = gametime
    provider_type._evejs_action_bar_invconst = invconst

    original_auto_fire = provider_type.is_auto_fire_available
    original_get_charge = provider_type._get_loaded_charge
    original_activate = provider_type.activate
    original_reload = provider_type.reload

    @wraps(original_get_modules)
    def get_activatable_modules(self, ship_id):
        if _evejs_is_ordinary_ship(self, ship_id):
            return _evejs_build_regular_module_refs(self, ship_id)
        return original_get_modules(self, ship_id)

    @wraps(original_auto_fire)
    def is_auto_fire_available(self, ship_id):
        if _evejs_is_ordinary_ship(self, ship_id):
            return False
        return original_auto_fire(self, ship_id)

    @wraps(original_get_charge)
    def get_loaded_charge(self, module_item_id):
        if _evejs_is_ordinary_module(self, module_item_id):
            return _evejs_get_regular_charge(self, module_item_id)
        return original_get_charge(self, module_item_id)

    @wraps(original_activate)
    def activate(
        self,
        ship_id,
        module_item_id,
        action=ability_id.ACTIVATE_EFFECT,
        **params,
    ):
        if _evejs_is_ordinary_module(self, module_item_id, ship_id):
            return _evejs_activate_regular_module(
                self,
                ship_id,
                module_item_id,
                action,
                params,
            )
        return original_activate(
            self,
            ship_id,
            module_item_id,
            action,
            **params,
        )

    @wraps(original_reload)
    def reload(self, ship_id, module_item_id, **params):
        if not _evejs_is_ordinary_module(self, module_item_id, ship_id):
            return original_reload(self, ship_id, module_item_id, **params)

        charge_item_id = params.get("item_id")
        if charge_item_id is None:
            return None
        result = self._godma.GetDogmaLM().LoadAmmo(
            ship_id,
            [module_item_id],
            [charge_item_id],
            ship_id,
        )
        self.on_module_reloaded(module_item_id)
        # The legacy dogma method has a void response on success.
        if result is None:
            result = True
        return _evejs_command_time(self, result)

    get_activatable_modules._evejs_action_bar_compatibility_patch = True
    is_auto_fire_available._evejs_action_bar_compatibility_patch = True
    get_loaded_charge._evejs_action_bar_compatibility_patch = True
    activate._evejs_action_bar_compatibility_patch = True
    reload._evejs_action_bar_compatibility_patch = True
    provider_type.get_activatable_modules = get_activatable_modules
    provider_type.is_auto_fire_available = is_auto_fire_available
    provider_type._get_loaded_charge = get_loaded_charge
    provider_type.activate = activate
    provider_type.reload = reload
