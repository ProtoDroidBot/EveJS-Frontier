"""Guard the retail map's yielding color pass during view teardown."""


def _evejs_install_map_view_scene_lifecycle(namespace):
    map_view = namespace.get("MapView")
    if map_view is None:
        raise RuntimeError("Frontier map scene patch could not find MapView")

    original = map_view.ApplyStarColors
    if getattr(original, "_evejs_map_scene_lifecycle_patch", False):
        return

    def ApplyStarColors(self, *args, **kwargs):
        # Retail ApplyStarColors yields for every star. Closing the map during
        # that loop clears activeFilter and destroys the view before it resumes.
        if getattr(self, "destroyed", False) or getattr(self, "activeFilter", None) is None:
            return
        try:
            return original(self, *args, **kwargs)
        except AttributeError:
            if getattr(self, "destroyed", False) or getattr(self, "activeFilter", None) is None:
                return
            raise

    ApplyStarColors._evejs_map_scene_lifecycle_patch = True
    map_view.ApplyStarColors = ApplyStarColors
