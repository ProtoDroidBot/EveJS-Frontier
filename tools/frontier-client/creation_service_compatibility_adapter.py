"""Keep ordinary ships out of the Frontier Creation client service."""

import builtins
from functools import wraps


_EVEJS_CREATION_TEMPLATE_TYPE_IDS = frozenset((95276, 95735, 95968))


def _evejs_runtime_global(namespace, name):
    value = namespace.get(name)
    if value is not None:
        return value
    return getattr(builtins, name, None)


def _evejs_get_active_ship(namespace, ship_id):
    service_manager = _evejs_runtime_global(namespace, "sm")
    if service_manager is None:
        return None

    try:
        ship = service_manager.GetService("godma").GetItem(ship_id)
        if ship is not None:
            return ship
    except Exception:
        pass

    try:
        dogma_location = service_manager.GetService(
            "clientDogmaIM"
        ).GetDogmaLocation()
        ship = dogma_location.GetItem(ship_id)
        if ship is not None:
            return ship
    except Exception:
        pass

    try:
        return service_manager.GetService("michelle").GetBall(ship_id)
    except Exception:
        return None


def _evejs_active_ship_uses_creation(namespace):
    current_session = _evejs_runtime_global(namespace, "session")
    ship_id = getattr(current_session, "shipid", None)
    if not ship_id:
        return False

    ship = _evejs_get_active_ship(namespace, ship_id)
    if ship is None:
        return False

    return ship.typeID in _EVEJS_CREATION_TEMPLATE_TYPE_IDS


def _evejs_install_creation_service_compatibility(namespace):
    creation_service_type = namespace.get("CreationService")
    if creation_service_type is None:
        raise RuntimeError(
            "Frontier fitting patch could not find the Creation service"
        )

    original_get_creation = creation_service_type.get_creation
    if not getattr(
        original_get_creation,
        "_evejs_fitting_compatibility_patch",
        False,
    ):
        @wraps(original_get_creation)
        def get_creation(self, creation_id, *args, **kwargs):
            current_session = _evejs_runtime_global(namespace, "session")
            if (
                creation_id == getattr(current_session, "shipid", None)
                and not _evejs_active_ship_uses_creation(namespace)
            ):
                self._active_creation = None
                return None
            return original_get_creation(self, creation_id, *args, **kwargs)

        get_creation._evejs_fitting_compatibility_patch = True
        creation_service_type.get_creation = get_creation

    original_get_active_creation = creation_service_type.get_active_creation
    if not getattr(
        original_get_active_creation,
        "_evejs_fitting_compatibility_patch",
        False,
    ):
        @wraps(original_get_active_creation)
        def get_active_creation(self, *args, **kwargs):
            if not _evejs_active_ship_uses_creation(namespace):
                self._active_creation = None
                return None
            return original_get_active_creation(self, *args, **kwargs)

        get_active_creation._evejs_fitting_compatibility_patch = True
        creation_service_type.get_active_creation = get_active_creation
