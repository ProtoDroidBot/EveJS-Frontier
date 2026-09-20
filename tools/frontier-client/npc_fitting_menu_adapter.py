"""Add a context action only when the target NPC trusts the current player."""

from functools import wraps


def _evejs_value(value, key, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _evejs_npc_fitting_action_is_trusted(namespace, entity_id):
    try:
        result = namespace["sm"].RemoteSvc(
            "npcFittingMgr"
        ).CanOpenNpcFitting(entity_id)
    except Exception:
        return False
    return _evejs_value(result, "trusted", False) is True


def _evejs_open_npc_fitting(namespace, entity_id):
    command = getattr(namespace["uicore"], "cmd", None)
    opener = getattr(command, "OpenNpcFitting", None)
    return opener(entity_id) if opener is not None else None


def _evejs_install_npc_fitting_menu(namespace):
    menu_type = namespace.get("MenuSvc")
    if menu_type is None:
        raise RuntimeError("NPC fitting menu patch could not find MenuSvc")
    original = menu_type.CelestialMenu
    if getattr(original, "_evejs_npc_fitting_menu_patch", False):
        return

    @wraps(original)
    def celestial_menu(
        self,
        itemID,
        mapItem=None,
        crData=None,
        typeID=None,
        parentID=None,
        hint=None,
    ):
        menu = original(
            self, itemID, mapItem, crData, typeID, parentID, hint
        )
        if isinstance(itemID, list):
            return menu
        if _evejs_npc_fitting_action_is_trusted(namespace, itemID):
            menu.append([
                "Manage NPC Fitting",
                _evejs_open_npc_fitting,
                (namespace, itemID),
            ])
        return menu

    celestial_menu._evejs_npc_fitting_menu_patch = True
    menu_type.CelestialMenu = celestial_menu
