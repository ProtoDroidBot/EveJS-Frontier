"""Trusted NPC fitting and assembly-access context actions for build 3502403."""

from functools import wraps
import uuid


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


def _evejs_assembly_access_remote(namespace):
    return namespace["sm"].RemoteSvc("smartAssemblyService")


def _evejs_assembly_access_available(namespace, item_id):
    try:
        _evejs_assembly_access_remote(namespace).get_assembly_access(
            item_id, []
        )
        return True
    except Exception:
        return False


def _evejs_capabilities(value):
    if isinstance(value, str):
        value = value.split(",")
    return list(dict.fromkeys(
        str(entry or "").strip().lower()
        for entry in _evejs_list(value)
        if str(entry or "").strip()
    ))


class _EvejsAssemblyAccessPresenter:
    """Server-authoritative state/actions, independent from CarbonUI for tests."""

    def __init__(self, namespace, item_id, remote=None):
        self.namespace = namespace
        self.item_id = int(item_id)
        self.remote = remote or _evejs_assembly_access_remote(namespace)
        self.access = {}
        self.requests = []
        self.grants = []
        self.events = []
        self.load_shedding = []
        self.status = ""

    @property
    def capabilities(self):
        return _evejs_capabilities(
            _evejs_value(self.access, "capabilities", [])
        )

    @property
    def is_owner(self):
        return _evejs_value(self.access, "isOwner", False) is True

    @property
    def can_manage(self):
        return self.is_owner or "manage_access" in self.capabilities

    def refresh(self):
        self.access = self.remote.get_assembly_access(self.item_id, [])
        self.requests = _evejs_list(
            self.remote.get_assembly_access_requests(self.item_id, {})
        )
        self.grants = _evejs_list(
            self.remote.get_assembly_access_grants(self.item_id, {})
        )
        try:
            event_page = self.remote.get_assembly_access_events(
                self.item_id, {"limit": 50}
            )
            self.events = _evejs_list(
                _evejs_value(event_page, "events", [])
            )
        except Exception:
            # The event log requires gui.view. A requester can still use the
            # access window to submit or withdraw its own pending request.
            self.events = []
        try:
            self.load_shedding = _evejs_list(
                self.remote.get_npc_load_shedding_requests(self.item_id)
            )
        except Exception:
            # Only a configure-capable player can review node policy work.
            self.load_shedding = []
        self.status = "Access policy revision {}".format(
            _evejs_value(self.access, "policyRevision", 0)
        )
        return self.access

    def request_access(self, capabilities, expires_in_ms, reason=""):
        request_id = str(uuid.uuid4())
        result = self.remote.request_assembly_access(
            self.item_id,
            _evejs_capabilities(capabilities),
            {
                "requestID": request_id,
                "idempotencyKey": request_id,
                "expiresInMs": int(expires_in_ms),
                "grantExpiresInMs": int(expires_in_ms),
                "reason": str(reason or "")[:500],
            },
        )
        self.refresh()
        self.status = "Access request submitted"
        return result

    def cancel_request(self, request_id, reason="Withdrawn in client"):
        result = self.remote.cancel_assembly_access_request(
            self.item_id, request_id, reason
        )
        self.refresh()
        self.status = "Access request withdrawn"
        return result

    def approve_request(self, request_id):
        result = self.remote.approve_assembly_access(
            self.item_id, request_id, {}
        )
        self.refresh()
        self.status = "Access request approved"
        return result

    def deny_request(self, request_id, reason="Denied in client"):
        result = self.remote.deny_assembly_access(
            self.item_id, request_id, reason
        )
        self.refresh()
        self.status = "Access request denied"
        return result

    def share_access(self, recipient, capabilities, expires_in_ms):
        operation_id = str(uuid.uuid4())
        result = self.remote.share_assembly_access(
            self.item_id,
            str(recipient or "").strip().lower(),
            _evejs_capabilities(capabilities),
            {
                "idempotencyKey": operation_id,
                "expiresInMs": int(expires_in_ms),
            },
        )
        self.refresh()
        self.status = "Assembly access shared"
        return result

    def revoke_grant(self, grant_id, reason="Revoked in client"):
        result = self.remote.revoke_assembly_access(
            self.item_id, grant_id, reason
        )
        self.refresh()
        self.status = "Assembly access removed"
        return result

    def open_shared_gui(self):
        gui_session = self.remote.open_shared_assembly_gui(
            self.item_id, {"expiresInMs": 300000}
        )
        token = str(_evejs_value(gui_session, "token", "") or "").strip()
        if not token:
            raise RuntimeError("Assembly GUI session did not include a token")
        # Treat the bearer token as a one-time admission proof.  Keeping it
        # out of the browser URL avoids leaking it through history, logs, or
        # referrers; privileged GUI RPCs continue to re-resolve the caller's
        # current grant on the server.
        self.remote.validate_shared_assembly_gui(
            self.item_id, token, "gui.view"
        )
        service = self.namespace["sm"].GetService("smartAssemblySvc")
        service.on_interaction(self.item_id)
        self.status = "Shared assembly session opened"
        return gui_session

    def approve_load_shedding(self, job_id, assembly_ids, reason):
        clean_reason = str(reason or "").strip()
        if not clean_reason:
            raise ValueError("A load-shedding approval reason is required")
        result = self.remote.approve_npc_load_shedding(
            job_id, list(assembly_ids), clean_reason
        )
        self.refresh()
        self.status = "NPC load-shedding plan approved"
        return result


def _evejs_attribute(attributes, name, default=None):
    if isinstance(attributes, dict):
        return attributes.get(name, default)
    return getattr(attributes, name, default)


def _evejs_assembly_access_window_type(namespace):
    cached = namespace.get("_evejs_assembly_access_window_type")
    if cached is not None:
        return cached

    import eveui
    from carbonui.control.scrollContainer import ScrollContainer
    from carbonui.control.singlelineedits.singleLineEditText import (
        SingleLineEditText,
    )

    base_window = namespace.get("Window")
    if base_window is None:
        from carbonui.control.window import Window as base_window

    class AssemblyAccessWindow(base_window):
        default_windowID = "evejs_assembly_access"
        default_caption = "Assembly Access"
        default_width = 760
        default_height = 700
        default_minSize = (620, 480)

        def ApplyAttributes(self, attributes):
            super().ApplyAttributes(attributes)
            item_id = _evejs_attribute(attributes, "assembly_item_id", 0)
            self._presenter = _EvejsAssemblyAccessPresenter(
                namespace, item_id
            )
            self._pending_action = None
            self._construct_layout(eveui, ScrollContainer, SingleLineEditText)
            self._execute(self._presenter.refresh)

        def _construct_layout(self, ui, scroll_type, edit_type):
            root = ui.Container(
                parent=self.GetMainArea(),
                align=ui.Align.to_all,
                padding=(16, 16, 16, 16),
            )
            controls = ui.ContainerAutoSize(
                parent=root, align=ui.Align.to_top
            )
            self._status_label = ui.EveLabelMedium(
                parent=controls,
                align=ui.Align.to_top,
                text="Loading assembly access...",
            )
            self._recipient_edit = edit_type(
                parent=controls,
                align=ui.Align.to_top,
                height=30,
                top=6,
                hintText=(
                    "Recipient: entity:player:ID, entity:npc:ID, "
                    "tribe:ID, or faction:ID-string"
                ),
                maxLength=128,
            )
            self._capabilities_edit = edit_type(
                parent=controls,
                align=ui.Align.to_top,
                height=30,
                top=6,
                hintText="Capabilities, comma separated",
                maxLength=256,
            )
            self._set_edit(
                self._capabilities_edit, "gui.view, operate"
            )
            self._expiry_edit = edit_type(
                parent=controls,
                align=ui.Align.to_top,
                height=30,
                top=6,
                hintText="Expiry in hours (1-720)",
                maxLength=3,
            )
            self._set_edit(self._expiry_edit, "24")
            self._reason_edit = edit_type(
                parent=controls,
                align=ui.Align.to_top,
                height=30,
                top=6,
                hintText="Approval reason (required for load shedding)",
                maxLength=512,
            )
            actions = ui.Container(
                parent=controls,
                align=ui.Align.to_top,
                height=34,
                top=8,
            )
            ui.Button(
                parent=actions,
                align=ui.Align.to_left,
                width=100,
                label="Request",
                func=self._on_request,
            )
            ui.Button(
                parent=actions,
                align=ui.Align.to_left,
                width=100,
                left=6,
                label="Share",
                func=self._on_share,
            )
            ui.Button(
                parent=actions,
                align=ui.Align.to_left,
                width=120,
                left=12,
                label="Open Assembly",
                func=self._on_open,
            )
            ui.Button(
                parent=actions,
                align=ui.Align.to_right,
                width=90,
                label="Refresh",
                func=self._on_refresh,
            )
            self._scroll = scroll_type(
                parent=root,
                align=ui.Align.to_all,
                padTop=12,
            )

        def _edit_value(self, edit):
            getter = getattr(edit, "GetValue", None)
            return getter() if getter is not None else getattr(edit, "text", "")

        def _set_edit(self, edit, value):
            setter = getattr(edit, "SetValue", None)
            if setter is not None:
                setter(value)
            else:
                edit.text = value

        def _expiry_ms(self):
            hours = int(self._edit_value(self._expiry_edit) or 0)
            if hours < 1 or hours > 720:
                raise ValueError("Expiry must be between 1 and 720 hours")
            return hours * 60 * 60 * 1000

        def _input_capabilities(self):
            capabilities = _evejs_capabilities(
                self._edit_value(self._capabilities_edit)
            )
            if not capabilities:
                raise ValueError("Select at least one capability")
            return capabilities

        def _heading(self, ui, text):
            ui.EveLabelLarge(
                parent=self._scroll,
                align=ui.Align.to_top,
                text=text,
                padTop=10,
                padBottom=4,
            )

        def _row(self, ui, text, actions=()):
            row = ui.Container(
                parent=self._scroll,
                align=ui.Align.to_top,
                height=38,
                padBottom=2,
            )
            ui.EveLabelMedium(
                parent=row,
                align=ui.Align.to_left,
                width=500,
                text=text,
                padTop=8,
            )
            offset = 0
            for label, callback in reversed(list(actions)):
                ui.Button(
                    parent=row,
                    align=ui.Align.to_right,
                    width=78,
                    right=offset,
                    label=label,
                    func=callback,
                )
                offset += 82

        def _render(self, ui):
            presenter = self._presenter
            self.SetCaption("Assembly Access: {}".format(presenter.item_id))
            self._status_label.text = presenter.status
            self._scroll.Flush()
            self._heading(ui, "Current access")
            source = "owner" if presenter.is_owner else "grant-derived"
            self._row(
                ui,
                "{} | {} | {}".format(
                    _evejs_value(presenter.access, "principal", "player"),
                    source,
                    ", ".join(presenter.capabilities) or "no capabilities",
                ),
            )

            self._heading(ui, "Requests")
            if not presenter.requests:
                self._row(ui, "No visible access requests")
            for request in presenter.requests:
                request_id = str(_evejs_value(request, "requestID", ""))
                status = str(_evejs_value(request, "status", "unknown"))
                requester = _evejs_value(
                    request, "requesterPrincipal", "unknown"
                )
                actions = []
                if status == "requested" and presenter.can_manage:
                    actions.extend((
                        ("Approve", lambda *args, request_id=request_id:
                         self._confirm_then(
                             ("approve", request_id),
                             lambda: presenter.approve_request(request_id),
                         )),
                        ("Deny", lambda *args, request_id=request_id:
                         self._confirm_then(
                             ("deny", request_id),
                             lambda: presenter.deny_request(request_id),
                         )),
                    ))
                principal = _evejs_value(
                    presenter.access, "principal", ""
                )
                if status == "requested" and requester == principal:
                    actions.append((
                        "Withdraw",
                        lambda *args, request_id=request_id:
                        self._confirm_then(
                            ("withdraw", request_id),
                            lambda: presenter.cancel_request(request_id),
                        ),
                    ))
                self._row(
                    ui,
                    "{} | {} | {}".format(
                        requester,
                        status,
                        ", ".join(_evejs_capabilities(
                            _evejs_value(request, "capabilities", [])
                        )),
                    ),
                    actions,
                )

            self._heading(ui, "Active grants")
            if not presenter.grants:
                self._row(ui, "No visible active grants")
            for grant in presenter.grants:
                grant_id = str(_evejs_value(grant, "grantID", ""))
                recipient = _evejs_value(
                    grant, "recipientPrincipal", "unknown"
                )
                authority = _evejs_value(grant, "authority", "local")
                actions = []
                if presenter.can_manage or recipient == _evejs_value(
                    presenter.access, "principal", ""
                ):
                    actions.append((
                        "Remove",
                        lambda *args, grant_id=grant_id:
                        self._confirm_then(
                            ("remove", grant_id),
                            lambda: presenter.revoke_grant(grant_id),
                        ),
                    ))
                self._row(
                    ui,
                    "{} | {} | {}".format(
                        recipient,
                        authority,
                        ", ".join(_evejs_capabilities(
                            _evejs_value(grant, "capabilities", [])
                        )),
                    ),
                    actions,
                )

            self._heading(ui, "Audit")
            if not presenter.events:
                self._row(ui, "No visible audit events")
            for event in presenter.events[-20:]:
                self._row(
                    ui,
                    "#{} {} by {}".format(
                        _evejs_value(event, "sequence", 0),
                        str(_evejs_value(event, "eventType", "event"))
                        .replace("_", " "),
                        _evejs_value(event, "actorPrincipal", "system"),
                    ),
                )

            self._heading(ui, "Network Node load shedding")
            if not presenter.load_shedding:
                self._row(ui, "No configure-authorized NPC proposals")
            for proposal in presenter.load_shedding:
                job_id = str(_evejs_value(proposal, "job_id", ""))
                plan = _evejs_value(proposal, "proposed_plan", {})
                selected = _evejs_list(_evejs_value(plan, "selected", []))
                assembly_ids = [
                    int(_evejs_value(entry, "assemblyID", 0) or 0)
                    for entry in selected
                    if int(_evejs_value(entry, "assemblyID", 0) or 0) > 0
                ]
                self._row(
                    ui,
                    "{} relief proposed / {} required | {}".format(
                        _evejs_value(plan, "energyRelief", 0),
                        _evejs_value(plan, "requiredRelief", 0),
                        ", ".join(str(value) for value in assembly_ids)
                        or "no eligible assemblies",
                    ),
                    [("Approve", lambda *args, job_id=job_id,
                      assembly_ids=assembly_ids: self._confirm_then(
                          ("shed", job_id),
                          lambda: presenter.approve_load_shedding(
                              job_id,
                              assembly_ids,
                              self._edit_value(self._reason_edit),
                          ),
                      ))] if assembly_ids else [],
                )

        def _execute(self, callback):
            try:
                callback()
            except Exception as error:
                self._presenter.status = "Assembly access failed: {}".format(
                    error
                )
            self._render(eveui)

        def _confirm_then(self, key, callback):
            if self._pending_action != key:
                self._pending_action = key
                self._presenter.status = (
                    "Press the same action again to confirm"
                )
                self._render(eveui)
                return
            self._pending_action = None
            self._execute(callback)

        def _on_refresh(self, *args):
            self._pending_action = None
            self._execute(self._presenter.refresh)

        def _on_request(self, *args):
            self._pending_action = None
            self._execute(lambda: self._presenter.request_access(
                self._input_capabilities(), self._expiry_ms()
            ))

        def _on_share(self, *args):
            self._pending_action = None
            self._execute(lambda: self._presenter.share_access(
                self._edit_value(self._recipient_edit),
                self._input_capabilities(),
                self._expiry_ms(),
            ))

        def _on_open(self, *args):
            self._pending_action = None
            self._execute(self._presenter.open_shared_gui)

        def AcceptAssembly(self, item_id):
            self._presenter = _EvejsAssemblyAccessPresenter(
                namespace, item_id
            )
            self._pending_action = None
            self._execute(self._presenter.refresh)

    namespace["_evejs_assembly_access_window_type"] = AssemblyAccessWindow
    return AssemblyAccessWindow


def _evejs_open_assembly_access(namespace, item_id):
    window_type = _evejs_assembly_access_window_type(namespace)
    existing = window_type.GetIfOpen()
    if existing is not None:
        existing.AcceptAssembly(item_id)
        return existing
    return window_type.Open(assembly_item_id=item_id)


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
        if _evejs_assembly_access_available(namespace, itemID):
            menu.append([
                "Manage Assembly Access",
                _evejs_open_assembly_access,
                (namespace, itemID),
            ])
        return menu

    celestial_menu._evejs_npc_fitting_menu_patch = True
    menu_type.CelestialMenu = celestial_menu
