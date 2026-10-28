"""Local, non-pickable collision-shape hologram for dungeon prop previews."""

import math


_HOLO_COLOR = (0.12, 0.88, 1.0, 0.78)
_MAX_SHAPES = 64
_SEGMENTS = 20


def _evejs_holo_field(payload, name, default=None):
    if isinstance(payload, dict):
        return payload.get(name, default)
    return getattr(payload, name, default)


def _evejs_holo_vector(value, count):
    try:
        result = tuple(float(component) for component in value)
    except (TypeError, ValueError):
        return None
    if len(result) != count or not all(math.isfinite(part) for part in result):
        return None
    return result


def _evejs_holo_add(a, b):
    return tuple(a[i] + b[i] for i in range(3))


def _evejs_holo_scale(value, scale):
    return tuple(part * scale for part in value)


def _evejs_holo_circle(lines, center, radius, axis):
    for index in range(_SEGMENTS):
        angle_a = 2.0 * math.pi * index / _SEGMENTS
        angle_b = 2.0 * math.pi * (index + 1) / _SEGMENTS
        def point(angle):
            u, v = radius * math.cos(angle), radius * math.sin(angle)
            if axis == 0:
                return center[0], center[1] + u, center[2] + v
            if axis == 1:
                return center[0] + u, center[1], center[2] + v
            return center[0] + u, center[1] + v, center[2]
        lines.AddLine(point(angle_a), _HOLO_COLOR, point(angle_b), _HOLO_COLOR)


def _evejs_holo_ball(lines, center, radius):
    if not math.isfinite(radius) or radius <= 0:
        return
    for axis in range(3):
        _evejs_holo_circle(lines, center, radius, axis)


def _evejs_holo_box(lines, box, scale):
    corner = _evejs_holo_scale(box.corner, scale)
    axes = tuple(_evejs_holo_scale(getattr(box, name), scale)
                 for name in ("local_x", "local_y", "local_z"))
    vertices = []
    for index in range(8):
        vertex = corner
        for bit, axis in enumerate(axes):
            if index & (1 << bit):
                vertex = _evejs_holo_add(vertex, axis)
        vertices.append(vertex)
    for index in range(8):
        for bit in range(3):
            other = index ^ (1 << bit)
            if index < other:
                lines.AddLine(vertices[index], _HOLO_COLOR,
                              vertices[other], _HOLO_COLOR)


def _evejs_holo_capsule(lines, capsule, scale):
    a = _evejs_holo_scale(capsule.hemisphereA, scale)
    b = _evejs_holo_scale(capsule.hemisphereB, scale)
    radius = float(capsule.radius) * scale
    _evejs_holo_ball(lines, a, radius)
    _evejs_holo_ball(lines, b, radius)
    for axis in range(3):
        offset = [0.0, 0.0, 0.0]
        offset[axis] = radius
        lines.AddLine(_evejs_holo_add(a, offset), _HOLO_COLOR,
                      _evejs_holo_add(b, offset), _HOLO_COLOR)


def _evejs_holo_collision(lines, graphic_id, scale):
    if not graphic_id:
        return False
    try:
        from ballparkCommon.data.collision import CollisionDatabase
        data = CollisionDatabase.get(graphic_id)
    except Exception:
        return False
    if data is None:
        return False
    drawn = False
    for name, draw in (
        ("miniballs", lambda shape: _evejs_holo_ball(
            lines, _evejs_holo_scale(shape[:3], scale), float(shape[3]) * scale)),
        ("miniboxes", lambda shape: _evejs_holo_box(lines, shape, scale)),
        ("minicapsules", lambda shape: _evejs_holo_capsule(lines, shape, scale)),
    ):
        try:
            shapes = getattr(data, name, None) or ()
        except Exception:
            continue
        for shape in shapes[:_MAX_SHAPES]:
            try:
                draw(shape)
                drawn = True
            except Exception:
                continue
    return drawn


def _evejs_holo_clear(self):
    prior = getattr(self, "_evejs_dungeon_prop_hologram", None)
    self._evejs_dungeon_prop_hologram = None
    self._evejs_dungeon_prop_hologram_generation = (
        getattr(self, "_evejs_dungeon_prop_hologram_generation", 0) + 1)
    if prior is not None:
        scene, model = prior
        try:
            scene.objects.fremove(model)
        except Exception:
            pass


def _evejs_holo_expire(self, generation):
    try:
        import uthread2
        uthread2.sleep(45.0)
        if getattr(self, "_evejs_dungeon_prop_hologram_generation", 0) == generation:
            _evejs_holo_clear(self)
    except Exception:
        pass


def _evejs_holo_show(self, payload):
    if not _evejs_holo_field(payload, "active", False):
        _evejs_holo_clear(self)
        return
    try:
        system_id = int(_evejs_holo_field(payload, "systemID", 0))
        if system_id != int(session.solarsystemid2):
            return
        position = _evejs_holo_vector(_evejs_holo_field(payload, "position"), 3)
        rotation = _evejs_holo_vector(_evejs_holo_field(payload, "rotation"), 3)
        radius = float(_evejs_holo_field(payload, "radius", 0))
        scale = float(_evejs_holo_field(payload, "collisionScale", 1))
        graphic_id = int(_evejs_holo_field(payload, "graphicID", 0) or 0)
        if (position is None or rotation is None or not math.isfinite(radius)
                or radius <= 0 or not math.isfinite(scale) or scale <= 0):
            return
        if self.GetBallpark(False) is None:
            return
        scene = sm.GetService("sceneManager").GetRegisteredScene("default")
        if scene is None:
            return
        import trinity
        import mathext
        import geo2
        from trinutils import drawutils
        lines = drawutils.CreateLineSet("DungeonPropMoveHologramLines")
        if not _evejs_holo_collision(lines, graphic_id, scale):
            _evejs_holo_ball(lines, (0.0, 0.0, 0.0), radius)
        lines.SubmitChanges()
        lines.effect = trinity.Tr2Effect()
        lines.effect.effectFilePath = drawutils.LINESET_FXPATH
        root = trinity.EveRootTransform()
        root.name = "DungeonPropMoveHologram"
        try:
            root.isPickable = False
        except (AttributeError, TypeError):
            pass
        root.children.append(lines)
        root.translationCurve = trinity.Tr2TranslationAdapter()
        root.translationCurve.value = geo2.Vector(*position)
        root.rotation = mathext.quat_from_yaw_pitch_roll(
            *(math.radians(component) for component in rotation))
        scene.objects.append(root)
    except Exception:
        # Keep any previous valid preview if an optional asset or scene call fails.
        return
    _evejs_holo_clear(self)
    self._evejs_dungeon_prop_hologram = (scene, root)
    generation = self._evejs_dungeon_prop_hologram_generation
    try:
        import uthread2
        uthread2.start_tasklet(_evejs_holo_expire, self, generation)
    except Exception:
        pass


def _evejs_install_dungeon_prop_hologram(namespace):
    michelle = namespace.get("Michelle")
    if michelle is None or getattr(michelle, "_evejs_dungeon_prop_hologram_installed", False):
        return
    original_remove = michelle.RemoveBallpark
    original_stop = michelle.Stop

    def OnDungeonPropMovePreview(self, payload):
        _evejs_holo_show(self, payload)

    def RemoveBallpark(self, *args, **kwargs):
        _evejs_holo_clear(self)
        return original_remove(self, *args, **kwargs)

    def Stop(self, *args, **kwargs):
        _evejs_holo_clear(self)
        return original_stop(self, *args, **kwargs)

    michelle.OnDungeonPropMovePreview = OnDungeonPropMovePreview
    michelle.RemoveBallpark = RemoveBallpark
    michelle.Stop = Stop
    michelle.__notifyevents__ = tuple(michelle.__notifyevents__) + (
        "OnDungeonPropMovePreview",)
    michelle._evejs_dungeon_prop_hologram_installed = True
