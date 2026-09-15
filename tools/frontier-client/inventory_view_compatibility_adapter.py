"""Runtime shim for the build-3502403 full-screen inventory view."""


def _evejs_runtime_global(namespace, name):
    value = namespace.get(name)
    if value is not None:
        return value
    builtins = namespace.get("__builtins__")
    if isinstance(builtins, dict):
        return builtins.get(name)
    return getattr(builtins, name, None)


def _evejs_install_inventory_view_compatibility(namespace, kind):
    if kind == "open":
        _evejs_patch_inventory_toggle(namespace)
    elif kind == "view_state":
        _evejs_patch_inventory_overlays(namespace)
    else:
        raise RuntimeError("Unknown Frontier inventory compatibility module")


def _evejs_patch_inventory_toggle(namespace):
    original = namespace.get("open_inventory")
    if original is None:
        raise RuntimeError("Frontier inventory patch could not find open_inventory")
    if getattr(original, "_evejs_inventory_view_patch", False):
        return

    def open_inventory(invID=None):
        current_session = _evejs_runtime_global(namespace, "session")
        if current_session is not None and not getattr(current_session, "charid", None):
            return original(invID)

        view_state = namespace["ServiceManager"].Instance().GetService("viewState")
        inventory_view_id = namespace["INVENTORY_VIEW_STATE_ID"]
        if view_state.IsViewActive(inventory_view_id):
            # The retail function closes here but then falls through and opens
            # the same secondary view again.  Returning makes the command a
            # real toggle, including when HangarView is the primary view.
            return view_state.CloseSecondaryView(inventory_view_id)
        return original(invID)

    open_inventory._evejs_inventory_view_patch = True
    namespace["open_inventory"] = open_inventory


def _evejs_patch_inventory_overlays(namespace):
    view_type = namespace.get("InventoryViewState")
    if view_type is None:
        raise RuntimeError("Frontier inventory patch could not find InventoryViewState")
    original = view_type.LoadView
    if getattr(original, "_evejs_inventory_view_patch", False):
        return

    normal_overlays = frozenset(view_type.__overlays__)
    view_overlay = namespace["ViewOverlay"]
    space_only_overlays = {
        namespace["HUD_OVERLAY_ID"],
        namespace["HUD_BRACKET_LAYER_ID"],
        view_overlay.Target,
    }
    docked_overlays = normal_overlays.difference(space_only_overlays)

    def LoadView(self, **kwargs):
        current_session = _evejs_runtime_global(namespace, "session")
        is_docked = current_session is not None and (
            getattr(current_session, "stationid", None)
            or getattr(current_session, "structureid", None)
        )
        # Update the instance before ViewStateSvc.UpdateOverlays runs.  The
        # primary station view remains inherited, while space-only overlays
        # are requested only when the inventory was opened in space.
        self.__overlays__ = set(docked_overlays if is_docked else normal_overlays)
        return original(self, **kwargs)

    LoadView._evejs_inventory_view_patch = True
    view_type.LoadView = LoadView
