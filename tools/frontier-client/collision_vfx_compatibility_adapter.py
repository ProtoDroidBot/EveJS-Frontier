"""Runtime shim for contact-bound collision effects in Frontier build 3502403."""


_EVEJS_COLLISION_CONTACT_GRACE_SECONDS = 0.25


def _evejs_collision_ball_ids(collisions):
    ball_ids = set()
    complete = True
    for collision in collisions:
        try:
            if "collision_position" in collision:
                ball_ids.add(collision["collider_ball_id"])
        except (KeyError, TypeError):
            # Do not clear an effect based on a contact set we cannot fully
            # understand. The retail timeout remains the safe fallback.
            complete = False
    return ball_ids, complete


def _evejs_stop_collision_vfx(ship, manager):
    manager.duration = 0
    manager._callback = lambda _manager: None
    try:
        ship._remove_collision_vfx(manager)
    except (AttributeError, ValueError):
        # A concurrent retail removal may have already detached the effect.
        pass


def _evejs_install_collision_vfx_compatibility(namespace):
    ship_type = namespace.get("Ship")
    if ship_type is None:
        raise RuntimeError("Frontier collision VFX patch could not find Ship")
    manager_type = namespace.get("_CollisionVfxManager")
    if manager_type is None:
        raise RuntimeError(
            "Frontier collision VFX patch could not find _CollisionVfxManager"
        )

    original = ship_type.OnCollisions
    if getattr(original, "_evejs_collision_vfx_patch", False):
        return

    class _EvejsCollisionVfxManager(manager_type):
        def __init__(self, vfx, duration, callback, ball_id):
            manager_type.__init__(
                self,
                vfx,
                min(duration, _EVEJS_COLLISION_CONTACT_GRACE_SECONDS),
                callback,
                ball_id,
            )

    _EvejsCollisionVfxManager._evejs_collision_vfx_patch = True
    _EvejsCollisionVfxManager._evejs_collision_vfx_original = manager_type
    namespace["_CollisionVfxManager"] = _EvejsCollisionVfxManager

    def OnCollisions(self, collisions):
        current_ball_ids = set()
        try:
            current_ball_ids, complete = _evejs_collision_ball_ids(collisions)
            if complete:
                for ball_id, manager in list(self.activeCollisionImpacts.items()):
                    if ball_id not in current_ball_ids:
                        try:
                            _evejs_stop_collision_vfx(self, manager)
                        except Exception:
                            continue
        except Exception:
            pass

        result = original(self, collisions)
        for ball_id in current_ball_ids:
            try:
                manager = self.activeCollisionImpacts.get(ball_id)
                if manager is not None:
                    manager.duration = min(
                        manager.duration,
                        _EVEJS_COLLISION_CONTACT_GRACE_SECONDS,
                    )
            except Exception:
                continue
        return result

    OnCollisions._evejs_collision_vfx_patch = True
    OnCollisions._evejs_collision_vfx_original = original
    ship_type.OnCollisions = OnCollisions
