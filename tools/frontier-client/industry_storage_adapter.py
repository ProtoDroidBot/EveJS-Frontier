"""Native build-3502403 inventory adapters embedded by the exact-bytecode patcher.

The server authorizes and commits every move. SSU UI rows represent type totals
and intentionally have no item ID; never invent a server inventory row ID here.
"""


def _evejs_install_industry_storage(namespace, kind):
    if kind == "controller":
        _evejs_patch_industry_inputs(namespace)
    elif kind == "facility":
        _evejs_patch_industry_nearby(namespace)
    elif kind == "storage":
        _evejs_patch_industry_drop(namespace)
    elif kind == "panel":
        _evejs_patch_industry_panel(namespace)


def _evejs_patch_industry_panel(namespace):
    panel_type = namespace["ActiveBlueprintPanel"]

    def construct_cargo(self):
        from frontier.smart_assemblies.client.storage.location import SmartStorageLocation
        locations = []
        for inventory in self._controller.get_nearby_inventories():
            storage_controller = getattr(inventory, "smart_storage_controller", None)
            if storage_controller is not None:
                _evejs_patch_industry_storage_grid()
                # The standard location reconstructs controllers from invControllers
                # by class name and item ID. SSUs require their existing controller
                # and SMART_STORAGE container kind for rendering and notifications.
                locations.append(SmartStorageLocation(storage_controller))
            else:
                locations.append(namespace["StandardInventoryLocation"](inventory.GetInvID()))
        if not locations:
            return
        # Preserve build 3502403's cargo layout, coupling and shortcut lifecycle.
        align = namespace["Align"]
        self._cargo_panel = namespace["InventoryPanel"](
            parent=namespace["ContainerAutoSize"](parent=self, align=align.TOBOTTOM),
            align=align.CENTER,
            pos=(0, 0, namespace["CARGO_PANEL_WIDTH"], namespace["CARGO_PANEL_HEIGHT"]),
            locations=locations, show_toolbar=True,
        )
        self._cargo_panel.anim_appear()
        self._cargo_coupler = namespace["BlueprintCargoCoupler"](controller=self._controller, parent=self._cargo_panel)
        self._cargo_hints = namespace["LocalShortcutHints"](
            self._cargo_coupler.parent_hinted_shortcuts(), parent=self,
            align=align.CENTERBOTTOM, top=namespace["CARGO_SHORTCUT_HINTS_TOP"],
        )
        self._controller.facility_instance.on_items_changed.connect(self._refresh_cargo_hints)
        if self.display:
            self.activate_shortcuts()

    panel_type._construct_cargo = construct_cargo


def _evejs_patch_industry_storage_grid():
    # Run while constructing the page, after native UI modules have loaded.
    # The SSU grid overrides OnDropData and bypasses its inventory controller.
    from eve.client.script.ui.shared.inventory.invContainers import SmartStorageUnitInventory
    if getattr(SmartStorageUnitInventory, "_evejs_industry_drop_installed", False):
        return
    original = SmartStorageUnitInventory.OnDropData

    def drop(self, dragObj, nodes):
        nodes = list(nodes or [])
        if any(getattr(node, "__guid__", None) in ("IndustryItemDragData", "xtriui.EscrowInvItem")
               and callable(getattr(node, "on_add_item", None)) for node in nodes):
            # Reuse the model's mixed-drop rejection, online check and callbacks.
            return self.invController.OnDropData(nodes)
        return original(self, dragObj, nodes)

    SmartStorageUnitInventory.OnDropData = drop
    SmartStorageUnitInventory._evejs_industry_drop_installed = True


def _evejs_patch_industry_inputs(namespace):
    controller_type = namespace["FacilityPageController"]
    original = controller_type._deposit_input_items

    def deposit(self, inventory_items, quantity, prompt_quantity):
        items = list(inventory_items or [])
        storage_items = [item for item in items if getattr(item, "flagID", None) == 66]
        if not storage_items:
            return original(self, inventory_items, quantity, prompt_quantity)
        from eveexceptions import UserError
        if len(storage_items) != len(items) or len({item.locationID for item in items}) != 1:
            raise UserError("CannotAddToThatLocation")
        if not self.active_blueprint:
            return
        if prompt_quantity and quantity:
            quantity = namespace["_quantity_prompt"](quantity, "Select quantity to deposit")
            if not quantity:
                return
        slots = self._facility_instance.blueprint.inputs
        totals = self._facility_instance.input_stacks
        requested = {}
        for item in items:
            if item.typeID not in slots or item.singleton:
                raise UserError("CannotAddToThatLocation")
            available = slots[item.typeID].max_storable_quantity - totals.get(item.typeID, 0) - requested.get(item.typeID, 0)
            if quantity:
                available = min(available, quantity - requested.get(item.typeID, 0))
            take = min(available, item.stacksize)
            if take > 0:
                requested[item.typeID] = requested.get(item.typeID, 0) + take
        if not requested:
            return
        strategy = self._service.get_facility_strategy(self._facility_id)
        remote = getattr(strategy, "_remote_service", None)
        if remote is None:
            raise UserError("CannotAddToThatLocation")
        from frontier.industry.common.errors import IndustryError
        try:
            # Quantities are by type, scoped to one SSU and the authenticated
            # character's partition. The server resolves actual source rows.
            remote.deposit_storage_input_items(self._facility_id, items[0].locationID, requested)
        except IndustryError as error:
            namespace["prompt_error_message"](error.msg, namespace["ErrorHeaders"].DEPOSIT)
            return
        # Server notices normally refresh the totals; a disconnected notice
        # stream must not leave the completed move hidden until the next reopen.
        try:
            self._service.refresh_facility_details(self._facility_id)
        except Exception:
            pass

    controller_type._deposit_input_items = deposit
    original_close = getattr(controller_type, "close", None)
    if original_close is not None:
        def close(self):
            cache = getattr(getattr(self, "_strategy", None), "_evejs_industry_storage_cache", {})
            for _, inventory in list(cache.values()):
                try:
                    inventory.smart_storage_controller._disconnect_event_handlers()
                except Exception:
                    pass
            cache.clear()
            return original_close(self)
        controller_type.close = close


def _evejs_patch_industry_nearby(namespace):
    facility_type = namespace["AssemblyClientFacility"]
    original = facility_type.get_nearby_inventories

    def nearby(self, include_ship_hangars, include_nest):
        inventories = original(self, include_ship_hangars, include_nest)
        from spacecomponents.common import componentConst
        from spacecomponents.common.data import get_space_component_for_type
        from frontier.smart_assemblies.client.storage.controller import StorageController
        from frontier.smart_assemblies.client.storage.smart_storage_inventory import SmartStorageUnitInventory
        # sm/session are native client builtins, also used by the stock module.
        ballpark = sm.GetService("michelle").GetBallpark()
        if ballpark is None:
            return inventories
        cache = getattr(self, "_evejs_industry_storage_cache", {})
        self._evejs_industry_storage_cache = cache
        visible = set()
        existing = {getattr(inventory, "itemID", None) for inventory in inventories}
        for row in ballpark.GetCrDataByFilter().values():
            if row.itemID == self.facility_id:
                continue
            if not get_space_component_for_type(row.typeID, componentConst.SMART_STORAGE_UNIT):
                continue
            try:
                distance = ballpark.DistanceBetween(session.shipid, row.ballID)
                if not 0 <= distance <= 5000 or not self._smart_assembly_svc.is_online(row.itemID):
                    continue
            except Exception:
                continue
            visible.add(row.itemID)
            key = (row.typeID, row.ownerID)
            cached = cache.get(row.itemID)
            if cached is not None and cached[0] != key:
                cached[1].smart_storage_controller._disconnect_event_handlers()
                cached = None
            if cached is None:
                controller = StorageController(row.itemID, row.typeID, row.ownerID)
                # The stock items property initially returns [] and loads in a
                # background task. Industry menus only listen to OnItemChanged,
                # so that first empty result otherwise stays cached. This is the
                # same cooperative RPC loader used by the native storage panel.
                controller._fetching_items = True
                controller._fetch_items_background()
                cached = (key, SmartStorageUnitInventory(ss_controller=controller, itemID=row.itemID, typeID=row.typeID))
                cache[row.itemID] = cached
            if row.itemID not in existing:
                inventories.append(cached[1])
                existing.add(row.itemID)
        for item_id in list(cache):
            if item_id not in visible:
                cache.pop(item_id)[1].smart_storage_controller._disconnect_event_handlers()
        return inventories

    facility_type.get_nearby_inventories = nearby


def _evejs_patch_industry_drop(namespace):
    inventory_type = namespace["SmartStorageUnitInventory"]
    original = inventory_type.OnDropData

    def drop(self, nodes):
        nodes = list(nodes or [])
        industry = [node for node in nodes if getattr(node, "__guid__", None)
                    in ("IndustryItemDragData", "xtriui.EscrowInvItem") and callable(getattr(node, "on_add_item", None))]
        if not industry:
            return original(self, nodes)
        from eveexceptions import UserError
        if len(industry) != len(nodes):
            raise UserError("CannotAddToThatLocation")
        if not self.smart_storage_controller.is_online():
            raise UserError("SmartStorageOffline")
        # Industry slot and escrow nodes already carry their correct withdrawal
        # callback, including Shift quantity prompts and target-capacity checks.
        for node in industry:
            node.on_add_item(self)

    inventory_type.OnDropData = drop
