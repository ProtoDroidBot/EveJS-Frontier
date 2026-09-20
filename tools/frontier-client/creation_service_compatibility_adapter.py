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


def _evejs_preset_result_succeeded(result):
    if isinstance(result, dict):
        return result.get("success") is True
    return getattr(result, "success", False) is True


def _evejs_emit_presets_changed(service, action, result):
    if not _evejs_preset_result_succeeded(result):
        return
    signal = getattr(service, "on_creation_presets_changed", None)
    if signal is None:
        return
    try:
        signal(action, result)
    except TypeError:
        # Older Signal implementations expose emit() instead of __call__().
        emit = getattr(signal, "emit", None)
        if emit is not None:
            emit(action, result)


def _evejs_remote_preset_call(service, method_name, *args):
    remote = getattr(service, "_remote", None)
    if remote is None:
        raise RuntimeError("Creation preset service is not connected")
    method = getattr(remote, method_name, None)
    if method is None and method_name == "list_presets":
        method = getattr(remote, "get_presets", None)
    if method is None:
        raise RuntimeError(
            "Creation preset RPC is unavailable: {}".format(method_name)
        )
    return method(*args)


def _evejs_install_creation_service_compatibility(namespace):
    creation_service_type = namespace.get("CreationService")
    if creation_service_type is None:
        raise RuntimeError(
            "Frontier fitting patch could not find the Creation service"
        )

    original_init = creation_service_type.__init__
    if not getattr(original_init, "_evejs_creation_presets_patch", False):
        @wraps(original_init)
        def __init__(self, *args, **kwargs):
            original_init(self, *args, **kwargs)
            if not hasattr(self, "on_creation_presets_changed"):
                signals_module = namespace.get("signals")
                signal_type = getattr(signals_module, "Signal", None)
                if signal_type is not None:
                    self.on_creation_presets_changed = signal_type()

        __init__._evejs_creation_presets_patch = True
        creation_service_type.__init__ = __init__

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

    if not hasattr(creation_service_type, "list_creation_presets"):
        def list_creation_presets(self):
            return _evejs_remote_preset_call(self, "list_presets")

        creation_service_type.list_creation_presets = list_creation_presets

    if not hasattr(creation_service_type, "save_creation_preset"):
        def save_creation_preset(self, creation_id, name, description=""):
            result = _evejs_remote_preset_call(
                self, "save_preset", creation_id, name, description
            )
            _evejs_emit_presets_changed(self, "save", result)
            return result

        creation_service_type.save_creation_preset = save_creation_preset

    if not hasattr(creation_service_type, "rename_creation_preset"):
        def rename_creation_preset(self, preset_id, name, description=""):
            result = _evejs_remote_preset_call(
                self, "rename_preset", preset_id, name, description
            )
            _evejs_emit_presets_changed(self, "rename", result)
            return result

        creation_service_type.rename_creation_preset = rename_creation_preset

    if not hasattr(creation_service_type, "delete_creation_preset"):
        def delete_creation_preset(self, preset_id):
            result = _evejs_remote_preset_call(
                self, "delete_preset", preset_id
            )
            _evejs_emit_presets_changed(self, "delete", result)
            return result

        creation_service_type.delete_creation_preset = delete_creation_preset

    if not hasattr(creation_service_type, "preview_creation_preset"):
        def preview_creation_preset(self, creation_id, preset_id):
            return _evejs_remote_preset_call(
                self, "preview_preset", creation_id, preset_id
            )

        creation_service_type.preview_creation_preset = preview_creation_preset

    if not hasattr(creation_service_type, "apply_creation_preset"):
        def apply_creation_preset(self, creation_id, preset_id, preview_token):
            result = _evejs_remote_preset_call(
                self,
                "apply_preset",
                creation_id,
                preset_id,
                preview_token,
            )
            _evejs_emit_presets_changed(self, "apply", result)
            return result

        creation_service_type.apply_creation_preset = apply_creation_preset
