"""Trusted NPC interaction and assembly-access actions for build 3502403."""

import builtins
from functools import wraps
import uuid

NPC_ENTITY_ID_FLOOR = 980000000000
NPC_ENTITY_CATEGORY_ID = 11
SHIP_CATEGORY_ID = 6
NPC_PILOT_ID_MIN = 1500000000
NPC_PILOT_ID_MAX = 1599999999


def _evejs_runtime_global(namespace, name):
    # CCP client services such as sm/uicore are often installed in builtins,
    # not imported into menusvc.pyc's module globals.
    return namespace.get(name) or getattr(builtins, name, None)


def _evejs_service_manager(namespace):
    manager = _evejs_runtime_global(namespace, "sm")
    if manager is None:
        raise RuntimeError("Client service manager is unavailable")
    return manager


def _evejs_value(value, key, default=None):
    try:
        if isinstance(value, dict):
            return value.get(key, default)
        return getattr(value, key, default)
    except Exception:
        return default


def _evejs_npc_menu_kind(namespace, entity_id, cr_data=None):
    if not isinstance(entity_id, int) or entity_id < NPC_ENTITY_ID_FLOOR:
        return None
    category_id = _evejs_value(cr_data, "categoryID")
    pilot_id = _evejs_value(cr_data, "charID")
    if category_id is None or (str(category_id) == str(SHIP_CATEGORY_ID) and
                               pilot_id is None):
        try:
            ballpark = _evejs_service_manager(namespace).GetService(
                "michelle"
            ).GetBallpark()
            slim_item = ballpark.slimItems.get(entity_id)
        except Exception:
            return None
        if category_id is None:
            category_id = _evejs_value(slim_item, "categoryID")
        if pilot_id is None:
            pilot_id = _evejs_value(slim_item, "charID")
    try:
        category_id = int(category_id)
        if category_id == NPC_ENTITY_CATEGORY_ID:
            return "entity"
        pilot_id = int(pilot_id or 0)
        if (category_id == SHIP_CATEGORY_ID and
                NPC_PILOT_ID_MIN <= pilot_id <= NPC_PILOT_ID_MAX):
            return "pilot"
    except (TypeError, ValueError):
        pass
    return None


def _evejs_ship_is_occupied(namespace, entity_id, cr_data=None):
    if not isinstance(entity_id, int):
        return False
    category_id = _evejs_value(cr_data, "categoryID")
    pilot_id = _evejs_value(cr_data, "charID")
    if category_id is None or pilot_id is None:
        try:
            ballpark = _evejs_service_manager(namespace).GetService(
                "michelle"
            ).GetBallpark()
            slim_item = ballpark.slimItems.get(entity_id)
        except Exception:
            slim_item = None
        if category_id is None:
            category_id = _evejs_value(slim_item, "categoryID")
        if pilot_id is None:
            pilot_id = _evejs_value(slim_item, "charID")
    try:
        return int(category_id) == SHIP_CATEGORY_ID and int(pilot_id or 0) > 0
    except (TypeError, ValueError):
        return False


def _evejs_is_ship_boarding_row(row):
    if not isinstance(row, (list, tuple)) or not row:
        return False
    try:
        label = str(row[0]).strip().lower()
    except Exception:
        return False
    return label in (
        "board ship",
        "board berthed ship",
        "swap and board ship",
        "ui/inflight/boardship",
        "ui/inflight/boardberthedship",
        "ui/inflight/swapandboardship",
        "ui/inflight/pos/boardshipfrombay",
    )


def _evejs_list(value):
    try:
        return [] if value is None else list(value)
    except Exception:
        return []


def _evejs_assembly_access_remote(namespace):
    return _evejs_service_manager(namespace).RemoteSvc("smartAssemblyService")


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
    capabilities = []
    for entry in _evejs_list(value):
        try:
            name = str(entry or "").strip().lower()
            if name and name not in capabilities:
                capabilities.append(name)
        except Exception:
            continue
    return capabilities


def _evejs_positive_assembly_ids(entries):
    result = []
    for entry in _evejs_list(entries):
        try:
            assembly_id = int(_evejs_value(entry, "assemblyID", 0) or 0)
            if assembly_id > 0:
                result.append(assembly_id)
        except Exception:
            continue
    return result


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
        try:
            self.requests = _evejs_list(
                self.remote.get_assembly_access_requests(self.item_id, {})
            )
        except Exception:
            self.requests = []
        try:
            self.grants = _evejs_list(
                self.remote.get_assembly_access_grants(self.item_id, {})
            )
        except Exception:
            self.grants = []
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
        service = _evejs_service_manager(self.namespace).GetService(
            "smartAssemblySvc"
        )
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
    cached = namespace.get("_evejs_assembly_access_window_class")
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

        def _try_row(self, ui, text, actions=()):
            try:
                self._row(ui, text, actions)
            except Exception:
                # Continue constructing the remaining independent entries.
                pass

        def _render(self, ui):
            presenter = self._presenter
            self.SetCaption("Assembly Access: {}".format(presenter.item_id))
            self._status_label.text = presenter.status
            self._scroll.Flush()
            self._heading(ui, "Current access")
            source = "owner" if presenter.is_owner else "grant-derived"
            self._try_row(
                ui,
                "{} | {} | {}".format(
                    _evejs_value(presenter.access, "principal", "player"),
                    source,
                    ", ".join(presenter.capabilities) or "no capabilities",
                ),
            )

            self._heading(ui, "Requests")
            if not presenter.requests:
                self._try_row(ui, "No visible access requests")
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
                self._try_row(
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
                self._try_row(ui, "No visible active grants")
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
                self._try_row(
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
                self._try_row(ui, "No visible audit events")
            for event in presenter.events[-20:]:
                self._try_row(
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
                self._try_row(ui, "No configure-authorized NPC proposals")
            for proposal in presenter.load_shedding:
                job_id = str(_evejs_value(proposal, "job_id", ""))
                plan = _evejs_value(proposal, "proposed_plan", {})
                selected = _evejs_list(_evejs_value(plan, "selected", []))
                assembly_ids = _evejs_positive_assembly_ids(selected)
                self._try_row(
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

    namespace["_evejs_assembly_access_window_class"] = AssemblyAccessWindow
    return AssemblyAccessWindow


def _evejs_open_assembly_access(namespace, item_id):
    window_type = _evejs_assembly_access_window_type(namespace)
    existing = window_type.GetIfOpen()
    if existing is not None:
        existing.AcceptAssembly(item_id)
        return existing
    return window_type.Open(assembly_item_id=item_id)


def _evejs_npc_fitting_probe(namespace, entity_id):
    try:
        return _evejs_service_manager(namespace).RemoteSvc(
            "npcFittingMgr"
        ).CanOpenNpcFitting(entity_id)
    except Exception:
        return None


def _evejs_npc_fitting_action_is_trusted(namespace, entity_id):
    return _evejs_value(
        _evejs_npc_fitting_probe(namespace, entity_id),
        "trusted", False,
    ) is True


def _evejs_npc_interaction_probe(namespace, entity_id):
    try:
        return _evejs_service_manager(namespace).RemoteSvc(
            "npcFittingMgr"
        ).CanInteractNpc(entity_id)
    except Exception as error:
        return {
            "canInteract": False,
            "canIssueOrders": False,
            "canModifyFittings": False,
            "reason": "NPC_INTERACTION_PROBE_FAILED",
            "detail": "{}: {}".format(type(error).__name__, error)[:200],
        }


def _evejs_npc_interaction_status(probe):
    reason = str(_evejs_value(probe, "reason", "") or "")
    messages = {
        "NPC_DURABLE_ENTITY_NOT_FOUND": "This NPC is no longer available.",
        "NPC_FITTING_NOT_LOCAL": "The NPC is not in your current space scene.",
        "NPC_FITTING_OUT_OF_RANGE": "Move within 5 km of the NPC.",
        "NPC_FITTING_TRUST_REQUIRED": "NPC command access was not granted.",
        "NPC_INTERACTION_NOT_FRIENDLY": "This NPC is not friendly or trusted.",
    }
    if reason == "NPC_INTERACTION_PROBE_FAILED":
        detail = str(_evejs_value(probe, "detail", "") or "")
        return "Interaction service failed: {}".format(detail)
    return messages.get(reason, "NPC interaction unavailable ({})".format(
        reason or "no response"
    ))


def _evejs_npc_interaction_available(namespace, entity_id):
    return _evejs_value(
        _evejs_npc_interaction_probe(namespace, entity_id),
        "canInteract", False,
    ) is True


def _evejs_open_npc_fitting(namespace, entity_id):
    command = getattr(_evejs_runtime_global(namespace, "uicore"), "cmd", None)
    opener = getattr(command, "OpenNpcFitting", None)
    return opener(entity_id) if opener is not None else None


def _evejs_active_target_id(namespace):
    try:
        target_service = _evejs_service_manager(namespace).GetService("target")
        getter = getattr(target_service, "GetActiveTargetID", None)
        value = getter() if getter is not None else None
        return int(value) if value else 0
    except (AttributeError, TypeError, ValueError):
        return 0


def _evejs_issue_npc_order(
    namespace, entity_id, order_type, target_id=None, range_meters=None
):
    probe = _evejs_npc_interaction_probe(namespace, entity_id)
    if _evejs_value(probe, "canIssueOrders", False) is not True:
        raise PermissionError("NPC order access is no longer available")
    order = {"type": order_type}
    if order_type != "resume":
        raw_target = str(target_id).strip() if target_id is not None else ""
        if raw_target:
            target_id = int(raw_target)
        else:
            target_id = int(_evejs_value(
                probe, "actorShipEntityID", 0
            ) or 0)
        if target_id == int(entity_id) or (raw_target and target_id <= 0):
            raise ValueError("Select a different target entity")
        if target_id > 0:
            order["targetID"] = target_id
        # An older probe may omit actorShipEntityID; the server resolves an
        # omitted target to the authenticated initiator's active ship.
    if order_type in ("keepAtRange", "orbit"):
        order["rangeMeters"] = int(range_meters)
    result = _evejs_service_manager(namespace).RemoteSvc(
        "npcFittingMgr"
    ).IssueNpcOrder(entity_id, order)
    if _evejs_value(result, "accepted", False) is not True:
        raise RuntimeError("The NPC did not accept that order")
    return result


def _evejs_npc_interaction_window_type(namespace):
    cached = namespace.get("_evejs_npc_interaction_window_class")
    if cached is not None:
        return cached

    import eveui
    from carbonui.control.singlelineedits.singleLineEditText import (
        SingleLineEditText,
    )

    base_window = namespace.get("Window")
    if base_window is None:
        from carbonui.control.window import Window as base_window

    class NpcInteractionWindow(base_window):
        default_windowID = "evejs_npc_interaction"
        default_caption = "NPC Orders"
        default_width = 500
        default_height = 390
        default_minSize = (430, 340)

        def ApplyAttributes(self, attributes):
            super().ApplyAttributes(attributes)
            self._entity_id = int(_evejs_value(
                attributes, "npc_entity_id", 0
            ) or 0)
            root = eveui.Container(
                parent=self.GetMainArea(),
                align=eveui.Align.to_all,
                padding=(16, 16, 16, 16),
            )
            # Window/CarbonUI reserves _name for its own string identity.
            self._npc_name_label = eveui.EveLabelLarge(
                parent=root,
                align=eveui.Align.to_top,
                text="NPC",
            )
            try:
                self._pilot_label = eveui.EveLabelMedium(
                    parent=root,
                    align=eveui.Align.to_top,
                    padTop=4,
                    text="",
                )
            except Exception:
                self._pilot_label = None
            self._status = eveui.EveLabelMedium(
                parent=root,
                align=eveui.Align.to_top,
                padTop=8,
                text="",
            )
            self._fit_button = eveui.Button(
                parent=root,
                align=eveui.Align.to_top,
                padTop=18,
                label="Modify Fittings",
                func=self._on_modify_fittings,
            )
            self._retry_button = eveui.Button(
                parent=root,
                align=eveui.Align.to_top,
                padTop=6,
                label="Retry Interaction",
                func=self._on_retry,
            )
            self._order_controls = eveui.ContainerAutoSize(
                parent=root,
                align=eveui.Align.to_top,
                padTop=16,
            )
            eveui.EveLabelMedium(
                parent=self._order_controls,
                align=eveui.Align.to_top,
                text="NPC Orders (blank target = your active ship)",
            )
            self._target_edit = SingleLineEditText(
                parent=self._order_controls,
                align=eveui.Align.to_top,
                height=30,
                top=6,
                hintText="Target ship/entity ID (blank = your ship)",
                maxLength=20,
            )
            self._range_edit = SingleLineEditText(
                parent=self._order_controls,
                align=eveui.Align.to_top,
                height=30,
                top=6,
                hintText="Keep/Orbit range in meters",
                maxLength=6,
            )
            self._set_edit(self._range_edit, "2500")
            first_row = eveui.Container(
                parent=self._order_controls,
                align=eveui.Align.to_top,
                height=34,
                top=8,
            )
            for index, (label, order_type) in enumerate((
                ("Approach", "approach"),
                ("Keep at Range", "keepAtRange"),
                ("Orbit", "orbit"),
                ("Lock Target", "lock"),
            )):
                eveui.Button(
                    parent=first_row,
                    align=eveui.Align.to_left,
                    width=108,
                    left=index * 5,
                    label=label,
                    func=lambda *args, order_type=order_type:
                    self._send_order(order_type),
                )
            second_row = eveui.Container(
                parent=self._order_controls,
                align=eveui.Align.to_top,
                height=34,
                top=6,
            )
            eveui.Button(
                parent=second_row,
                align=eveui.Align.to_left,
                width=130,
                label="Use Active Target",
                func=self._on_use_active_target,
            )
            eveui.Button(
                parent=second_row,
                align=eveui.Align.to_left,
                width=140,
                left=6,
                label="Resume Autonomy",
                func=lambda *args: self._send_order("resume"),
            )
            self.AcceptNpc(_evejs_value(attributes, "initial_probe"))

        def _edit_value(self, edit):
            getter = getattr(edit, "GetValue", None)
            return getter() if getter is not None else getattr(edit, "text", "")

        def _set_edit(self, edit, value):
            setter = getattr(edit, "SetValue", None)
            if setter is not None:
                setter(str(value))
            else:
                edit.text = str(value)

        def _on_use_active_target(self, *args):
            try:
                target_id = _evejs_active_target_id(namespace)
                if not target_id or target_id == self._entity_id:
                    self._status.text = "Select another target or enter its entity ID"
                    return
                self._set_edit(self._target_edit, target_id)
                self._status.text = "Target {} selected".format(target_id)
            except Exception as error:
                self._status.text = "Target selection failed: {}".format(error)

        def _on_retry(self, *args):
            self.AcceptNpc(_evejs_npc_interaction_probe(
                namespace, self._entity_id
            ))

        def _send_order(self, order_type):
            try:
                target_id = None
                if order_type != "resume":
                    raw_target = str(self._edit_value(
                        self._target_edit
                    ) or "").strip()
                    target_id = int(raw_target) if raw_target else None
                range_meters = None
                if order_type in ("keepAtRange", "orbit"):
                    range_meters = int(
                        self._edit_value(self._range_edit)
                    )
                _evejs_issue_npc_order(
                    namespace, self._entity_id, order_type,
                    target_id, range_meters,
                )
                self._status.text = "Order accepted: {}".format(order_type)
            except Exception as error:
                self._status.text = "NPC order failed: {}".format(error)

        def AcceptNpc(self, probe):
            can_interact = _evejs_value(
                probe, "canInteract", False
            ) is True
            name = _evejs_value(
                probe, "displayName", "NPC {}".format(self._entity_id)
            )
            self._npc_name_label.text = str(name)
            pilot = _evejs_value(probe, "pilot")
            pilot_id = _evejs_value(pilot, "characterID", 0)
            pilot_name = str(_evejs_value(pilot, "characterName", "") or "")
            if self._pilot_label is not None:
                try:
                    self._pilot_label.text = (
                        "Pilot: {} ({})".format(pilot_name, pilot_id)
                        if pilot_id and pilot_name else ""
                    )
                    self._pilot_label.display = bool(pilot_id and pilot_name)
                except Exception:
                    pass
            self.SetCaption("NPC Orders: {}".format(name))
            can_fit = can_interact and _evejs_value(
                probe, "canModifyFittings", False
            ) is True
            self._fit_button.display = can_fit
            can_order = can_interact and _evejs_value(
                probe, "canIssueOrders", False
            ) is True
            self._order_controls.display = can_order
            self._retry_button.display = not can_interact
            self._status.text = (
                "Select an interaction" if can_fit or can_order else
                "This NPC has not granted fitting or order access"
                if can_interact else _evejs_npc_interaction_status(probe)
            )

        def _on_modify_fittings(self, *args):
            try:
                if not _evejs_npc_fitting_action_is_trusted(
                    namespace, self._entity_id
                ):
                    self.Close()
                    return
                _evejs_open_npc_fitting(namespace, self._entity_id)
            except Exception as error:
                self._status.text = "NPC fitting unavailable: {}".format(error)

    namespace["_evejs_npc_interaction_window_class"] = NpcInteractionWindow
    return NpcInteractionWindow


def _evejs_open_npc_interaction(namespace, entity_id, probe=None):
    # Recheck on activation: the menu or keyboard selection may be stale.
    probe = _evejs_npc_interaction_probe(namespace, entity_id)
    window_type = _evejs_npc_interaction_window_type(namespace)
    existing = window_type.GetIfOpen()
    if existing is not None:
        existing._entity_id = int(entity_id)
        existing.AcceptNpc(probe)
        return existing
    return window_type.Open(npc_entity_id=entity_id, initial_probe=probe)


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
        npc_kind = _evejs_npc_menu_kind(namespace, itemID, crData)
        is_npc = npc_kind == "pilot"
        try:
            menu = original(
                self, itemID, mapItem, crData, typeID, parentID, hint
            )
        except Exception:
            if not is_npc:
                raise
            # A failing retail menu entry must not hide the NPC's explicit
            # interaction action. Keep non-NPC failures on the retail path.
            menu = []
        if isinstance(itemID, list):
            return menu
        if _evejs_ship_is_occupied(namespace, itemID, crData):
            try:
                menu[:] = [row for row in menu
                           if not _evejs_is_ship_boarding_row(row)]
            except Exception:
                pass
        interaction = _evejs_npc_interaction_probe(namespace, itemID) if is_npc else None
        try:
            if is_npc and not any(
                isinstance(row, (list, tuple)) and row and row[0] == "Interact"
                for row in menu
            ):
                menu.append([
                    "Interact",
                    _evejs_open_npc_interaction,
                    (namespace, itemID),
                ])
        except Exception:
            pass
        try:
            if _evejs_value(interaction, "canModifyFittings", False) is True:
                menu.append([
                    "Modify Fittings",
                    _evejs_open_npc_fitting,
                    (namespace, itemID),
                ])
        except Exception:
            pass
        try:
            if npc_kind is None and _evejs_assembly_access_available(namespace, itemID):
                menu.append([
                    "Manage Assembly Access",
                    _evejs_open_assembly_access,
                    (namespace, itemID),
                ])
        except Exception:
            pass
        return menu

    celestial_menu._evejs_npc_fitting_menu_patch = True
    menu_type.CelestialMenu = celestial_menu

    def evejs_interact_npc(self, item_id):
        return _evejs_open_npc_interaction(namespace, item_id)

    menu_type.EvejsInteractNpc = evejs_interact_npc
