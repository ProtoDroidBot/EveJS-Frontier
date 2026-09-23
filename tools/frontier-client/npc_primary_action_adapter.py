"""Hide the HUD's Board Ship shortcut while a ship has a pilot."""

import builtins
from functools import wraps


SHIP_CATEGORY_ID = 6
BOARD_SHIP_LABEL_PATH = "UI/Inflight/BoardShip"


def _evejs_is_occupied_ship(namespace, entity_id):
    try:
        service_manager = namespace.get("sm") or getattr(builtins, "sm", None)
        if service_manager is None:
            return False
        ballpark = service_manager.GetService("michelle").GetBallpark()
        slim_item = ballpark.slimItems.get(entity_id)
    except Exception:
        return False
    try:
        value = (slim_item.get if isinstance(slim_item, dict)
                 else lambda key: getattr(slim_item, key, None))
        category_id = int(value("categoryID"))
        if category_id != SHIP_CATEGORY_ID:
            return False
        pilot_id = int(value("charID") or 0)
        return pilot_id > 0
    except (TypeError, ValueError):
        return False


def _evejs_is_board_ship_action(action):
    label_path = getattr(action, "label_path", action)
    return label_path in (BOARD_SHIP_LABEL_PATH, "Board Ship")


def _evejs_install_npc_primary_action(namespace):
    resolver_type = namespace.get("ActionResolver")
    if resolver_type is None:
        raise RuntimeError("NPC primary action patch could not find ActionResolver")
    original = resolver_type.resolve
    if getattr(original, "_evejs_occupied_ship_board_patch", False):
        return

    @wraps(original)
    def resolve(self, bracket_key):
        result = original(self, bracket_key)
        try:
            entity_id = getattr(bracket_key, "ball_id", None)
            if result is None or not _evejs_is_occupied_ship(namespace, entity_id):
                return result
            primary = result.primary
            secondary = result.secondary
            if _evejs_is_board_ship_action(primary):
                primary = None
            if _evejs_is_board_ship_action(secondary):
                secondary = None
            if primary is None:
                primary, secondary = secondary, None
            if primary is result.primary and secondary is result.secondary:
                return result
            return result.__class__(primary=primary, secondary=secondary)
        except Exception:
            # A failed optional HUD lookup must not disable retail actions.
            return result

    resolve._evejs_occupied_ship_board_patch = True
    resolver_type.resolve = resolve
