"""Match dungeon asteroid graphics to the radius of their Destiny balls."""

import math
import os
import tempfile


_evejs_collision_bounds_cache = {}


def _evejs_native_collision_radius(obj):
    """Find the unscaled extent of the exact graphic chosen for this ball."""
    try:
        graphic_id = int(obj._GetGraphicID())
        if graphic_id in _evejs_collision_bounds_cache:
            return _evejs_collision_bounds_cache[graphic_id]
        from ballparkCommon.data.collision import CollisionDatabase
        CollisionDatabase.Initialize()
        collision = CollisionDatabase.get(graphic_id)
        balls = getattr(collision, "miniballs", None) or ()
        radius = max((math.sqrt(x * x + y * y + z * z) + r
                      for x, y, z, r in balls), default=0)
        if math.isfinite(radius) and radius > 0:
            _evejs_collision_bounds_cache[graphic_id] = radius
            return radius
    except Exception:
        pass
    return None


def _evejs_probe_asteroid_scale(obj, original, native, result, reason):
    """Optional local diagnostic for dungeon asteroid graphic sizing."""
    try:
        probe_dir = tempfile.gettempdir()
        if not os.path.isfile(os.path.join(
                probe_dir, "evejs-asteroid-scale-probe.enabled")):
            return
        cr_data = obj.typeData.get("crData")
        item_id = int(obj.id)
        detached = 8_600_000_000_000_000 <= item_id < 8_700_000_000_000_000
        if not detached and not getattr(cr_data, "dunObjectID", None):
            return
        model = obj.model
        line = (f"id={obj.id} type={obj.typeData.get('typeID')} "
                f"class={type(obj).__name__} radius={obj.radius} "
                f"original={original} native={native} result={result} "
                f"modelScale={getattr(model, 'modelScale', None)} "
                f"bounds={getattr(model, 'boundingSphereRadius', None)} "
                f"reason={reason}\n")
        with open(os.path.join(probe_dir,
                               "evejs-asteroid-scale-debug.log"),
                  "a", encoding="utf-8") as log:
            log.write(line)
    except Exception:
        pass


def _evejs_install_asteroid_visual_scale(namespace):
    scalable = namespace["ScalableSpaceObject"]
    original_get_scale = scalable._GetScale

    def get_scale(self):
        scale = original_get_scale(self)
        native_radius = None
        try:
            if self.__class__.__name__ != "Asteroid":
                _evejs_probe_asteroid_scale(self, scale, native_radius, scale, "class")
                return scale
            cr_data = self.typeData.get("crData")
            item_id = int(self.id)
            detached = 8_600_000_000_000_000 <= item_id < 8_700_000_000_000_000
            if not detached and (cr_data is None or
                                 not getattr(cr_data, "dunObjectID", None)):
                _evejs_probe_asteroid_scale(self, scale, native_radius, scale, "scope")
                return scale
            radius = float(scale if scale is not None else self.radius)
            if not math.isfinite(radius) or radius <= 0:
                _evejs_probe_asteroid_scale(self, scale, native_radius, scale, "radius")
                return scale
            model = self.model
            if getattr(self, "_evejs_asteroid_scale_model", None) is model:
                native_radius = self._evejs_asteroid_native_radius
            else:
                native_radius = _evejs_native_collision_radius(self)
                if native_radius is None:
                    native_radius = float(getattr(model, "boundingSphereRadius", 0))
                self._evejs_asteroid_scale_model = model
                self._evejs_asteroid_native_radius = native_radius
            if not math.isfinite(native_radius) or native_radius <= 0:
                _evejs_probe_asteroid_scale(self, scale, native_radius, scale, "bounds")
                return scale
            # modelScale is a multiplier of the graphic's native size, while
            # dunRadius and the Destiny ball radius are measured in metres.
            result = radius / native_radius
            _evejs_probe_asteroid_scale(self, scale, native_radius, result, "scaled")
            return result
        except (AttributeError, TypeError, ValueError, OverflowError) as error:
            _evejs_probe_asteroid_scale(
                self, scale, native_radius, scale, type(error).__name__)
            return scale

    scalable._GetScale = get_scale
