"""Build-3502403 AutoCannon adapter for Creation Repeater authority."""


AUTO_FIRE_CONTROLLER_OFFLINE = "AutoFireControllerOffline"
AUTO_FIRE_TERMINATED = "AutoFireTerminated"


def _evejs_install_skillshot_auto_fire_authority(namespace):
    auto_cannon_type = namespace.get("AutoCannonMode")
    if auto_cannon_type is None or getattr(
        auto_cannon_type, "_evejs_auto_fire_authority_v1", False
    ):
        return

    original_failed = auto_cannon_type.OnSkillShotFailed
    uthread2 = namespace.get("uthread2")
    poll_interval = namespace.get("_AUTO_FIRE_POLL_INTERVAL", 0.5)

    def auto_fire_loop(self):
        while self._toggle_fire_active:
            fire_automatic = getattr(
                self._firing_controller, "fire_automatic", None
            )
            if not callable(fire_automatic):
                # Both adapters are installed atomically. Fail closed if a
                # damaged/mixed archive somehow loads only this half.
                self._toggle_fire_active = False
                self._auto_fire_tasklet = None
                return None
            fire_automatic()
            uthread2.sleep_sim(poll_interval)
        return None

    def on_skill_shot_failed(self, error_key, error_args):
        if error_key in (
            AUTO_FIRE_CONTROLLER_OFFLINE,
            AUTO_FIRE_TERMINATED,
        ):
            self._audio_service.SendUIEvent("skillshot_trigger_failed")
            detail = (
                "REPEATER OFFLINE"
                if error_key == AUTO_FIRE_CONTROLLER_OFFLINE
                else "AUTO-FIRE STOPPED"
            )
            self._reticle_controller.flash_fire_error("FIRE FAILED", detail)
            # This is terminal for the current toggle. Do not delegate to the
            # retail generic UserError path: it creates one popup per poll and
            # leaves the auto loop running.
            self._stop_toggle_fire()
            return None
        return original_failed(self, error_key, error_args)

    auto_cannon_type._auto_fire_loop = auto_fire_loop
    auto_cannon_type.OnSkillShotFailed = on_skill_shot_failed
    auto_cannon_type._evejs_auto_fire_authority_v1 = True
