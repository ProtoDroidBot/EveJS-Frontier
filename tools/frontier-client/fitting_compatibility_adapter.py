"""Player fitting compatibility and server-trusted NPC fitting for 3502403."""

from functools import wraps


_EVEJS_CREATION_TEMPLATE_TYPE_IDS = frozenset((95276, 95735, 95968))


def _evejs_value(value, key, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _evejs_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return list(value)


def _evejs_npc_fitting_remote(namespace):
    return namespace["sm"].RemoteSvc("npcFittingMgr")


def _evejs_get_npc_fitting_state(namespace, entity_id):
    return _evejs_npc_fitting_remote(namespace).GetNpcFittingState(entity_id)


def _evejs_is_trusted_npc_fitting_state(state):
    return _evejs_value(state, "trusted", False) is True


class _EvejsNpcFittingPresenter:
    """Testable client state; the server remains authoritative for every action."""

    def __init__(self, remote, entity_id, initial_state=None):
        self.remote = remote
        self.entity_id = entity_id
        self.state = initial_state
        self.selected_module_id = None
        self.status = ""

    @property
    def trusted(self):
        return _evejs_is_trusted_npc_fitting_state(self.state)

    @property
    def modules(self):
        return _evejs_list(_evejs_value(self.state, "modules", []))

    @property
    def available_modules(self):
        return _evejs_list(
            _evejs_value(self.state, "availableModules", [])
        )

    @property
    def available_charges(self):
        return _evejs_list(
            _evejs_value(self.state, "availableCharges", [])
        )

    def accept(self, state):
        self.state = state
        available = {
            int(_evejs_value(module, "moduleID", 0) or 0)
            for module in self.modules
        }
        if self.selected_module_id not in available:
            self.selected_module_id = None
        self.status = (
            "NPC fitting access confirmed"
            if self.trusted else
            "NPC fitting access is no longer trusted"
        )
        return state

    def refresh(self):
        return self.accept(self.remote.GetNpcFittingState(self.entity_id))

    def select_module(self, module_id):
        self.selected_module_id = int(module_id or 0) or None
        self.status = (
            "Selected module {}".format(self.selected_module_id)
            if self.selected_module_id else "Select a fitted module"
        )

    def fit(self, item_id):
        return self.accept(self.remote.FitItem(self.entity_id, item_id, 0))

    def unfit(self, module_id):
        return self.accept(self.remote.UnfitItem(self.entity_id, module_id))

    def load(self, item_id):
        if not self.selected_module_id:
            self.status = "Select a fitted module before loading a charge"
            return None
        return self.accept(
            self.remote.LoadCharge(
                self.entity_id, self.selected_module_id, item_id, 0
            )
        )

    def unload(self, cargo_id):
        return self.accept(self.remote.UnloadCharge(self.entity_id, cargo_id))


def _evejs_attribute(attributes, name, default=None):
    if isinstance(attributes, dict):
        return attributes.get(name, default)
    return getattr(attributes, name, default)


def _evejs_npc_fitting_window_type(namespace):
    cached = namespace.get("_evejs_npc_fitting_window_type")
    if cached is not None:
        return cached

    import eveui
    from carbonui.control.scrollContainer import ScrollContainer

    base_window = namespace.get("Window")
    if base_window is None:
        from carbonui.control.window import Window as base_window

    class NpcFittingWindow(base_window):
        default_windowID = "evejs_npc_fitting"
        default_caption = "NPC Fitting"
        default_width = 620
        default_height = 650
        default_minSize = (500, 420)

        def ApplyAttributes(self, attributes):
            super().ApplyAttributes(attributes)
            entity_id = _evejs_attribute(attributes, "npc_entity_id", 0)
            initial_state = _evejs_attribute(
                attributes, "initial_state", None
            )
            self._presenter = _EvejsNpcFittingPresenter(
                _evejs_npc_fitting_remote(namespace),
                entity_id,
                initial_state,
            )
            self._presenter.accept(initial_state)
            self._status_label = None
            self._summary_label = None
            self._scroll = None
            self._construct_layout(ScrollContainer, eveui)
            self._render(eveui)

        def _construct_layout(self, scroll_type, ui):
            root = ui.Container(
                parent=self.GetMainArea(),
                align=ui.Align.to_all,
                padding=(16, 16, 16, 16),
            )
            header = ui.ContainerAutoSize(
                parent=root,
                align=ui.Align.to_top,
            )
            self._summary_label = ui.EveLabelLarge(
                parent=header,
                align=ui.Align.to_top,
                text="NPC fitting",
            )
            self._status_label = ui.EveLabelMedium(
                parent=header,
                align=ui.Align.to_top,
                padTop=4,
                text="",
            )
            ui.Button(
                parent=header,
                align=ui.Align.to_right,
                label="Refresh",
                func=self._on_refresh,
            )
            self._scroll = scroll_type(
                parent=root,
                align=ui.Align.to_all,
                padTop=12,
            )

        def _row(self, ui, text, button_label=None, callback=None):
            row = ui.Container(
                parent=self._scroll,
                align=ui.Align.to_top,
                height=34,
                padBottom=2,
            )
            ui.EveLabelMedium(
                parent=row,
                align=ui.Align.to_left,
                width=430,
                text=text,
                padTop=8,
            )
            if button_label and callback:
                ui.Button(
                    parent=row,
                    align=ui.Align.to_right,
                    width=90,
                    label=button_label,
                    func=callback,
                )

        def _heading(self, ui, text):
            ui.EveLabelLarge(
                parent=self._scroll,
                align=ui.Align.to_top,
                text=text,
                padTop=10,
                padBottom=4,
            )

        def _render(self, ui):
            if not self._presenter.trusted:
                self.Close()
                return
            state = self._presenter.state
            self.SetCaption(
                "NPC Fitting: {}".format(
                    _evejs_value(state, "displayName", "NPC ship")
                )
            )
            self._summary_label.text = (
                "Hull type {}  |  trust: {}"
            ).format(
                _evejs_value(_evejs_value(state, "hull", {}), "typeID", 0),
                str(_evejs_value(state, "trustReason", "confirmed"))
                .replace("-", " "),
            )
            self._status_label.text = self._presenter.status
            self._scroll.Flush()

            self._heading(ui, "Fitted modules")
            if not self._presenter.modules:
                self._row(ui, "No player-compatible modules are fitted")
            for module in self._presenter.modules:
                module_id = int(_evejs_value(module, "moduleID", 0) or 0)
                selected = module_id == self._presenter.selected_module_id
                online = "online" if _evejs_value(
                    module, "online", False
                ) else "offline"
                text = "{}{}  [{} / {}]".format(
                    "> " if selected else "",
                    _evejs_value(module, "itemName", "Module"),
                    _evejs_value(module, "semanticRole", "module"),
                    online,
                )
                self._row(
                    ui,
                    text,
                    "Select" if not selected else "Unfit",
                    (
                        lambda *args, module_id=module_id:
                        self._on_select(module_id)
                    ) if not selected else (
                        lambda *args, module_id=module_id:
                        self._on_unfit(module_id)
                    ),
                )
                for charge in _evejs_list(
                    _evejs_value(module, "charges", [])
                ):
                    cargo_id = int(
                        _evejs_value(charge, "cargoID", 0) or 0
                    )
                    self._row(
                        ui,
                        "    {} x{}".format(
                            _evejs_value(charge, "itemName", "Charge"),
                            _evejs_value(charge, "quantity", 0),
                        ),
                        "Unload",
                        lambda *args, cargo_id=cargo_id:
                        self._on_unload(cargo_id),
                    )

            self._heading(ui, "Modules in active ship cargo")
            if not self._presenter.available_modules:
                self._row(ui, "No compatible module items are available")
            for item in self._presenter.available_modules:
                item_id = int(_evejs_value(item, "itemID", 0) or 0)
                self._row(
                    ui,
                    "{} x{}".format(
                        _evejs_value(item, "itemName", "Module"),
                        _evejs_value(item, "quantity", 1),
                    ),
                    "Fit",
                    lambda *args, item_id=item_id: self._on_fit(item_id),
                )

            self._heading(ui, "Charges in active ship cargo")
            if not self._presenter.available_charges:
                self._row(ui, "No ammunition or fuel is available")
            for item in self._presenter.available_charges:
                item_id = int(_evejs_value(item, "itemID", 0) or 0)
                self._row(
                    ui,
                    "{} x{}".format(
                        _evejs_value(item, "itemName", "Charge"),
                        _evejs_value(item, "quantity", 1),
                    ),
                    "Load",
                    lambda *args, item_id=item_id: self._on_load(item_id),
                )

        def _execute(self, callback):
            try:
                callback()
            except Exception as error:
                failure_status = "NPC fitting failed: {}".format(error)
                self._presenter.status = failure_status
                # A denied mutation can mean trust was revoked between the
                # menu/open check and this click. Revalidate and fail closed.
                try:
                    self._presenter.refresh()
                except Exception:
                    self.Close()
                    return
                if self._presenter.trusted:
                    self._presenter.status = failure_status
            self._render(eveui)

        def _on_refresh(self, *args):
            self._execute(self._presenter.refresh)

        def _on_select(self, module_id):
            self._presenter.select_module(module_id)
            self._render(eveui)

        def _on_fit(self, item_id):
            self._execute(lambda: self._presenter.fit(item_id))

        def _on_unfit(self, module_id):
            self._execute(lambda: self._presenter.unfit(module_id))

        def _on_load(self, item_id):
            self._execute(lambda: self._presenter.load(item_id))

        def _on_unload(self, cargo_id):
            self._execute(lambda: self._presenter.unload(cargo_id))

        def AcceptTrustedState(self, state):
            self._presenter.accept(state)
            self._render(eveui)

    namespace["_evejs_npc_fitting_window_type"] = NpcFittingWindow
    return NpcFittingWindow


def _evejs_open_npc_fitting_window(namespace, entity_id, state):
    if not _evejs_is_trusted_npc_fitting_state(state):
        return None
    window_type = _evejs_npc_fitting_window_type(namespace)
    existing = window_type.GetIfOpen()
    if existing is not None:
        existing.AcceptTrustedState(state)
        return existing
    return window_type.Open(
        npc_entity_id=entity_id,
        initial_state=state,
    )


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

        def open_npc_fitting(self, entity_id, *args, **kwargs):
            # The server owns both the trust decision and fitting data. A
            # denied or failed check must never construct the window.
            try:
                state = _evejs_get_npc_fitting_state(namespace, entity_id)
            except Exception:
                return None
            if not _evejs_is_trusted_npc_fitting_state(state):
                return None
            return _evejs_open_npc_fitting_window(
                namespace, entity_id, state
            )

        open_window.__func__._evejs_fitting_compatibility_patch = True
        toggle_window.__func__._evejs_fitting_compatibility_patch = True
        open_fitting._evejs_fitting_compatibility_patch = True
        fitting_window.Open = open_window
        fitting_window.ToggleOpenClose = toggle_window
        command_type.OpenFitting = open_fitting
        command_type.OpenNpcFitting = open_npc_fitting

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
