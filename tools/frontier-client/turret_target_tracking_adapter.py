"""Keep ordinary fitted weapon models aimed at the current locked target."""


def _evejs_install_turret_target_tracking(namespace):
    turret_service = namespace.get("TurretSvc")
    if turret_service is None or getattr(
        turret_service, "_evejs_target_tracking_v1", False
    ):
        return

    def current_target(self):
        targets = self.target.GetTargets()
        if not targets:
            return None
        active_target = self.target.GetActiveTargetID()
        if active_target in targets:
            return active_target
        return next(iter(targets))

    def aim_turret(self, turret_set):
        if getattr(turret_set, "is_skill_shot_turret", False):
            return
        target_id = current_target(self)
        turret_set.SetTargetsAvailable(target_id is not None)
        if target_id is None:
            turret_set.targetID = None
            turret_set._evejs_tracking_target_v1 = None
        elif (not turret_set.IsShooting() and
              (turret_set.targetID != target_id or
               getattr(turret_set, "_evejs_tracking_target_v1", None) != target_id)):
            turret_set.SetTarget(target_id)
            turret_set.TakeAim(target_id)
            turret_set._evejs_tracking_target_v1 = target_id

    def sync_turrets(self):
        ship_id = eve.session.shipid
        ship = self.michelle.GetBall(ship_id) if ship_id else None
        if ship is None:
            return
        for turret_set in getattr(ship, "turrets", ()):
            try:
                if getattr(turret_set, "is_skill_shot_turret", False):
                    continue
                if not getattr(turret_set, "_evejs_target_tracking_stop_v1", False):
                    original_stop = turret_set.StopShooting

                    def stop_and_track(_turret=turret_set, _stop=original_stop,
                                       _ship=ship, _ship_id=ship_id):
                        result = _stop()
                        try:
                            if (eve.session.shipid == _ship_id and
                                    self.michelle.GetBall(_ship_id) is _ship and
                                    _turret in getattr(_ship, "turrets", ())):
                                aim_turret(self, _turret)
                        except Exception:
                            pass
                        return result

                    turret_set.StopShooting = stop_and_track
                    turret_set._evejs_target_tracking_stop_v1 = True
                aim_turret(self, turret_set)
            except Exception:
                continue

    def wrap(method_name):
        original = getattr(turret_service, method_name)

        def updated(self, *args, **kwargs):
            result = original(self, *args, **kwargs)
            try:
                if (method_name != "OnStateChange" or
                        (len(args) > 1 and args[1] == namespace["state"].activeTarget)):
                    sync_turrets(self)
            except Exception:
                pass
            return result

        setattr(turret_service, method_name, updated)

    for method_name in (
        "Startup",
        "ProcessTargetChanged",
        "OnStateChange",
        "OnGodmaItemChange",
        "ProcessActiveShipChanged",
    ):
        wrap(method_name)
    turret_service._evejs_target_tracking_v1 = True
