"""Runtime shims for the build-3502403 Frontier system view."""


def _evejs_install_system_view_site_visibility():
    from frontier.crdata.client.resolved_celestial import ResolvedDungeon
    from frontier.hud.system_view.scene_new.area_controller.system import (
        SystemAreaController,
    )

    original = SystemAreaController._is_bracket_visible
    if getattr(original, "_evejs_system_view_site_visibility_patch", False):
        return

    def _is_bracket_visible(self, resolved_celestial, selected_key):
        # The retail build only admits Crude Rifts and two hard-coded authored
        # dungeon entry types.  Any dungeon root which Michelle has resolved is
        # already authorized for this client and should be usable as a system-
        # view navigation marker.
        if isinstance(resolved_celestial, ResolvedDungeon):
            return True
        return original(self, resolved_celestial, selected_key)

    _is_bracket_visible._evejs_system_view_site_visibility_patch = True
    SystemAreaController._is_bracket_visible = _is_bracket_visible


def _evejs_install_map_view_lifecycle(namespace):
    bracket_state = namespace.get("BracketState")
    if bracket_state is None:
        raise RuntimeError("Frontier map-view patch could not find BracketState")

    ballpark_source = namespace.get("BallparkBracketSource")
    if ballpark_source is None:
        raise RuntimeError("Frontier map-view patch could not find BallparkBracketSource")

    original_prime = ballpark_source._prime
    if not getattr(original_prime, "_evejs_station_map_prime_patch", False):

        def _prime(self):
            client_session = namespace.get("session") or getattr(
                __import__("builtins"), "session", None
            )
            docked = client_session is not None and any(
                getattr(client_session, field, None)
                for field in ("stationid2", "stationid", "structureid")
            )
            # The retail prime waits indefinitely for Michelle's ballpark.
            # A docked character has no ballpark, even while the system view
            # is open. Ball notifications populate this source after undock.
            if docked:
                try:
                    ballpark = self._michelle.GetBallpark()
                except Exception:
                    ballpark = None
                if ballpark is None:
                    return
            return original_prime(self)

        _prime._evejs_station_map_prime_patch = True
        ballpark_source._prime = _prime

    original = bracket_state.set_bracket_filter_mode
    if getattr(original, "_evejs_map_view_lifecycle_patch", False):
        return

    def set_bracket_filter_mode(self, mode):
        # The system-view transition can run before BracketLayer.OnOpenView when
        # it starts from a station.  The retail method immediately dereferences
        # sources and integrations which BracketState.activate() creates.
        _evejs_install_system_view_site_visibility()
        if not self._active:
            self.activate()
        return original(self, mode)

    set_bracket_filter_mode._evejs_map_view_lifecycle_patch = True
    bracket_state.set_bracket_filter_mode = set_bracket_filter_mode
