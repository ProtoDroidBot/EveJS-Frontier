"""Hide repeat arrows while manual module stops finish their current cycle."""

from functools import wraps


def _evejs_manual_deactivation_pending(slot):
    """A repeat stop predicts Active(repeat=False) until the server ends the cycle."""
    try:
        action = slot._slot.action
        interactor = action._module_interactor
        if interactor._pending_reactivation_request is not None:
            return False
        state = interactor._state
        server = state.server_value
        if not server.repeat:
            return False
        for predicted in (state.value, state.client_value):
            if (
                type(predicted) is type(server)
                and not predicted.repeat
                and predicted.start_time == server.start_time
                and predicted.duration == server.duration
            ):
                return True
        return False
    except Exception:
        return False


def _evejs_install_action_bar_deactivation(namespace):
    slot_type = namespace.get("ActionBarSlot")
    hud_color = namespace.get("HudColor")
    if slot_type is None or hud_color is None:
        raise RuntimeError("Frontier action-bar deactivation patch lacks client types")

    original_color = slot_type._get_repeat_icon_color
    if getattr(original_color, "_evejs_deactivation_patch", False):
        return
    original_repeat_changed = slot_type._on_repeat_changed

    @wraps(original_color)
    def get_repeat_icon_color(self):
        if _evejs_manual_deactivation_pending(self):
            try:
                return hud_color.CONTENT_HIGHLIGHT.with_alpha(0.0)
            except Exception:
                pass
        return original_color(self)

    @wraps(original_repeat_changed)
    def on_repeat_changed(self, *args, **kwargs):
        original_repeat_changed(self, *args, **kwargs)
        try:
            self._update_repeat_icon_color()
        except Exception:
            # The native scheduled repeat icon update remains available.
            pass

    get_repeat_icon_color._evejs_deactivation_patch = True
    slot_type._get_repeat_icon_color = get_repeat_icon_color
    slot_type._on_repeat_changed = on_repeat_changed
