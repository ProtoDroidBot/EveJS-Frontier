"""Player fitting compatibility and server-trusted NPC fitting for 3502403."""

import builtins
from functools import wraps


_EVEJS_CREATION_TEMPLATE_TYPE_IDS = frozenset((95276, 95735, 95968))


def _evejs_value(value, key, default=None):
    if isinstance(value, dict):
        return value.get(key, default)
    return getattr(value, key, default)


def _evejs_npc_fitting_error_text(error):
    notice = _evejs_value(_evejs_value(error, "dict", {}), "notify")
    return str(notice or error)


def _evejs_list(value):
    if value is None:
        return []
    if isinstance(value, (list, tuple)):
        return list(value)
    return list(value)


def _evejs_service_manager(namespace):
    manager = namespace.get("sm") or getattr(builtins, "sm", None)
    if manager is None:
        raise RuntimeError("Client service manager is unavailable")
    return manager


def _evejs_patch_escrow_tree_node(node_type, controller_type, get_facility):
    """Give the native escrow tree the controller used by inventory entries."""
    if hasattr(node_type, "invController"):
        return False

    @property
    def inv_controller(self):
        controller = getattr(self, "_evejs_escrow_inv_controller", None)
        if controller is not None:
            return controller
        try:
            facility = get_facility(
                self._module_item_id, self._module_type_id,
                self._creation_id,
            )
        except Exception:
            facility = None
        try:
            controller = controller_type(
                facility, self._module_item_id, self._module_type_id,
            )
        except Exception:
            return None
        # The controller's itemID keeps this tree branch addressable while a
        # facility is unavailable. The native container retries the lookup.
        if facility is not None:
            self._evejs_escrow_inv_controller = controller
        return controller

    node_type.invController = inv_controller
    return True


def _evejs_install_escrow_tree_controller():
    from frontier.industry.client.inventory import tree_node
    from frontier.industry.client.inventory.escrow_inv_cont import (
        EscrowInvController,
    )

    return _evejs_patch_escrow_tree_node(
        tree_node.TreeDataEscrowSection,
        EscrowInvController,
        tree_node._get_facility_instance,
    )


def _evejs_npc_fitting_remote(namespace):
    return _evejs_service_manager(namespace).RemoteSvc("npcFittingMgr")


def _evejs_get_npc_fitting_state(namespace, entity_id):
    return _evejs_npc_fitting_remote(namespace).GetNpcFittingState(entity_id)


_evejs_npc_creation_target = None


class _EvejsNpcCreationServiceProxy:
    """Creation management service scoped to one server-authorized NPC ship."""

    def __init__(self, original, remote, entity_id, initial_snapshot):
        self._original = original
        self._remote = remote
        self._entity_id = int(entity_id)
        self._snapshot = initial_snapshot
        self.on_active_creation_changed = type(
            original.on_active_creation_changed
        )()

    def __getattr__(self, name):
        return getattr(self._original, name)

    def _get_target_creation(self):
        from frontier.creation.common.model import Creation

        snapshot = self._remote.GetNpcCreationSnapshot(self._entity_id)
        if int(_evejs_value(snapshot, "item_id", 0) or 0) != self._entity_id:
            raise RuntimeError("NPC Creation target changed")
        self._snapshot = snapshot
        return Creation.from_dict(snapshot)

    def get_active_creation(self):
        return self._get_target_creation()

    def get_creation(self, creation_id):
        if int(creation_id or 0) == self._entity_id:
            return self._get_target_creation()
        return self._original.get_creation(creation_id)

    def commit_management_draft(self, creation_id, changes):
        from frontier.creation.common.diagnostics import Diagnostic

        # The retail manager passes session.shipid here. The proxy pins the
        # commit to the target selected when the view was opened.
        payload = [change.to_dict() for change in changes]
        results = self._remote.CommitNpcCreationDraft(
            self._entity_id, payload
        )
        diagnostics = [Diagnostic.from_dict(result) for result in results]
        if not any(entry.is_blocker for entry in diagnostics):
            self._get_target_creation()
            self.on_active_creation_changed(self._entity_id)
        return diagnostics


def _evejs_install_npc_creation_view_bridge(namespace):
    try:
        from frontier.creation.client.management import view_state
    except Exception:
        return False

    integration = view_state.ManagementViewIntegration
    if getattr(integration, "_evejs_npc_creation_bridge", False):
        return True
    original_unload = view_state.ManagementViewState.UnloadView

    @wraps(integration)
    def target_integration(*args, **kwargs):
        target = _evejs_npc_creation_target
        if target is None:
            return integration(*args, **kwargs)
        if args:
            args = list(args)
            args[0] = _EvejsNpcCreationServiceProxy(
                args[0], target["remote"], target["entity_id"],
                target["snapshot"],
            )
            return integration(*args, **kwargs)
        kwargs["creation_service"] = _EvejsNpcCreationServiceProxy(
            kwargs["creation_service"], target["remote"],
            target["entity_id"], target["snapshot"],
        )
        return integration(**kwargs)

    @wraps(original_unload)
    def unload_view(self, *args, **kwargs):
        global _evejs_npc_creation_target
        try:
            return original_unload(self, *args, **kwargs)
        finally:
            _evejs_npc_creation_target = None

    target_integration._evejs_npc_creation_bridge = True
    view_state.ManagementViewIntegration = target_integration
    view_state.ManagementViewState.UnloadView = unload_view
    return True


def _evejs_open_npc_creation_view(namespace, entity_id, state, original_open,
                                  fitting_window):
    global _evejs_npc_creation_target
    remote = _evejs_npc_fitting_remote(namespace)
    snapshot = remote.GetNpcCreationSnapshot(entity_id)
    if int(_evejs_value(snapshot, "item_id", 0) or 0) != int(entity_id):
        raise RuntimeError("NPC Creation snapshot target changed")
    if not _evejs_install_npc_creation_view_bridge(namespace):
        raise RuntimeError("Creation management view is unavailable")
    target = {
        "remote": remote,
        "entity_id": int(entity_id),
        "snapshot": snapshot,
        "state": state,
    }
    previous = _evejs_npc_creation_target
    _evejs_npc_creation_target = target
    try:
        return original_open(fitting_window)
    except Exception:
        _evejs_npc_creation_target = previous
        raise


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
        try:
            return _evejs_list(_evejs_value(self.state, "modules", []))
        except Exception:
            return []

    @property
    def available_modules(self):
        try:
            return _evejs_list(
                _evejs_value(self.state, "availableModules", [])
            )
        except Exception:
            return []

    @property
    def available_charges(self):
        try:
            return _evejs_list(
                _evejs_value(self.state, "availableCharges", [])
            )
        except Exception:
            return []

    def accept(self, state):
        self.state = state
        available = set()
        for module in self.modules:
            try:
                available.add(int(_evejs_value(module, "moduleID", 0) or 0))
            except Exception:
                continue
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


class _EvejsNpcTargetController(_EvejsNpcFittingPresenter):
    """An NPC fitting draft bound to one server-authorized ship entity."""

    def __init__(self, remote, entity_id, initial_state):
        super().__init__(remote, entity_id, initial_state)
        self.accept(initial_state)

    def accept(self, state):
        if not _evejs_is_trusted_npc_fitting_state(state):
            raise RuntimeError("NPC fitting access is no longer trusted")
        if int(_evejs_value(state, "entityID", 0) or 0) != int(self.entity_id):
            raise RuntimeError("NPC fitting target changed")
        return super().accept(state)

    @property
    def fitting_path(self):
        return _evejs_value(
            self.state, "fittingPath",
            _evejs_value(_evejs_value(self.state, "hull", {}),
                         "fittingPath", None),
        )

    @property
    def hull_type_id(self):
        return int(_evejs_value(_evejs_value(self.state, "hull", {}),
                                "typeID", 0) or 0)

    def _fitted_signature(self):
        entries = []
        for module in self.modules:
            charges = tuple(sorted(
                (int(_evejs_value(charge, "cargoID", 0) or 0),
                 int(_evejs_value(charge, "typeID", 0) or 0),
                 int(_evejs_value(charge, "quantity", 0) or 0))
                for charge in _evejs_list(_evejs_value(module, "charges", []))
            ))
            entries.append((
                int(_evejs_value(module, "moduleID", 0) or 0),
                int(_evejs_value(module, "typeID", 0) or 0),
                int(_evejs_value(module, "flagID", 0) or 0),
                charges,
            ))
        return tuple(sorted(entries))

    def _cargo_item_for_type(self, items, type_id):
        for item in items:
            if int(_evejs_value(item, "typeID", 0) or 0) == type_id:
                item_id = int(_evejs_value(item, "itemID", 0) or 0)
                if item_id > 0:
                    return item_id
        raise RuntimeError(
            "Type {} is unavailable in your active ship cargo".format(type_id)
        )

    def apply_legacy_draft(self, module_rows, charge_rows=()):
        """Commit a native fitting simulation without ever targeting session.shipid."""
        if self.fitting_path != "legacy" or self.hull_type_id <= 0:
            raise RuntimeError("The NPC hull does not use legacy fitting")
        if len(module_rows) > 64 or len(charge_rows) > 64:
            raise RuntimeError("NPC fitting draft is too large")
        desired = {}
        for type_id, flag_id in module_rows:
            type_id, flag_id = int(type_id), int(flag_id)
            if type_id <= 0 or flag_id <= 0 or flag_id in desired:
                raise RuntimeError("NPC fitting draft has an invalid module slot")
            desired[flag_id] = type_id
        desired_charges = {}
        for type_id, flag_id in charge_rows:
            type_id, flag_id = int(type_id), int(flag_id)
            if type_id <= 0 or flag_id not in desired or flag_id in desired_charges:
                raise RuntimeError("NPC fitting draft has an invalid charge slot")
            desired_charges[flag_id] = type_id

        initial_signature = self._fitted_signature()
        self.refresh()
        if self._fitted_signature() != initial_signature:
            raise RuntimeError("NPC fitting changed; refresh the draft")

        current_by_flag = {
            int(_evejs_value(module, "flagID", 0) or 0):
            int(_evejs_value(module, "typeID", 0) or 0)
            for module in self.modules
        }
        required_by_type = {}
        for flag_id, type_id in desired.items():
            if current_by_flag.get(flag_id) != type_id:
                required_by_type[type_id] = required_by_type.get(type_id, 0) + 1
        for type_id, required in required_by_type.items():
            available = sum(
                max(0, int(_evejs_value(item, "quantity", 0) or 0))
                for item in self.available_modules
                if int(_evejs_value(item, "typeID", 0) or 0) == type_id
            )
            if available < required:
                raise RuntimeError(
                    "Type {} needs {} items in your active ship cargo".format(
                        type_id, required
                    )
                )
        required_charges = {}
        for flag_id, type_id in desired_charges.items():
            current = next((module for module in self.modules if int(
                _evejs_value(module, "flagID", 0) or 0
            ) == flag_id), None)
            loaded = _evejs_list(_evejs_value(current, "charges", []))
            if len(loaded) == 1 and int(
                _evejs_value(loaded[0], "typeID", 0) or 0
            ) == type_id and current_by_flag.get(flag_id) == desired[flag_id]:
                continue
            required_charges[type_id] = required_charges.get(type_id, 0) + 1
        for type_id, required in required_charges.items():
            available = sum(
                max(0, int(_evejs_value(item, "quantity", 0) or 0))
                for item in self.available_charges
                if int(_evejs_value(item, "typeID", 0) or 0) == type_id
            )
            if available < required:
                raise RuntimeError(
                    "Charge type {} is unavailable in your active ship cargo".format(
                        type_id
                    )
                )

        # Remove conflicts first. Each RPC returns a fresh server-authorized
        # target state; a denied or failed operation aborts the remaining draft.
        for module in list(self.modules):
            flag_id = int(_evejs_value(module, "flagID", 0) or 0)
            type_id = int(_evejs_value(module, "typeID", 0) or 0)
            if desired.get(flag_id) != type_id:
                for charge in _evejs_list(_evejs_value(module, "charges", [])):
                    self.unload(int(_evejs_value(charge, "cargoID", 0) or 0))
                self.unfit(int(_evejs_value(module, "moduleID", 0) or 0))

        for flag_id, type_id in sorted(desired.items()):
            if any(
                int(_evejs_value(module, "flagID", 0) or 0) == flag_id
                and int(_evejs_value(module, "typeID", 0) or 0) == type_id
                for module in self.modules
            ):
                continue
            item_id = self._cargo_item_for_type(self.available_modules, type_id)
            self.accept(self.remote.FitItem(self.entity_id, item_id, flag_id))

        for module in list(self.modules):
            flag_id = int(_evejs_value(module, "flagID", 0) or 0)
            wanted_type = desired_charges.get(flag_id)
            charges = _evejs_list(_evejs_value(module, "charges", []))
            if len(charges) == 1 and int(
                _evejs_value(charges[0], "typeID", 0) or 0
            ) == (wanted_type or 0):
                continue
            for charge in charges:
                self.unload(int(_evejs_value(charge, "cargoID", 0) or 0))
            if wanted_type:
                current = next((entry for entry in self.modules if int(
                    _evejs_value(entry, "flagID", 0) or 0
                ) == flag_id), None)
                if current is None:
                    raise RuntimeError("NPC module disappeared during fitting")
                item_id = self._cargo_item_for_type(
                    self.available_charges, wanted_type
                )
                self.accept(self.remote.LoadCharge(
                    self.entity_id,
                    int(_evejs_value(current, "moduleID", 0) or 0),
                    item_id,
                    0,
                ))
        return self.state


def _evejs_attribute(attributes, name, default=None):
    if isinstance(attributes, dict):
        return attributes.get(name, default)
    return getattr(attributes, name, default)


def _evejs_npc_fitting_window_type(namespace):
    cached = namespace.get("_evejs_npc_fitting_window_class")
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
            actions = ui.Container(
                parent=header,
                align=ui.Align.to_top,
                height=32,
                padTop=8,
            )
            try:
                ui.Button(
                    parent=actions,
                    align=ui.Align.to_right,
                    label="Refresh",
                    func=self._on_refresh,
                )
            except Exception as error:
                self._presenter.status = "Refresh unavailable: {}".format(
                    error
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
            try:
                ui.EveLabelLarge(
                    parent=self._scroll,
                    align=ui.Align.to_top,
                    text=text,
                    padTop=10,
                    padBottom=4,
                )
            except Exception:
                pass

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
                try:
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
                except Exception:
                    continue
                try:
                    charges = _evejs_list(_evejs_value(module, "charges", []))
                except Exception:
                    charges = []
                for charge in charges:
                    try:
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
                    except Exception:
                        continue

            self._heading(ui, "Modules in active ship cargo")
            if not self._presenter.available_modules:
                self._row(ui, "No compatible module items are available")
            for item in self._presenter.available_modules:
                try:
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
                except Exception:
                    continue

            self._heading(ui, "Charges in active ship cargo")
            if not self._presenter.available_charges:
                self._row(ui, "No ammunition or fuel is available")
            for item in self._presenter.available_charges:
                try:
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
                except Exception:
                    continue

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
            try:
                self._presenter.select_module(module_id)
            except Exception as error:
                self._presenter.status = "NPC fitting selection failed: {}".format(
                    error
                )
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

    namespace["_evejs_npc_fitting_window_class"] = NpcFittingWindow
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


def _evejs_legacy_slot_flags():
    from inventorycommon import const as inv_const
    groups = (
        "hiSlotFlags", "medSlotFlags", "loSlotFlags",
        "rigSlotFlags", "subSystemSlotFlags",
    )
    flags = set()
    for name in groups:
        try:
            flags.update(int(value) for value in getattr(inv_const, name, ()))
        except Exception:
            continue
    return flags


def _evejs_legacy_draft_from_snapshot(snapshot, hull_type_id):
    if int(_evejs_value(snapshot, "shipTypeID", 0) or 0) != hull_type_id:
        raise RuntimeError("The native fitting draft is for another hull")
    flags = _evejs_legacy_slot_flags()
    if not flags:
        raise RuntimeError("Native fitting slot definitions are unavailable")
    modules = []
    for row in _evejs_list(_evejs_value(snapshot, "fitData", [])):
        try:
            if len(row) >= 2 and int(row[1]) in flags:
                modules.append((int(row[0]), int(row[1])))
        except Exception as error:
            raise RuntimeError("Native fitting snapshot has an invalid module") from error
    charges = []
    for row in _evejs_list(_evejs_value(snapshot, "chargeInfoToLoad", [])):
        try:
            if len(row) >= 2 and int(row[1]) in flags:
                charges.append((int(row[0]), int(row[1])))
        except Exception as error:
            raise RuntimeError("Native fitting snapshot has an invalid charge") from error
    return modules, charges


def _evejs_npc_legacy_window_type(namespace):
    cached = namespace.get("_evejs_npc_legacy_window_class")
    if cached is not None:
        return cached
    fitting_window = namespace["FittingWindow"]
    import eveui

    class NpcLegacyFittingWindow(fitting_window):
        default_windowID = "evejs_npc_legacy_fitting"
        default_caption = "NPC Legacy Fitting"

        @classmethod
        def Open(cls, *args, **kwargs):
            # Skip Frontier's Creation-only override and use the retail
            # FittingWindow implementation for this dedicated NPC instance.
            return super(fitting_window, cls).Open(*args, **kwargs)

        def ApplyAttributes(self, attributes):
            self._evejs_target = _evejs_attribute(attributes, "npc_target")
            self._evejs_sim_ship_id = _evejs_attribute(
                attributes, "npc_sim_ship_id"
            )
            if self._evejs_target is None or not self._evejs_sim_ship_id:
                raise RuntimeError("Native NPC fitting target is unavailable")
            super().ApplyAttributes(attributes)

        def ConstructLayout(self):
            super().ConstructLayout()
            target = getattr(self, "_evejs_target", None)
            if target is None:
                return
            # The retail fitting-name link and drag gesture save a fitting
            # through fittingSvc for the simulated ship's owner. NPC pilots
            # have no player fitting manager, so these gestures must stay in
            # the target-bound editor instead of calling that player path.
            try:
                fit_name = self.fitNameParent
                fit_name.GetDragData = lambda *args: []
                fit_name.isDragObject = False
            except Exception:
                pass
            footer = eveui.Container(
                parent=self.overlayCont,
                align=eveui.Align.to_bottom,
                height=36,
            )
            self._evejs_status = eveui.EveLabelMedium(
                parent=footer,
                align=eveui.Align.to_left,
                text="Edit the draft, then apply it to the NPC",
            )
            eveui.Button(
                parent=footer,
                align=eveui.Align.to_right,
                label="Apply to NPC",
                func=self._evejs_apply,
            )

        def OpenFittingForCurrentShip(self, *args):
            try:
                self._evejs_status.text = (
                    "Use Apply to NPC to commit this fitting"
                )
            except Exception:
                pass
            return None

        def ConstructCurrentGhostIcon(self, parent):
            result = super().ConstructCurrentGhostIcon(parent)
            try:
                self.currentShipGhost.SetShipTypeID(
                    self._evejs_target.hull_type_id
                )
            except Exception:
                pass
            return result

        def _evejs_apply(self, *args):
            target = getattr(self, "_evejs_target", None)
            if target is None:
                return
            try:
                service_manager = _evejs_service_manager(namespace)
                if service_manager.GetService(
                    "fittingSvc"
                ).IsShipSimulated() is not True:
                    raise RuntimeError("Native fitting simulation is no longer active")
                ghost = service_manager.GetService("ghostFittingSvc")
                if ghost.fittingDogmaLocation.GetCurrentShipID() != (
                    self._evejs_sim_ship_id
                ):
                    raise RuntimeError("Native fitting target changed")
                snapshot = ghost.TakeSnapshot()
                modules, charges = _evejs_legacy_draft_from_snapshot(
                    snapshot, target.hull_type_id
                )
                target.apply_legacy_draft(modules, charges)
                self._evejs_status.text = "NPC fitting applied"
            except Exception as error:
                try:
                    target.refresh()
                except Exception:
                    self.Close()
                    return
                self._evejs_status.text = "NPC fitting failed: {}".format(
                    _evejs_npc_fitting_error_text(error)
                )

    namespace["_evejs_npc_legacy_window_class"] = NpcLegacyFittingWindow
    return NpcLegacyFittingWindow


def _evejs_open_npc_legacy_window(namespace, entity_id, state):
    target = _EvejsNpcTargetController(
        _evejs_npc_fitting_remote(namespace), entity_id, state
    )
    if target.fitting_path != "legacy" or target.hull_type_id <= 0:
        raise RuntimeError("NPC hull is not eligible for legacy fitting")
    service_manager = _evejs_service_manager(namespace)
    fitting_service = service_manager.GetService("fittingSvc")
    if fitting_service.IsShipSimulated():
        raise RuntimeError("Close the current fitting simulation first")
    if namespace["FittingWindow"].GetIfOpen() is not None:
        raise RuntimeError("Close the current ship fitting window first")
    legacy_window_type = _evejs_npc_legacy_window_type(namespace)
    existing = legacy_window_type.GetIfOpen()
    if existing is not None:
        existing.Close()
    ghost = service_manager.GetService("ghostFittingSvc")
    fit_data = []
    expected_modules = set()
    expected_charges = set()
    for module in target.modules:
        type_id = int(_evejs_value(module, "typeID", 0) or 0)
        flag_id = int(_evejs_value(module, "flagID", 0) or 0)
        module_id = int(_evejs_value(module, "moduleID", 0) or 0)
        if type_id <= 0 or flag_id <= 0 or module_id <= 0:
            raise RuntimeError("NPC has an invalid fitted module")
        fit_data.append((type_id, flag_id, 1))
        expected_modules.add((type_id, flag_id))
        for charge in _evejs_list(_evejs_value(module, "charges", [])):
            charge_type = int(_evejs_value(charge, "typeID", 0) or 0)
            if charge_type <= 0:
                raise RuntimeError("NPC has an invalid fitted charge")
            expected_charges.add((charge_type, flag_id))
    ghost.fittingName = "NPC: {}".format(
        _evejs_value(state, "displayName", "Ship")
    )
    try:
        ghost.LoadSimulatedFitting(
            target.hull_type_id,
            entity_id,
            int(_evejs_value(state, "npcCharacterID", 0) or 0),
            fit_data,
            {},
        )
        for module in target.modules:
            flag_id = int(_evejs_value(module, "flagID", 0) or 0)
            for charge in _evejs_list(_evejs_value(module, "charges", [])):
                ghost.FitAmmoToLocation(
                    flag_id, int(_evejs_value(charge, "typeID", 0) or 0)
                )
        sim_ship_id = ghost.fittingDogmaLocation.GetCurrentShipID()
        if not sim_ship_id:
            raise RuntimeError("Native fitting simulation did not load the NPC hull")
        loaded_modules, loaded_charges = _evejs_legacy_draft_from_snapshot(
            ghost.TakeSnapshot(), target.hull_type_id
        )
        if set(loaded_modules) != expected_modules or (
            set(loaded_charges) != expected_charges
        ):
            raise RuntimeError("Native simulation could not represent the NPC fit")
        return legacy_window_type.Open(
            shipID=sim_ship_id,
            npc_target=target,
            npc_sim_ship_id=sim_ship_id,
        )
    except Exception:
        try:
            fitting_service.SetSimulationState(False)
        except Exception:
            pass
        try:
            ghost.ResetFittingDomaLocation(force=True)
        except Exception:
            pass
        raise


def _evejs_get_active_ship(namespace, ship_id):
    """Resolve the active ship in both space and station dogma locations."""
    service_manager = _evejs_service_manager(namespace)
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


_EVEJS_CREATION_LEAP_TYPE_ID = 95319


def _evejs_creation_leap_item_ids(provider, ship_id):
    creation = provider.get_creation(ship_id)
    if creation is None:
        return []
    try:
        modules = creation.modules.values()
    except Exception:
        return []
    item_ids = []
    for module in modules:
        try:
            if module.type_id == _EVEJS_CREATION_LEAP_TYPE_ID:
                item_ids.append(module.item_id)
        except Exception:
            continue
    return item_ids


def _evejs_release_creation_leaps(provider, ship_id, item_ids):
    first_error = None
    for item_id in item_ids:
        try:
            provider.deactivate(ship_id, item_id)
        except Exception as error:
            # A failed module must not prevent the other fitted Leaps stopping.
            if first_error is None:
                first_error = error
    if first_error is not None:
        raise first_error


def _evejs_install_creation_leap_command(namespace):
    command_type = namespace.get("EveCommandService")
    if command_type is None or not all(
        hasattr(command_type, name)
        for name in ("_leap_target", "_leap_engage", "_leap_disengage")
    ):
        return
    original_target = command_type._leap_target
    if getattr(original_target, "_evejs_creation_leap_patch", False):
        return
    original_engage = command_type._leap_engage
    original_disengage = command_type._leap_disengage

    @wraps(original_target)
    def leap_target(self):
        if not _evejs_active_ship_uses_creation(namespace):
            return original_target(self)
        ship_id = getattr(namespace.get("session"), "shipid", None)
        if not ship_id:
            return None
        try:
            creation_service = _evejs_service_manager(namespace).GetService(
                "creation"
            )
            return creation_service.get_module_action_provider(), ship_id
        except Exception:
            return None

    @wraps(original_engage)
    def leap_engage(self):
        if not _evejs_active_ship_uses_creation(namespace):
            return original_engage(self)
        target = self._leap_target()
        if target is None:
            return False
        provider, ship_id = target
        item_ids = _evejs_creation_leap_item_ids(provider, ship_id)
        activated = False
        first_error = None
        for item_id in item_ids:
            try:
                if provider.activate(ship_id, item_id) is not None:
                    activated = True
            except Exception as error:
                if first_error is None:
                    first_error = error
        if not activated and first_error is not None:
            raise first_error
        return activated

    @wraps(original_disengage)
    def leap_disengage(self):
        if not _evejs_active_ship_uses_creation(namespace):
            return original_disengage(self)
        target = self._leap_target()
        if target is None:
            return False
        provider, ship_id = target
        item_ids = _evejs_creation_leap_item_ids(provider, ship_id)
        if not item_ids:
            return False
        worker = getattr(namespace.get("uthread"), "new", None)
        if worker is not None:
            worker(_evejs_release_creation_leaps, provider, ship_id, item_ids)
        else:
            _evejs_release_creation_leaps(provider, ship_id, item_ids)
        return True

    leap_target._evejs_creation_leap_patch = True
    command_type._leap_target = leap_target
    command_type._leap_engage = leap_engage
    command_type._leap_disengage = leap_disengage


def _evejs_install_fitting_compatibility(namespace):
    command_type = namespace.get("EveCommandService")
    fitting_window = namespace.get("FittingWindow")
    if command_type is None or fitting_window is None:
        raise RuntimeError("Frontier fitting patch could not find its client types")

    try:
        _evejs_install_escrow_tree_controller()
    except Exception:
        # Escrow is optional during early client import. Keep fitting usable
        # and retry when a trusted NPC fitting view is opened.
        pass

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
            if _evejs_value(state, "fittingPath") == "legacy":
                try:
                    try:
                        _evejs_install_escrow_tree_controller()
                    except Exception:
                        pass
                    return _evejs_open_npc_legacy_window(
                        namespace, entity_id, state
                    )
                except Exception as error:
                    # Keep the trusted NPC RPC editor available when a
                    # client-specific native controller operation fails.
                    fallback = _evejs_open_npc_fitting_window(
                        namespace, entity_id, state
                    )
                    if fallback is not None:
                        try:
                            fallback._presenter.status = (
                                "Native fitting unavailable: {}".format(error)
                            )
                            fallback._status_label.text = (
                                fallback._presenter.status
                            )
                        except Exception:
                            pass
                    return fallback
            if _evejs_value(state, "fittingPath") == "creation":
                try:
                    return _evejs_open_npc_creation_view(
                        namespace, entity_id, state, original_open,
                        fitting_window,
                    )
                except Exception as error:
                    fallback = _evejs_open_npc_fitting_window(
                        namespace, entity_id, state
                    )
                    if fallback is not None:
                        try:
                            fallback._presenter.status = (
                                "Creation view unavailable: {}".format(error)
                            )
                            fallback._status_label.text = (
                                fallback._presenter.status
                            )
                        except Exception:
                            pass
                    return fallback
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

    _evejs_install_creation_leap_command(namespace)

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
