"""Let the server decide whether a Creation held beam has a loaded charge."""


def _evejs_install_held_beam_charge_authority(namespace):
    unit_type = namespace.get("HeldBeamFireUnit")
    if unit_type is None or getattr(unit_type, "_evejs_charge_authority_v1", False):
        return

    # Godma's local charge cache can lag the server after a session change.
    # The original check then drops M1 without ever sending BeginHeldBeam.
    # The authoritative service validates the loaded charge and reports
    # NO_CHARGE, so a local cache miss must not suppress the request.
    unit_type._has_loaded_charge = lambda self: True
    unit_type._evejs_charge_authority_v1 = True
