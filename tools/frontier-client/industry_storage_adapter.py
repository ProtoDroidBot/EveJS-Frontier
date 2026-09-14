"""Native build-3502403 inventory adapters embedded by the exact-bytecode patcher.

The server authorizes and commits every move. SSU UI rows represent type totals;
their optional item ID is only a representative identity for the grid. Transfers
between SSUs therefore use the protobuf's type-and-quantity withdrawal contract.
"""


def _evejs_sequential_id(value):
    value = getattr(value, "sequential", value)
    try:
        value = int(value)
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _evejs_transfer_ssu_items(controller, source_id, destination_id, requested, rows):
    import logging
    from eveProto.generated.eve_public.assembly import assembly_pb2
    from eveProto.generated.eve_public.assembly.storageunit.api import requests_pb2
    from eveProto.generated.eve_public.inventory import generic_item_type_pb2
    from eveProto.generated.eve_public.sponsoredtransaction.preparedtransaction import preparedtransaction_pb2
    from frontier.proto_client.client import send_request
    from frontier.smart_assemblies.common.models.inventory import InventoryItem

    service = controller.smart_assembly_svc
    service.sui_wallet.validate_wallet_address()
    by_type = {getattr(row, "typeID", None): row for row in rows}
    items = [InventoryItem(type_id=type_id,
                           item_id=_evejs_sequential_id(getattr(by_type.get(type_id), "itemID", None)) or 0,
                           quantity=quantity)
             for type_id, quantity in sorted(requested.items())]
    success = False
    service.on_withdraw_items_started(source_id, items)
    service.on_deposit_items_started(destination_id, items)
    try:
        prepare = requests_pb2.PrepareWithdrawItemsRequest(
            source_container=assembly_pb2.Identifier(sequential=source_id),
            another_assembly=assembly_pb2.Identifier(sequential=destination_id),
        )
        for type_id, quantity in sorted(requested.items()):
            prepare.stacks.add(
                item_type=generic_item_type_pb2.Identifier(sequential=type_id),
                quantity=quantity,
            )
        response = send_request(service._messenger._public_gateway, prepare,
                                requests_pb2.PrepareWithdrawItemsResponse)
        if not response.success:
            logging.getLogger(__name__).error("Prepare SSU transfer failed: %s", response.status_message)
            return
        transaction = response.data.prepared_transaction
        data = response.data.prepared_transaction_attributes.bcs_data_b64_bytes
        signature = service.sui_wallet.sign_transaction(data)
        execute = requests_pb2.ExecuteWithdrawItemsRequest(
            prepared_transaction=preparedtransaction_pb2.Identifier(uuid=transaction.uuid),
            signature=signature,
        )
        response = send_request(service._messenger._public_gateway, execute,
                                requests_pb2.ExecuteWithdrawItemsResponse)
        success = response.success
        if not success:
            logging.getLogger(__name__).error("Execute SSU transfer failed: %s", response.status_message)
    except Exception:
        logging.getLogger(__name__).exception(
            "SSU transfer failed from assembly %d to %d", source_id, destination_id)
    finally:
        service.on_withdraw_items_completed(source_id, success, items)
        service.on_deposit_items_completed(destination_id, success, items)


def _evejs_install_industry_storage(namespace, kind):
    if kind == "controller":
        _evejs_patch_industry_inputs(namespace)
        _evejs_patch_industry_refresh_loop(namespace)
    elif kind == "facility":
        _evejs_patch_industry_nearby(namespace)
    elif kind == "storage":
        _evejs_patch_industry_drop(namespace)
    elif kind == "panel":
        _evejs_patch_industry_panel(namespace)
    elif kind == "service":
        _evejs_patch_industry_service(namespace)
    elif kind == "assembly_window":
        _evejs_patch_industry_window(namespace)


def _evejs_patch_industry_window(namespace):
    panel_type = namespace["AssemblyDockablePanel"]
    original_initialize = panel_type.initialize

    def initialize(self, item_id, type_id, owner_id, sui_wallet):
        controller = getattr(self, "controller", None)
        page = getattr(self, "main_container", None)
        integration = getattr(self, "integration", None)
        page_controller = getattr(page, "_controller", None)
        facility = getattr(page_controller, "_facility_instance", None)
        service = getattr(page_controller, "_service", None)
        if (not getattr(self, "destroyed", False)
                and namespace["_is_owned_industry_facility"](type_id, owner_id)
                and controller is not None
                and (controller.item_id, controller.type_id, controller.owner_id) == (item_id, type_id, owner_id)
                and self._sui_wallet_svc is sui_wallet
                and isinstance(page, namespace["IndustryFacilityPage"])
                and not page.destroyed
                and page._assembly_controller is controller
                and page_controller is not None
                and not getattr(page_controller, "_evejs_refresh_closed", False)
                and facility is not None
                and getattr(service, "_facilities", {}).get(item_id) is facility
                and integration is not None
                and integration.controller is controller
                and integration._active):
            # Native Open still raises/focuses the existing window. Rebuilding
            # its ROOT browser here discards an in-flight dapp task queue.
            namespace["sm"].GetService("smartAssemblySvc").on_interaction(item_id)
            self._update_selection_buttons()
            return
        return original_initialize(self, item_id, type_id, owner_id, sui_wallet)

    panel_type.initialize = initialize


def _evejs_patch_industry_service(namespace):
    service_type = namespace["IndustryService"]
    event = "OnFrontierIndustryBlueprintChanged"
    service_type.__notifyevents__ = list(dict.fromkeys(list(service_type.__notifyevents__) + [event]))
    threads = namespace["uthread2"]

    def refresh(self, facility_id):
        facility = self._facilities.get(facility_id)
        if facility is None:
            return
        if facility.loading_details or facility.requesting or getattr(facility, "_evejs_details_running", False):
            facility._evejs_refresh_pending = True
            return
        facility.set_details_state(loading=True, error=False)
        threads.start_tasklet(self._request_facility_details, facility_id, facility)

    def changed(self, facility_id):
        facility = self._facilities.get(facility_id)
        if facility is None:
            return
        # Invalidate a read already in flight before asking for the new recipe.
        facility._evejs_blueprint_revision = getattr(facility, "_evejs_blueprint_revision", 0) + 1
        self.refresh_facility_details(facility_id)

    def request(self, facility_id, expected=None):
        facility = self._facilities.get(facility_id)
        if facility is None or (expected is not None and expected is not facility):
            return
        if getattr(facility, "_evejs_details_running", False):
            facility._evejs_refresh_pending = True
            return
        facility._evejs_details_running = True
        facility._evejs_refresh_pending = False
        revision = getattr(facility, "_evejs_blueprint_revision", 0)
        is_refreshing = bool(facility.details_fetched)
        facility.set_details_state(loading=True, error=False)
        info = None
        error = None
        try:
            try:
                info = self._remote_service.get_facility_details(facility_id)
            except namespace["IndustryError"] as exception:
                if exception.msg == namespace["ErrorReason"].FACILITY_NOT_FOUND:
                    info = {}
                else:
                    error = exception.msg
                    namespace["logger"].warning("Error fetching industry details: %s", exception)
            except Exception as exception:
                error = namespace["ErrorReason"].GENERIC
                namespace["logger"].error("Exception fetching industry details: %s", exception)
            # A session change may replace the cached object with the same ID.
            # A blueprint load may also commit while this network read yields.
            if self._facilities.get(facility_id) is not facility:
                return
            if revision != getattr(facility, "_evejs_blueprint_revision", 0):
                facility._evejs_refresh_pending = True
                facility.set_details_state(loading=False, error=False)
                return
            if is_refreshing and (not info or error):
                facility.set_details_state(loading=False, error=False)
                return
            if error:
                namespace["prompt_error_message"](error, namespace["ErrorHeaders"].DETAILS)
                facility.set_details_state(loading=False, error=True)
                return
            facility.set_details_state(loading=False, error=False)
            if info is not None:
                facility.update_production(info.get("production"))
                items = info.get("items", {})
                facility.update_item_stacks(input_items=items.get("inputs", {}), output_items=items.get("outputs", {}))
                old_blueprint = facility.blueprint
                facility.update_blueprint(info.get("blueprint"))
                if old_blueprint is not None and facility.blueprint is not None and \
                        old_blueprint.blueprint_id == facility.blueprint.blueprint_id and old_blueprint != facility.blueprint:
                    facility.on_blueprint_changed()
        finally:
            facility._evejs_details_running = False
            if self._facilities.get(facility_id) is facility and getattr(facility, "_evejs_refresh_pending", False):
                self.refresh_facility_details(facility_id)

    original_changed = service_type._on_blueprint_changed

    def local_changed(self, facility_id, blueprint):
        facility = self._facilities.get(facility_id)
        if facility is not None:
            facility._evejs_blueprint_revision = getattr(facility, "_evejs_blueprint_revision", 0) + 1
        return original_changed(self, facility_id, blueprint)

    original_load = service_type.load_blueprint

    def load(self, facility_id, blueprint_id):
        try:
            return original_load(self, facility_id, blueprint_id)
        finally:
            facility = self._facilities.get(facility_id)
            if facility is not None and getattr(facility, "_evejs_refresh_pending", False):
                self.refresh_facility_details(facility_id)

    service_type.refresh_facility_details = refresh
    service_type.OnFrontierIndustryBlueprintChanged = changed
    service_type._request_facility_details = request
    service_type._on_blueprint_changed = local_changed
    service_type.load_blueprint = load


def _evejs_patch_industry_refresh_loop(namespace):
    controller_type = namespace["FacilityPageController"]
    original_init = controller_type.__init__
    original_close = getattr(controller_type, "close", None)
    if original_close is None or "uthread2" not in namespace:
        return
    threads = namespace["uthread2"]

    def poll(controller):
        while not controller._evejs_refresh_closed:
            try:
                controller._service.refresh_facility_details(controller._facility_id)
            except Exception:
                # A dropped stream/read should recover on the next open-page tick.
                pass
            threads.sleep(3)

    def initialize(self, *args, **kwargs):
        original_init(self, *args, **kwargs)
        self._evejs_refresh_closed = False
        threads.start_tasklet(poll, self)

    def close(self):
        self._evejs_refresh_closed = True
        return original_close(self)

    controller_type.__init__ = initialize
    controller_type.close = close


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
    item_type = namespace.get("StorageInventoryItem")
    if item_type is not None and not getattr(item_type, "_evejs_item_ids_installed", False):
        original_init = item_type.__init__
        original_getitem = item_type.__getitem__

        def initialize(self, type_id, quantity, is_singleton, owner_id, flag_id,
                       location_id, is_owner, item_id=None):
            original_init(self, type_id, quantity, is_singleton, owner_id, flag_id,
                          location_id, is_owner)
            self.item.itemID = _evejs_sequential_id(item_id)

        def getitem(self, index):
            if index == namespace["appConst"].ixItemID:
                return self.itemID
            return original_getitem(self, index)

        item_type.__init__ = initialize
        item_type.__getitem__ = getitem
        item_type._evejs_item_ids_installed = True

        def get_items(self):
            return [item_type(
                item.type_id,
                item.quantity,
                item.is_singleton,
                self.smart_storage_controller.assembly_owner_id,
                self.locationFlag,
                self.smart_storage_controller.assembly_id,
                self.smart_storage_controller.is_owner,
                item_id=getattr(item, "item_id", None),
            ) for item in self.smart_storage_controller.items]

        inventory_type._GetItems = get_items

    original = inventory_type.OnDropData

    def drop(self, nodes):
        nodes = list(nodes or [])
        industry = [node for node in nodes if getattr(node, "__guid__", None)
                    in ("IndustryItemDragData", "xtriui.EscrowInvItem") and callable(getattr(node, "on_add_item", None))]
        if industry:
            from eveexceptions import UserError
            if len(industry) != len(nodes):
                raise UserError("CannotAddToThatLocation")
            if not self.smart_storage_controller.is_online():
                raise UserError("SmartStorageOffline")
            # Industry slot and escrow nodes already carry their correct withdrawal
            # callback, including Shift quantity prompts and target-capacity checks.
            for node in industry:
                node.on_add_item(self)
            return

        items = [getattr(node, "item", None) for node in nodes]
        storage_items = [item for item in items if item is not None and
                         getattr(item, "flagID", None) == self.locationFlag]
        if not storage_items:
            return original(self, nodes)
        from eveexceptions import UserError
        if len(storage_items) != len(items):
            raise UserError("CannotAddToThatLocation")
        if not self.smart_storage_controller.is_online():
            raise UserError("SmartStorageOffline")
        source_ids = {getattr(item, "locationID", None) for item in storage_items}
        destination_id = self.smart_storage_controller.assembly_id
        if len(source_ids) != 1 or destination_id in source_ids:
            raise UserError("CannotAddToThatLocation")
        if any(getattr(item, "singleton", False) for item in storage_items):
            raise UserError("SmartDeployableDoesNotAcceptSingleton", {"name": "Smart storage unit"})

        requested = {}
        for item in storage_items:
            quantity = int(getattr(item, "stacksize", 0) or 0)
            if quantity <= 0:
                raise UserError("CannotAddToThatLocation")
            requested[item.typeID] = requested.get(item.typeID, 0) + quantity
        if len(storage_items) == 1:
            item = storage_items[0]
            quantity = requested[item.typeID]
            unit_volume = float(namespace["GetItemVolume"](item)) / quantity
            maximum = self.get_max_quantity(unit_volume, quantity)
            if maximum < 1:
                capacity = self.GetCapacity()
                raise UserError("NotEnoughCargoSpace", {
                    "available": capacity.capacity - capacity.used,
                    "volume": namespace["GetItemVolume"](item),
                })
            if maximum < quantity or namespace["uicore"].uilib.Key(namespace["uiconst"].VK_SHIFT):
                quantity = self.prompt_user_for_quantity_sd_resource(unit_volume, quantity)
                if not quantity:
                    return
                requested[item.typeID] = quantity
        else:
            capacity = self.GetCapacity()
            total_volume = sum(namespace["GetItemVolume"](item) for item in storage_items)
            if capacity.capacity - capacity.used < total_volume:
                raise UserError("NotEnoughCargoSpace", {
                    "available": capacity.capacity - capacity.used,
                    "volume": total_volume,
                })

        namespace["uthread"].new(
            _evejs_transfer_ssu_items,
            self.smart_storage_controller,
            next(iter(source_ids)),
            destination_id,
            requested,
            storage_items,
        )

    inventory_type.OnDropData = drop
