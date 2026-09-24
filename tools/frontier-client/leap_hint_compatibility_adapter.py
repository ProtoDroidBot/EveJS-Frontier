"""Show the Creation Leap shortcut from the fitted Creation snapshot."""

import builtins
from functools import wraps


_EVEJS_CREATION_LEAP_TYPE_ID = 95319


def _evejs_install_leap_hint_compatibility(namespace):
    original = namespace.get("_ego_has_online_leap")
    if original is None or getattr(original, "_evejs_leap_hint_patch", False):
        return

    @wraps(original)
    def ego_has_online_leap(service_manager):
        active_session = getattr(builtins, "session", None)
        ship_id = getattr(active_session, "shipid", None)
        if not ship_id:
            return original(service_manager)
        try:
            creation_service = service_manager.GetService("creation")
            provider = creation_service.get_module_action_provider()
            creation = provider.get_creation(ship_id)
            if creation is None:
                return original(service_manager)
            for module in creation.modules.values():
                try:
                    if module.type_id == _EVEJS_CREATION_LEAP_TYPE_ID:
                        return True
                except Exception:
                    continue
            return False
        except Exception:
            return original(service_manager)

    ego_has_online_leap._evejs_leap_hint_patch = True
    namespace["_ego_has_online_leap"] = ego_has_online_leap
