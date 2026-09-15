"""Runtime shim for the build-3502403 Frontier map-view bracket lifecycle."""


def _evejs_install_map_view_lifecycle(namespace):
    bracket_state = namespace.get("BracketState")
    if bracket_state is None:
        raise RuntimeError("Frontier map-view patch could not find BracketState")

    original = bracket_state.set_bracket_filter_mode
    if getattr(original, "_evejs_map_view_lifecycle_patch", False):
        return

    def set_bracket_filter_mode(self, mode):
        # The system-view transition can run before BracketLayer.OnOpenView when
        # it starts from a station.  The retail method immediately dereferences
        # sources and integrations which BracketState.activate() creates.
        if not self._active:
            self.activate()
        return original(self, mode)

    set_bracket_filter_mode._evejs_map_view_lifecycle_patch = True
    bracket_state.set_bracket_filter_mode = set_bracket_filter_mode
