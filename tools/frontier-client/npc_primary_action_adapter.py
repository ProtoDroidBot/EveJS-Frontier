"""Route the primary Interact key to the nearby NPC fitting/order window.

The HUD resolver only selects the action. Order authority and target checks live
on the server, so other future command sources can share the NPC order executor.
"""

from functools import wraps


NPC_ENTITY_ID_FLOOR = 980000000000
NPC_INTERACTION_RANGE_METERS = 5000


def _evejs_install_npc_primary_action(namespace):
    resolver_type = namespace.get("ActionResolver")
    action_type = namespace.get("ActionData")
    resolved_type = namespace.get("ResolvedActions")
    ball_key_type = namespace.get("BallKey")
    if any(value is None for value in (
        resolver_type, action_type, resolved_type, ball_key_type,
    )):
        raise RuntimeError("NPC Interact key patch could not find its HUD types")

    original = resolver_type.resolve
    if getattr(original, "_evejs_npc_primary_action_patch", False):
        return

    @wraps(original)
    def resolve(self, bracket_key):
        result = original(self, bracket_key)
        try:
            if not isinstance(bracket_key, ball_key_type):
                return result
            entity_id = getattr(bracket_key, "ball_id", None)
            if not isinstance(entity_id, int) or entity_id < NPC_ENTITY_ID_FLOOR:
                return result
            distance = self._get_distance_to_ball(entity_id)
            if distance is None or not 0 <= float(distance) <= NPC_INTERACTION_RANGE_METERS:
                return result
            menu = getattr(self, "_menu_service", None)
            if not callable(getattr(menu, "EvejsInteractNpc", None)):
                return result
            interact = action_type(
                label_path="UI/SmartDeployable/Interact",
                callback=lambda *args, **kwargs: menu.EvejsInteractNpc(entity_id),
            )
            return resolved_type(primary=interact, secondary=result.secondary)
        except Exception:
            # The retail action remains usable if NPC-specific lookup fails.
            return result

    resolve._evejs_npc_primary_action_patch = True
    resolver_type.resolve = resolve
