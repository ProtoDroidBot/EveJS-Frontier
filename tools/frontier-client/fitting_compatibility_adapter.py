"""Route non-modular ships to the legacy fitting window in Frontier 3502403."""

from functools import wraps


_EVEJS_CREATION_TEMPLATE_TYPE_IDS = frozenset((95276, 95735, 95968))


def _evejs_get_active_ship(namespace, ship_id):
    """Resolve the active ship in both space and station dogma locations."""
    service_manager = namespace["sm"]
    try:
        ship = service_manager.GetService("godma").GetItem(ship_id)
        if ship is not None:
            return ship
    except Exception:
        pass

    # godma only exposes the active ship while session.solarsystemid is set.
    # The retail client uses clientDogmaIM for the docked active-ship path.
    try:
        dogma_location = service_manager.GetService(
            "clientDogmaIM"
        ).GetDogmaLocation()
        ship = dogma_location.GetItem(ship_id)
        if ship is not None:
            return ship
    except Exception:
        pass

    # During early space setup the ball can precede both dogma caches.
    try:
        return service_manager.GetService("michelle").GetBall(ship_id)
    except Exception:
        return None


def _evejs_active_ship_uses_creation(namespace):
    """Use Creation only for a positively identified modular hull."""
    current_session = namespace.get("session")
    ship_id = getattr(current_session, "shipid", None)
    if not ship_id:
        return False

    ship = _evejs_get_active_ship(namespace, ship_id)
    if ship is None:
        return False

    creation_type_ids = namespace.get(
        "_evejs_creation_template_type_ids",
        _EVEJS_CREATION_TEMPLATE_TYPE_IDS,
    )
    return ship.typeID in creation_type_ids


def _evejs_install_fitting_compatibility(namespace):
    command_type = namespace.get("EveCommandService")
    fitting_window = namespace.get("FittingWindow")
    if command_type is None or fitting_window is None:
        raise RuntimeError("Frontier fitting patch could not find its client types")

    original_command = command_type.OpenFitting
    if not getattr(original_command, "_evejs_fitting_compatibility_patch", False):
        original_open = fitting_window.Open.__func__
        original_toggle = fitting_window.ToggleOpenClose.__func__

        @classmethod
        @wraps(original_open)
        def open_window(cls, *args, **kwargs):
            if _evejs_active_ship_uses_creation(namespace):
                return original_open(cls, *args, **kwargs)
            # Frontier overrides FittingWindow.Open to activate the Creation
            # view. The base implementation constructs the retained standard
            # EVE fitting window for an ordinary hull.
            return super(fitting_window, cls).Open(*args, **kwargs)

        @classmethod
        @wraps(original_toggle)
        def toggle_window(cls, *args, **kwargs):
            if _evejs_active_ship_uses_creation(namespace):
                return original_toggle(cls, *args, **kwargs)
            # Frontier also overrides ToggleOpenClose independently of Open.
            return super(fitting_window, cls).ToggleOpenClose(*args, **kwargs)

        @wraps(original_command)
        def open_fitting(self, *args, **kwargs):
            if _evejs_active_ship_uses_creation(namespace):
                return original_command(self, *args, **kwargs)
            return fitting_window.ToggleOpenClose()

        open_window.__func__._evejs_fitting_compatibility_patch = True
        toggle_window.__func__._evejs_fitting_compatibility_patch = True
        open_fitting._evejs_fitting_compatibility_patch = True
        fitting_window.Open = open_window
        fitting_window.ToggleOpenClose = toggle_window
        command_type.OpenFitting = open_fitting

    creation_service_type = namespace.get("_evejs_creation_service_type")
    if creation_service_type is None:
        from frontier.creation.client.service import CreationService
        creation_service_type = CreationService
    original_get_creation = creation_service_type.get_creation
    if getattr(original_get_creation, "_evejs_fitting_compatibility_patch", False):
        return

    @wraps(original_get_creation)
    def get_creation(self, creation_id, *args, **kwargs):
        current_session = namespace.get("session")
        if (
            creation_id == getattr(current_session, "shipid", None)
            and not _evejs_active_ship_uses_creation(namespace)
        ):
            self._active_creation = None
            return None
        return original_get_creation(self, creation_id, *args, **kwargs)

    get_creation._evejs_fitting_compatibility_patch = True
    creation_service_type.get_creation = get_creation
