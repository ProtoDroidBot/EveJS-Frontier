"""Build-3502403 client adapter for authoritative Creation auto-fire."""


AUTO_FIRE_CONTRACT_MARKER = "evejs.auto_fire.v1"


def _evejs_install_skillshot_authority(namespace):
    controller_type = namespace.get("SkillShotController")
    if controller_type is None or getattr(
        controller_type, "_evejs_auto_fire_contract_v1", False
    ):
        return

    original_fire = controller_type.fire
    original_fire_session = controller_type._fire_session
    original_build_turret_states = controller_type._build_turret_states

    def fire_automatic(self):
        # Match the retail fire() suppression before setting the one-shot
        # marker. A poll while a session is active must not mark a later manual
        # click as automatic.
        if getattr(self, "_fire_in_progress", False):
            return None
        self._evejs_auto_fire_pending_v1 = True
        try:
            return original_fire(self)
        except Exception:
            self._evejs_auto_fire_pending_v1 = False
            raise

    def fire_session(self):
        automatic = bool(getattr(self, "_evejs_auto_fire_pending_v1", False))
        self._evejs_auto_fire_pending_v1 = False
        instance_dict = getattr(self, "__dict__", {})
        had_instance_builder = "_build_turret_states" in instance_dict
        previous_instance_builder = instance_dict.get("_build_turret_states")

        if automatic:
            def build_automatic_turret_states(module_item_ids, aim_direction):
                return [
                    tuple(state) + (AUTO_FIRE_CONTRACT_MARKER,)
                    for state in original_build_turret_states(
                        module_item_ids, aim_direction
                    )
                ]

            # The retail session calls this for BeginFire and each aim update.
            # Shadowing it only on this instance avoids changing manual or held
            # beam sessions elsewhere in the client.
            self._build_turret_states = build_automatic_turret_states

        try:
            return original_fire_session(self)
        finally:
            if automatic:
                if had_instance_builder:
                    self._build_turret_states = previous_instance_builder
                else:
                    try:
                        del self._build_turret_states
                    except AttributeError:
                        pass

    controller_type.fire_automatic = fire_automatic
    controller_type._fire_session = fire_session
    controller_type._evejs_auto_fire_contract_v1 = True
