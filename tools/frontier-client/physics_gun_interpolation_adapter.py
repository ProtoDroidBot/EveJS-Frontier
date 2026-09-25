"""Presentation-only interpolation for detached props held by Physics Gun 99999."""

import math
import time


_MAX_SAMPLES = 8
_STALE_SIM_MS = 1500.0


def _evejs_phys_field(value, name, default=None):
    return value.get(name, default) if isinstance(value, dict) else getattr(value, name, default)


def _evejs_phys_vector(value, length):
    try:
        parts = tuple(float(part) for part in value)
    except (TypeError, ValueError):
        return None
    return parts if len(parts) == length and all(math.isfinite(part) for part in parts) else None


def _evejs_phys_quaternion(value):
    parts = _evejs_phys_vector(value, 4)
    if parts is None:
        return None
    magnitude = math.sqrt(sum(part * part for part in parts))
    return tuple(part / magnitude for part in parts) if magnitude > 1e-9 else None


def _evejs_phys_slerp(left, right, fraction):
    dot = sum(a * b for a, b in zip(left, right))
    if dot < 0:
        right = tuple(-part for part in right)
        dot = -dot
    if dot > 0.9995:
        return _evejs_phys_quaternion(tuple(
            a + fraction * (b - a) for a, b in zip(left, right)))
    angle = math.acos(max(-1.0, min(1.0, dot)))
    sine = math.sin(angle)
    a_weight = math.sin((1.0 - fraction) * angle) / sine
    b_weight = math.sin(fraction * angle) / sine
    return tuple(a_weight * a + b_weight * b for a, b in zip(left, right))


def _evejs_phys_clock_ms():
    try:
        import blue
        return blue.os.GetSimTime() / 10000.0
    except Exception:
        return time.monotonic() * 1000.0


class _EvejsPhysicsPoseTrack:
    def __init__(self, sample, receipt_ms):
        self.world_id = sample["world_id"]
        self.generation = sample["generation"]
        self.revision = 0
        self.samples = []
        self.receipt_ms = receipt_ms
        self.interval_ms = 100.0
        self.render_sim_ms = None
        self.model = None
        self.translation = None
        self.rotation = None
        self.original_translation = None
        self.original_rotation = None
        self.push(sample, receipt_ms)

    def push(self, sample, receipt_ms):
        if sample["generation"] != self.generation or sample["revision"] <= self.revision:
            return False
        if self.samples and sample["sim_ms"] <= self.samples[-1]["sim_ms"]:
            return False
        if self.samples:
            interval = sample["sim_ms"] - self.samples[-1]["sim_ms"]
            if interval > _STALE_SIM_MS:
                # A discontinuity is an authoritative snap, not a path to blend.
                self.samples.clear()
                self.render_sim_ms = None
            else:
                self.interval_ms = (interval if len(self.samples) == 1 else
                                    0.8 * self.interval_ms + 0.2 * interval)
        self.revision = sample["revision"]
        self.receipt_ms = receipt_ms
        self.samples.append(sample)
        del self.samples[:-_MAX_SAMPLES]
        return True

    def pose(self, now_ms):
        latest = self.samples[-1]
        if len(self.samples) == 1:
            self.render_sim_ms = latest["sim_ms"]
            return latest
        delay = max(100.0, min(300.0, self.interval_ms * 1.5))
        elapsed = max(0.0, now_ms - self.receipt_ms)
        target = min(latest["sim_ms"], latest["sim_ms"] + elapsed - delay)
        if self.render_sim_ms is not None:
            # Packet jitter may grow the adaptive delay. Never play a held
            # object backward merely because a later sample arrived late.
            target = max(target, self.render_sim_ms)
        self.render_sim_ms = target
        if target <= self.samples[0]["sim_ms"]:
            return self.samples[0]
        for left, right in zip(self.samples, self.samples[1:]):
            if target <= right["sim_ms"]:
                fraction = max(0.0, min(1.0,
                    (target - left["sim_ms"]) / (right["sim_ms"] - left["sim_ms"])))
                position = tuple(a + fraction * (b - a)
                                 for a, b in zip(left["position"], right["position"]))
                return {**right, "position": position,
                        "orientation": _evejs_phys_slerp(
                            left["orientation"], right["orientation"], fraction)}
        return latest

    def restore(self):
        model = self.model
        if model is None:
            return
        try:
            if getattr(model, "translationCurve", None) is self.translation:
                model.translationCurve = self.original_translation
        except Exception:
            pass
        try:
            if getattr(model, "rotationCurve", None) is self.rotation:
                model.rotationCurve = self.original_rotation
        except Exception:
            pass
        self.model = self.translation = self.rotation = None

    def render(self, michelle, now_ms):
        ball = michelle.GetBall(self.world_id)
        model = getattr(ball, "model", None) if ball is not None else None
        if model is None:
            return
        if (model is not self.model or
                getattr(model, "translationCurve", None) is not self.translation or
                getattr(model, "rotationCurve", None) is not self.rotation):
            self.restore()
            import trinity
            translation = trinity.Tr2TranslationAdapter()
            rotation = trinity.Tr2RotationAdapter()
            old_translation = getattr(model, "translationCurve", None)
            old_rotation = getattr(model, "rotationCurve", None)
            try:
                model.translationCurve = translation
                model.rotationCurve = rotation
            except Exception:
                try:
                    model.translationCurve = old_translation
                    model.rotationCurve = old_rotation
                except Exception:
                    pass
                return
            self.model = model
            self.translation = translation
            self.rotation = rotation
            self.original_translation = old_translation
            self.original_rotation = old_rotation
        pose = self.pose(now_ms)
        try:
            import geo2
            self.translation.value = geo2.Vector(*pose["position"])
        except Exception:
            self.translation.value = pose["position"]
        self.rotation.value = pose["orientation"]


def _evejs_phys_parse(payload):
    try:
        world_id = int(_evejs_phys_field(payload, "worldEntityID"))
        revision = int(_evejs_phys_field(payload, "revision"))
        raw_generation = _evejs_phys_field(payload, "generation")
        generation = str(raw_generation) if raw_generation is not None else ""
        sim_ms = float(_evejs_phys_field(payload, "simTimeMs"))
    except (TypeError, ValueError):
        return None
    position = _evejs_phys_vector(_evejs_phys_field(payload, "position"), 3)
    orientation = _evejs_phys_quaternion(_evejs_phys_field(payload, "orientation"))
    if world_id <= 0 or revision <= 0 or not generation or not math.isfinite(sim_ms) or position is None or orientation is None:
        return None
    return {"world_id": world_id, "generation": generation, "revision": revision,
            "sim_ms": sim_ms, "position": position, "orientation": orientation}


def _evejs_phys_clear(michelle):
    tracks = getattr(michelle, "_evejs_physics_pose_tracks", None) or {}
    for track in list(tracks.values()):
        track.restore()
    michelle._evejs_physics_pose_tracks = {}
    michelle._evejs_physics_pose_latest = {}
    michelle._evejs_physics_pose_loop_generation = (
        getattr(michelle, "_evejs_physics_pose_loop_generation", 0) + 1)
    michelle._evejs_physics_pose_loop_running = False


def _evejs_phys_tick(michelle, clock_ms=None):
    now_ms = _evejs_phys_clock_ms() if clock_ms is None else clock_ms
    tracks = getattr(michelle, "_evejs_physics_pose_tracks", None) or {}
    for world_id, track in list(tracks.items()):
        if now_ms - track.receipt_ms > _STALE_SIM_MS:
            track.restore()
            tracks.pop(world_id, None)
            continue
        try:
            track.render(michelle, now_ms)
        except Exception:
            # A missing optional visual or a replaced ball cannot break Michelle.
            track.restore()


def _evejs_phys_loop(michelle, generation):
    try:
        import uthread2
        while (getattr(michelle, "_evejs_physics_pose_loop_generation", 0) == generation and
               getattr(michelle, "_evejs_physics_pose_tracks", None)):
            _evejs_phys_tick(michelle)
            uthread2.sleep(1.0 / 60.0)
    except Exception:
        pass
    finally:
        if getattr(michelle, "_evejs_physics_pose_loop_generation", 0) == generation:
            michelle._evejs_physics_pose_loop_running = False


def _evejs_install_physics_gun_interpolation(namespace):
    michelle_type = namespace.get("Michelle")
    if michelle_type is None or getattr(michelle_type, "_evejs_physics_interpolation_installed", False):
        return
    old_remove = michelle_type.RemoveBallpark
    old_stop = michelle_type.Stop
    old_rebase = michelle_type.DoSimClockRebase

    def OnPhysicsGunPose(self, payload):
        try:
            if int(_evejs_phys_field(payload, "moduleTypeID", 0)) != 99999:
                return
            if int(_evejs_phys_field(payload, "systemID", 0)) != int(session.solarsystemid2):
                return
            world_id = int(_evejs_phys_field(payload, "worldEntityID", 0))
            mode = _evejs_phys_field(payload, "mode")
            raw_generation = _evejs_phys_field(payload, "generation")
            revision = int(_evejs_phys_field(payload, "revision", 0))
            sim_ms = float(_evejs_phys_field(payload, "simTimeMs"))
            if (world_id <= 0 or raw_generation is None or revision <= 0 or
                    not math.isfinite(sim_ms)):
                return
            generation = str(raw_generation)
            tracks = getattr(self, "_evejs_physics_pose_tracks", None)
            if tracks is None:
                tracks = self._evejs_physics_pose_tracks = {}
            latest = getattr(self, "_evejs_physics_pose_latest", None)
            if latest is None:
                latest = self._evejs_physics_pose_latest = {}
            previous = tracks.get(world_id)
            prior = latest.get(world_id)
            if (prior is not None and
                    ((generation == prior["generation"] and
                      (revision <= prior["revision"] or prior["terminal"])) or
                     (generation != prior["generation"] and sim_ms <= prior["sim_ms"]))):
                return
            if mode in ("stop", "hide"):
                if previous is not None and previous.generation == generation:
                    previous.restore()
                    tracks.pop(world_id, None)
                latest[world_id] = {"generation": generation, "revision": revision,
                                    "sim_ms": sim_ms, "terminal": mode == "stop"}
                return
            sample = _evejs_phys_parse(payload)
            if sample is None or mode not in ("start", "update"):
                return
            now_ms = _evejs_phys_clock_ms()
            if previous is None or previous.generation != sample["generation"]:
                if previous is not None:
                    previous.restore()
                tracks[world_id] = _EvejsPhysicsPoseTrack(sample, now_ms)
            else:
                if not previous.push(sample, now_ms):
                    return
            latest[world_id] = {"generation": generation, "revision": revision,
                                "sim_ms": sim_ms, "terminal": False}
            if not getattr(self, "_evejs_physics_pose_loop_running", False):
                try:
                    import uthread2
                    generation = getattr(self, "_evejs_physics_pose_loop_generation", 0)
                    self._evejs_physics_pose_loop_running = True
                    uthread2.start_tasklet(_evejs_phys_loop, self, generation)
                except Exception:
                    self._evejs_physics_pose_loop_running = False
        except Exception:
            pass

    def RemoveBallpark(self, *args, **kwargs):
        _evejs_phys_clear(self)
        return old_remove(self, *args, **kwargs)

    def Stop(self, *args, **kwargs):
        _evejs_phys_clear(self)
        return old_stop(self, *args, **kwargs)

    def DoSimClockRebase(self, *args, **kwargs):
        result = old_rebase(self, *args, **kwargs)
        _evejs_phys_clear(self)
        return result

    michelle_type.OnPhysicsGunPose = OnPhysicsGunPose
    michelle_type.RemoveBallpark = RemoveBallpark
    michelle_type.Stop = Stop
    michelle_type.DoSimClockRebase = DoSimClockRebase
    michelle_type.__notifyevents__ = tuple(michelle_type.__notifyevents__) + ("OnPhysicsGunPose",)
    michelle_type._evejs_physics_interpolation_installed = True
