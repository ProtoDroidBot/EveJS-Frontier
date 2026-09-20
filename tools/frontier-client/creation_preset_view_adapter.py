"""Native Creation-management Presets tab for Frontier build 3502403."""

import builtins
from functools import wraps


_EVEJS_PRESETS_TAB_ID = "evejs_creation_presets"


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


def _evejs_result_success(result):
    return _evejs_value(result, "success", False) is True


def _evejs_result_reason(result, fallback):
    diagnostics = _evejs_list(_evejs_value(result, "diagnostics", []))
    reasons = []
    for diagnostic in diagnostics:
        params = _evejs_value(diagnostic, "params", {})
        reason = _evejs_value(params, "reason", None)
        if reason:
            reasons.append(str(reason).replace("_", " ").title())
    return ", ".join(reasons) if reasons else fallback


def _evejs_runtime_global(namespace, name):
    value = namespace.get(name)
    if value is not None:
        return value
    return getattr(builtins, name, None)


class _EvejsCreationPresetPresenter:
    """Small state machine kept independent from CarbonUI for regression tests."""

    def __init__(self, service, creation_id, creation_type_id=None):
        self.service = service
        self.creation_id = creation_id
        self.creation_type_id = creation_type_id
        self.presets = []
        self.selected_id = None
        self.preview = None
        self.status = ""

    @property
    def selected(self):
        for preset in self.presets:
            if str(_evejs_value(preset, "presetID", "")) == self.selected_id:
                return preset
        return None

    @property
    def can_apply(self):
        if not _evejs_result_success(self.preview):
            return False
        data = _evejs_value(self.preview, "data", {})
        return bool(_evejs_value(data, "previewToken", ""))

    def refresh(self):
        selected_id = self.selected_id
        self.presets = _evejs_list(self.service.list_creation_presets())
        available = {
            str(_evejs_value(preset, "presetID", ""))
            for preset in self.presets
        }
        self.selected_id = selected_id if selected_id in available else None
        self.preview = None
        self.status = "{} preset{} available".format(
            len(self.presets), "" if len(self.presets) == 1 else "s"
        )
        return self.presets

    def select(self, preset_id):
        self.selected_id = str(preset_id or "") or None
        self.preview = None
        selected = self.selected
        self.status = (
            "Selected {}".format(_evejs_value(selected, "name", "preset"))
            if selected is not None else "Preset not found"
        )
        return selected

    def save(self, name, description=""):
        clean_name = str(name or "").strip()
        if not clean_name:
            self.status = "Enter a preset name"
            return None
        result = self.service.save_creation_preset(
            self.creation_id, clean_name, str(description or "")
        )
        if _evejs_result_success(result):
            saved = _evejs_value(result, "data", {})
            saved_id = str(_evejs_value(saved, "presetID", ""))
            self.refresh()
            self.select(saved_id)
            self.status = "Preset saved"
        else:
            self.preview = None
            self.status = _evejs_result_reason(result, "Preset save failed")
        return result

    def rename(self, name, description=""):
        if self.selected is None:
            self.status = "Select a preset first"
            return None
        clean_name = str(name or "").strip()
        if not clean_name:
            self.status = "Enter a preset name"
            return None
        preset_id = self.selected_id
        result = self.service.rename_creation_preset(
            preset_id, clean_name, str(description or "")
        )
        self.preview = None
        if _evejs_result_success(result):
            self.refresh()
            self.select(preset_id)
            self.status = "Preset renamed; preview again before applying"
        else:
            self.status = _evejs_result_reason(result, "Preset rename failed")
        return result

    def delete(self):
        if self.selected is None:
            self.status = "Select a preset first"
            return None
        result = self.service.delete_creation_preset(self.selected_id)
        self.preview = None
        if _evejs_result_success(result):
            self.selected_id = None
            self.refresh()
            self.status = "Preset deleted"
        else:
            self.status = _evejs_result_reason(result, "Preset delete failed")
        return result

    def preview_selected(self):
        if self.selected is None:
            self.status = "Select a preset first"
            return None
        self.preview = self.service.preview_creation_preset(
            self.creation_id, self.selected_id
        )
        if _evejs_result_success(self.preview):
            self.status = "Preview valid; Apply is enabled"
        else:
            self.status = _evejs_result_reason(
                self.preview, "Preset cannot be applied"
            )
        return self.preview

    def apply_selected(self):
        if not self.can_apply:
            self.status = "Preview this preset before applying"
            return None
        data = _evejs_value(self.preview, "data", {})
        token = _evejs_value(data, "previewToken", "")
        result = self.service.apply_creation_preset(
            self.creation_id, self.selected_id, token
        )
        self.preview = None
        if _evejs_result_success(result):
            selected_id = self.selected_id
            self.refresh()
            self.select(selected_id)
            self.status = "Preset applied"
        else:
            self.status = _evejs_result_reason(
                result, "Preset apply failed; preview again"
            )
        return result

    def selected_details(self):
        preset = self.selected
        if preset is None:
            return "Select a preset to inspect its validated composition."
        summary = _evejs_value(preset, "summary", {})
        preset_type_id = _evejs_value(preset, "creationTypeID", 0)
        hull_compatible = (
            self.creation_type_id in (None, 0) or
            int(preset_type_id or 0) == int(self.creation_type_id or 0)
        )
        sde_compatible = _evejs_value(summary, "sdeCompatible", False)
        return (
            "Hull type: {type_id} ({hull})   SDE: {sde}\n"
            "Modules: {modules} ({interior} interior, {exterior} exterior)   "
            "Occupied cells: {cells}\n{description}"
        ).format(
            type_id=preset_type_id,
            hull="compatible" if hull_compatible else "incompatible",
            sde="compatible" if sde_compatible else "stale/incompatible",
            modules=_evejs_value(summary, "moduleCount", 0),
            interior=_evejs_value(summary, "interiorModuleCount", 0),
            exterior=_evejs_value(summary, "exteriorModuleCount", 0),
            cells=_evejs_value(summary, "cellCount", 0),
            description=_evejs_value(preset, "description", "") or
            "No description",
        )

    def preview_details(self):
        if self.preview is None:
            return "Preview calculates the load diff and validates blockers."
        data = _evejs_value(self.preview, "data", {})

        def quantities(key):
            entries = _evejs_list(_evejs_value(data, key, []))
            return sum(int(_evejs_value(entry, "quantity", 0) or 0)
                       for entry in entries)

        additions = quantities("additions")
        removals = quantities("removals")
        missing = quantities("missing")
        diagnostics = _evejs_result_reason(self.preview, "None")
        capacities = _evejs_value(data, "capacities", {})
        cargo = _evejs_value(capacities, "cargo", {})
        return (
            "Load diff: +{additions} / -{removals}; missing {missing}\n"
            "Cargo: {used_before} -> {used_after} used, "
            "{capacity} capacity\nBlockers: {diagnostics}"
        ).format(
            additions=additions,
            removals=removals,
            missing=missing,
            used_before=_evejs_value(cargo, "usedBefore", 0),
            used_after=_evejs_value(cargo, "usedAfter", 0),
            capacity=_evejs_value(cargo, "after", 0),
            diagnostics=diagnostics,
        )


def _evejs_active_creation_type_id(service):
    try:
        creation = service.get_active_creation()
    except Exception:
        return None
    for name in ("type_id", "typeID", "typeid"):
        value = getattr(creation, name, None)
        if value:
            return value
    return None


def _evejs_install_creation_preset_view(namespace):
    management_view_type = namespace.get("ManagementView")
    if management_view_type is None:
        raise RuntimeError("Creation Presets patch could not find ManagementView")
    if getattr(management_view_type, "_evejs_creation_presets_patch", False):
        return

    from carbonui.control.button import Button
    from carbonui.control.scrollContainer import ScrollContainer
    from carbonui.control.singlelineedits.singleLineEditText import (
        SingleLineEditText,
    )

    Container = namespace["Container"]
    ContainerAutoSize = namespace["ContainerAutoSize"]
    Align = namespace["Align"]
    graviton = namespace["graviton"]
    normal_state = namespace.get("UI_NORMAL", 0)
    disabled_state = namespace.get("UI_DISABLED", 1)
    big_tab_type = namespace["BigTab"]

    class CreationPresetPanel(Container):
        def __init__(self, service, creation_id, creation_type_id=None, **kwargs):
            super().__init__(**kwargs)
            self._service = service
            self._presenter = _EvejsCreationPresetPresenter(
                service, creation_id, creation_type_id
            )
            self._pending_delete_id = None

            controls = ContainerAutoSize(
                parent=self,
                align=Align.TOTOP,
                padding=(24, 24, 24, 8),
            )
            self._name_edit = SingleLineEditText(
                parent=controls,
                align=Align.TOTOP,
                height=30,
                hintText="Preset name",
                maxLength=50,
            )
            self._description_edit = SingleLineEditText(
                parent=controls,
                align=Align.TOTOP,
                height=30,
                top=6,
                hintText="Description (optional)",
                maxLength=500,
            )
            action_row = Container(
                parent=controls, align=Align.TOTOP, height=34, top=8
            )
            Button(
                parent=action_row,
                align=Align.TOLEFT,
                width=78,
                label="Save",
                func=self._on_save,
            )
            Button(
                parent=action_row,
                align=Align.TOLEFT,
                width=78,
                left=6,
                label="Rename",
                func=self._on_rename,
            )
            Button(
                parent=action_row,
                align=Align.TOLEFT,
                width=78,
                left=12,
                label="Delete",
                func=self._on_delete,
            )
            Button(
                parent=action_row,
                align=Align.TORIGHT,
                width=78,
                label="Refresh",
                func=self._on_refresh,
            )
            apply_row = Container(
                parent=controls, align=Align.TOTOP, height=34, top=6
            )
            Button(
                parent=apply_row,
                align=Align.TOLEFT,
                width=100,
                label="Preview",
                func=self._on_preview,
            )
            self._apply_button = Button(
                parent=apply_row,
                align=Align.TOLEFT,
                width=100,
                left=6,
                label="Apply",
                func=self._on_apply,
            )
            self._status_text = graviton.Text(
                parent=controls,
                align=Align.TOTOP,
                top=8,
                text="",
            )
            self._details_text = graviton.Text(
                parent=controls,
                align=Align.TOTOP,
                top=8,
                text="",
            )
            self._preview_text = graviton.Text(
                parent=controls,
                align=Align.TOTOP,
                top=8,
                text="",
            )
            self._list = ScrollContainer(
                parent=self,
                align=Align.TOALL,
                padding=(24, 8, 24, 24),
            )
            signal = getattr(service, "on_creation_presets_changed", None)
            if signal is not None:
                try:
                    signal.connect(self._on_presets_changed)
                except Exception:
                    pass
            self._refresh()

        def _edit_value(self, edit):
            getter = getattr(edit, "GetValue", None)
            return getter() if getter is not None else getattr(edit, "text", "")

        def _set_edit_value(self, edit, value):
            setter = getattr(edit, "SetValue", None)
            if setter is not None:
                setter(value)
            else:
                edit.text = value

        def _refresh(self):
            try:
                self._presenter.refresh()
            except Exception as error:
                self._presenter.status = "Preset service error: {}".format(error)
            self._render()

        def _render(self):
            self._status_text.text = self._presenter.status
            self._details_text.text = self._presenter.selected_details()
            self._preview_text.text = self._presenter.preview_details()
            self._apply_button.state = (
                normal_state if self._presenter.can_apply else disabled_state
            )
            self._list.Flush()
            for preset in self._presenter.presets:
                preset_id = str(_evejs_value(preset, "presetID", ""))
                summary = _evejs_value(preset, "summary", {})
                selected = preset_id == self._presenter.selected_id
                label = "{}{}  |  {} modules / {} cells".format(
                    "> " if selected else "",
                    _evejs_value(preset, "name", "Unnamed"),
                    _evejs_value(summary, "moduleCount", 0),
                    _evejs_value(summary, "cellCount", 0),
                )
                Button(
                    parent=self._list,
                    align=Align.TOTOP,
                    height=32,
                    label=label,
                    func=lambda *args, preset_id=preset_id:
                    self._on_select(preset_id),
                )

        def _on_select(self, preset_id):
            self._pending_delete_id = None
            preset = self._presenter.select(preset_id)
            if preset is not None:
                self._set_edit_value(
                    self._name_edit, _evejs_value(preset, "name", "")
                )
                self._set_edit_value(
                    self._description_edit,
                    _evejs_value(preset, "description", ""),
                )
            self._render()

        def _on_refresh(self, *args):
            self._pending_delete_id = None
            self._refresh()

        def _on_save(self, *args):
            self._pending_delete_id = None
            self._presenter.save(
                self._edit_value(self._name_edit),
                self._edit_value(self._description_edit),
            )
            self._render()

        def _on_rename(self, *args):
            self._pending_delete_id = None
            self._presenter.rename(
                self._edit_value(self._name_edit),
                self._edit_value(self._description_edit),
            )
            self._render()

        def _on_delete(self, *args):
            preset_id = self._presenter.selected_id
            if preset_id is None:
                self._presenter.status = "Select a preset first"
            elif self._pending_delete_id != preset_id:
                self._pending_delete_id = preset_id
                self._presenter.status = "Press Delete again to confirm"
            else:
                self._pending_delete_id = None
                self._presenter.delete()
            self._render()

        def _on_preview(self, *args):
            self._pending_delete_id = None
            self._presenter.preview_selected()
            self._render()

        def _on_apply(self, *args):
            self._pending_delete_id = None
            self._presenter.apply_selected()
            self._render()

        def _on_presets_changed(self, *args):
            self._refresh()

        def Close(self, *args, **kwargs):
            signal = getattr(
                self._service, "on_creation_presets_changed", None
            )
            disconnect = getattr(signal, "disconnect", None)
            if disconnect is not None:
                try:
                    disconnect(self._on_presets_changed)
                except Exception:
                    pass
            return super().Close(*args, **kwargs)

    original_init = management_view_type.__init__
    original_on_tab_group = management_view_type.on_tab_group

    @wraps(original_init)
    def __init__(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        service_manager = _evejs_runtime_global(namespace, "sm")
        current_session = _evejs_runtime_global(namespace, "session")
        service = service_manager.GetService("creation")
        creation_id = getattr(current_session, "shipid", None)
        panel = CreationPresetPanel(
            parent=self,
            align=Align.TOALL,
            service=service,
            creation_id=creation_id,
            creation_type_id=_evejs_active_creation_type_id(service),
        )
        panel.display = False
        self._evejs_creation_presets_panel = panel
        self._evejs_preset_selected = False
        self._panels_by_tab_id[_EVEJS_PRESETS_TAB_ID] = panel
        self._tabs.AddTab(
            tabID=_EVEJS_PRESETS_TAB_ID,
            label="Presets",
            tabClass=big_tab_type,
        )

    @wraps(original_on_tab_group)
    def on_tab_group(self, selected_id, old_id):
        value_helper = namespace.get("_tab_id_value", lambda value: value)
        normalized = value_helper(selected_id)
        self._evejs_preset_selected = normalized == _EVEJS_PRESETS_TAB_ID
        if not self._evejs_preset_selected:
            return original_on_tab_group(self, selected_id, old_id)
        for tab_id, panel in self._panels_by_tab_id.items():
            panel.display = value_helper(tab_id) == normalized
        for part_controller in self._controller.parts:
            part_controller.is_editable = False
        service_manager = _evejs_runtime_global(namespace, "sm")
        if service_manager is not None:
            service_manager.ScatterEvent(
                namespace["MANAGEMENT_TAB_SELECTED_EVENT"],
                normalized,
                value_helper(old_id),
            )
        self._evejs_creation_presets_panel._refresh()

    __init__._evejs_creation_presets_patch = True
    on_tab_group._evejs_creation_presets_patch = True
    management_view_type.__init__ = __init__
    management_view_type.on_tab_group = on_tab_group
    management_view_type._evejs_creation_presets_patch = True
    namespace["CreationPresetPanel"] = CreationPresetPanel
