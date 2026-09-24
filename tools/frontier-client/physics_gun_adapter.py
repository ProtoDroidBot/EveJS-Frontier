"""Build 3502403 client overlay for the local Physics Gun type."""

SOURCE_TYPE_ID = 95317
PHYSICS_GUN_TYPE_ID = 99999
PHYSICS_GUN_NAME_ID = 99999001
PHYSICS_GUN_DESCRIPTION_ID = 99999002
PHYSICS_GUN_NAME = "Physics Gun"
PHYSICS_GUN_DESCRIPTION = (
    "A modular held-beam weapon with the cutting and extraction behavior "
    "of the Cutting Laser."
)


def _evejs_install_physics_gun(namespace):
    module_name = namespace.get("__name__", "")

    if module_name == "frontier.skillshot.profile":
        try:
            profiles = namespace["_PROFILES"]
            if PHYSICS_GUN_TYPE_ID not in profiles:
                profiles[PHYSICS_GUN_TYPE_ID] = profiles[SOURCE_TYPE_ID]
        except (KeyError, TypeError, AttributeError):
            pass
        return

    if module_name in (
        "evetypes.data", "dogma.data", "frontier.creation.common.data_loader"
    ):
        from collections.abc import Mapping

        class _PhysicsGunRow:
            def __init__(self, source, overrides):
                self._source = source
                self._overrides = overrides

            def __getattr__(self, name):
                if name in self._overrides:
                    return self._overrides[name]
                return getattr(self._source, name)

        class _PhysicsGunMapping(Mapping):
            def __init__(self, source, row):
                self._source = source
                self._row = row

            def __getitem__(self, key):
                if key == PHYSICS_GUN_TYPE_ID:
                    return self._row
                return self._source[key]

            def __iter__(self):
                yield from self._source
                yield PHYSICS_GUN_TYPE_ID

            def __len__(self):
                return len(self._source) + 1

            def __contains__(self, key):
                return key == PHYSICS_GUN_TYPE_ID or key in self._source

        if module_name == "evetypes.data":
            loader = namespace.get("Types")
            overrides = {
                "typeID": PHYSICS_GUN_TYPE_ID,
                "typeNameID": PHYSICS_GUN_NAME_ID,
                "descriptionID": PHYSICS_GUN_DESCRIPTION_ID,
                "name": PHYSICS_GUN_NAME,
                "typeName": PHYSICS_GUN_NAME,
            }
        elif module_name == "dogma.data":
            loader = namespace.get("TypeDogma")
            overrides = {"typeID": PHYSICS_GUN_TYPE_ID, "_key": PHYSICS_GUN_TYPE_ID}
        else:
            loader = namespace.get("CreationModulesLoader")
            overrides = {
                "typeID": PHYSICS_GUN_TYPE_ID,
                "_key": PHYSICS_GUN_TYPE_ID,
                "behavior": "generic",
                "capability": "weapon",
                "system": "weapons",
            }
        if loader is None:
            return
        original_get_data = loader.GetData
        cached_source = None
        cached_overlay = None

        def get_data(*args, **kwargs):
            nonlocal cached_source, cached_overlay
            source = original_get_data(*args, **kwargs)
            if source is cached_source and cached_overlay is not None:
                return cached_overlay
            try:
                if PHYSICS_GUN_TYPE_ID in source:
                    return source
                source_row = source[SOURCE_TYPE_ID]
                overlay = _PhysicsGunMapping(
                    source, _PhysicsGunRow(source_row, overrides)
                )
            except (KeyError, TypeError, AttributeError):
                return source
            cached_source, cached_overlay = source, overlay
            return overlay

        loader.GetData = staticmethod(get_data)
        return

    if module_name == "localization":
        messages = {
            PHYSICS_GUN_NAME_ID: PHYSICS_GUN_NAME,
            PHYSICS_GUN_DESCRIPTION_ID: PHYSICS_GUN_DESCRIPTION,
        }
        for function_name in ("GetByMessageID", "GetImportantByMessageID"):
            original = namespace.get(function_name)
            if not callable(original):
                continue

            def localized(*args, _original=original, **kwargs):
                message_id = args[0] if args else kwargs.get("messageID")
                if message_id in messages:
                    return messages[message_id]
                return _original(*args, **kwargs)

            namespace[function_name] = localized
        original_valid = namespace.get("IsValidMessageID")
        if callable(original_valid):
            def is_valid(*args, **kwargs):
                message_id = args[0] if args else kwargs.get("messageID")
                if message_id in messages:
                    return True
                return original_valid(*args, **kwargs)

            namespace["IsValidMessageID"] = is_valid
        return

    if module_name == "evetypes.localizationUtils":
        for function_name, message_id, value in (
            ("GetLocalizedTypeName", PHYSICS_GUN_NAME_ID, PHYSICS_GUN_NAME),
            ("GetLocalizedTypeDescription", PHYSICS_GUN_DESCRIPTION_ID,
             PHYSICS_GUN_DESCRIPTION),
        ):
            original = namespace.get(function_name)
            if not callable(original):
                continue

            def localized(*args, _original=original, _id=message_id,
                          _value=value, **kwargs):
                requested_id = args[0] if args else kwargs.get("messageID")
                if requested_id == _id:
                    return _value
                return _original(*args, **kwargs)

            namespace[function_name] = localized
