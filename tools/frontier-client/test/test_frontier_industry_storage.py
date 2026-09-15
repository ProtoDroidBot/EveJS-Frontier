"""Native adapter behavior plus exact-bytecode, reversible archive installation."""

import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock
import zipfile

CLIENT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(CLIENT_DIR))
import industry_storage_adapter as adapter
import patch_frontier_industry_storage as patcher
import frontier_windows_client as windows

NS = types.SimpleNamespace


class UserError(Exception):
    pass


def fake_modules(entries):
    result = {}
    for name, values in entries.items():
        pieces = name.split(".")
        for index in range(1, len(pieces) + 1):
            key = ".".join(pieces[:index])
            if key not in result:
                result[key] = types.ModuleType(key)
                result[key].__path__ = []
        result[name].__dict__.update(values)
    return mock.patch.dict(sys.modules, result)


def row(type_id=34, amount=8, storage=200, flag=66, owner=99):
    return NS(typeID=type_id, stacksize=amount, locationID=storage, flagID=flag,
              ownerID=owner, singleton=0, itemID=None)


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.errors = fake_modules({"eveexceptions": {"UserError": UserError},
                                   "frontier.industry.common.errors": {"IndustryError": UserError}})
        self.errors.start()
        self.addCleanup(self.errors.stop)

    def controller(self, prompt=lambda amount, text: amount):
        calls = []
        class Controller:
            def _deposit_input_items(self, *args):
                calls.append(("legacy", args))
        namespace = {"FacilityPageController": Controller, "_quantity_prompt": prompt,
                     "prompt_error_message": lambda *args: calls.append(("error", args)), "ErrorHeaders": NS(DEPOSIT="deposit")}
        adapter._evejs_install_industry_storage(namespace, "controller")
        controller = Controller()
        controller.active_blueprint = True
        controller._facility_id = 100
        controller._facility_instance = NS(blueprint=NS(inputs={34: NS(max_storable_quantity=10), 35: NS(max_storable_quantity=20)}),
                                          input_stacks={34: 3})
        remote = NS(deposit_storage_input_items=lambda *args: calls.append(("deposit", args)))
        controller._service = NS(get_facility_strategy=lambda _: NS(_remote_service=remote),
                                 refresh_facility_details=lambda _: calls.append(("refresh", 100)))
        return controller, calls

    def test_deposit_resolves_ssu_type_totals_instead_of_none_item_ids(self):
        controller, calls = self.controller()
        controller._deposit_input_items([row(amount=4), row(amount=8), row(35, 5)], None, False)
        self.assertEqual(calls, [("deposit", (100, 200, {34: 7, 35: 5})), ("refresh", 100)])

    def test_visitor_rows_do_not_treat_assembly_owner_as_partition_owner(self):
        controller, calls = self.controller()
        controller._deposit_input_items([row(owner=999)], 2, False)
        self.assertEqual(calls[0], ("deposit", (100, 200, {34: 2})))

    def test_quantity_prompt_and_cancel_are_honored(self):
        controller, calls = self.controller(lambda *_: 3)
        controller._deposit_input_items([row()], 8, True)
        self.assertEqual(calls[0], ("deposit", (100, 200, {34: 3})))
        controller, calls = self.controller(lambda *_: None)
        controller._deposit_input_items([row()], 8, True)
        self.assertEqual(calls, [])

    def test_non_storage_drop_keeps_native_path_and_mixed_sources_never_partially_move(self):
        controller, calls = self.controller()
        cargo = row(flag=5)
        controller._deposit_input_items([cargo], None, False)
        self.assertEqual(calls[0][0], "legacy")
        for rows in [[row(), cargo], [row(), row(storage=201)], [row(type_id=999)]]:
            calls.clear()
            with self.assertRaises(UserError):
                controller._deposit_input_items(rows, None, False)
            self.assertEqual(calls, [])

    def test_refresh_failure_does_not_report_a_committed_deposit_as_failed(self):
        controller, calls = self.controller()
        def fail(_):
            raise RuntimeError("notice unavailable")
        controller._service.refresh_facility_details = fail
        controller._deposit_input_items([row()], 1, False)
        self.assertEqual(calls, [("deposit", (100, 200, {34: 1}))])

    def test_closing_industry_page_disconnects_cached_storage_controllers(self):
        calls = []
        class Controller:
            def _deposit_input_items(self, *args):
                pass
            def close(self):
                calls.append("close")
        adapter._evejs_install_industry_storage({"FacilityPageController": Controller}, "controller")
        instance = Controller()
        cache = {200: ((42, 1), NS(smart_storage_controller=NS(_disconnect_event_handlers=lambda: calls.append("disconnect"))))}
        instance._strategy = NS(_evejs_industry_storage_cache=cache)
        instance.close()
        self.assertEqual(calls, ["disconnect", "close"])
        self.assertEqual(cache, {})

    def test_industry_slot_and_escrow_drops_use_withdraw_callback_and_other_drops_remain_native(self):
        calls = []
        class Storage:
            locationFlag = 66
            def OnDropData(self, nodes):
                calls.append(("legacy", nodes))
        adapter._evejs_install_industry_storage({"SmartStorageUnitInventory": Storage}, "storage")
        target = Storage()
        target.smart_storage_controller = NS(is_online=lambda: True)
        for guid in ["IndustryItemDragData", "xtriui.EscrowInvItem"]:
            node = NS(__guid__=guid, on_add_item=lambda inv: calls.append(("withdraw", inv.locationFlag)))
            target.OnDropData([node])
        target.OnDropData([NS(item=row(flag=5))])
        self.assertEqual([entry[0] for entry in calls], ["withdraw", "withdraw", "legacy"])
        self.assertEqual(calls[:2], [("withdraw", 66), ("withdraw", 66)])
        target.smart_storage_controller.is_online = lambda: False
        with self.assertRaisesRegex(UserError, "SmartStorageOffline"):
            target.OnDropData([node])
        with self.assertRaises(UserError):
            target.OnDropData([node, NS(item=row())])
        self.assertEqual(len(calls), 3)

    def test_storage_rows_keep_representative_item_ids_and_ssu_drops_use_type_withdrawal(self):
        calls = []

        class StorageItem:
            def __init__(self, type_id, quantity, is_singleton, owner_id, flag_id,
                         location_id, is_owner):
                self.item = NS(itemID=None, typeID=type_id, stacksize=quantity,
                               singleton=is_singleton, ownerID=owner_id,
                               flagID=flag_id, locationID=location_id)

            @property
            def itemID(self):
                return self.item.itemID

            @property
            def typeID(self):
                return self.item.typeID

            @property
            def stacksize(self):
                return self.item.stacksize

            @property
            def singleton(self):
                return self.item.singleton

            @property
            def flagID(self):
                return self.item.flagID

            @property
            def locationID(self):
                return self.item.locationID

            def __getitem__(self, index):
                return None

        class Storage:
            locationFlag = 66

            def _GetItems(self):
                return []

            def OnDropData(self, nodes):
                calls.append(("legacy", nodes))

            def get_max_quantity(self, _, quantity):
                return quantity

            def GetCapacity(self):
                return NS(capacity=1000, used=0)

            def prompt_user_for_quantity_sd_resource(self, _, quantity):
                return quantity

        namespace = {
            "SmartStorageUnitInventory": Storage,
            "StorageInventoryItem": StorageItem,
            "GetItemVolume": lambda item: item.stacksize,
            "appConst": NS(ixItemID=0),
            "uiconst": NS(VK_SHIFT=16),
            "uicore": NS(uilib=NS(Key=lambda _: False)),
            "uthread": NS(new=lambda function, *args: function(*args)),
        }
        adapter._evejs_install_industry_storage(namespace, "storage")
        model = NS(type_id=34, quantity=8, is_singleton=False,
                   item_id=NS(sequential=1234))
        target = Storage()
        target.smart_storage_controller = NS(
            assembly_id=300,
            assembly_owner_id=99,
            is_online=lambda: True,
            is_owner=True,
            items=[model],
        )
        rendered = target._GetItems()
        self.assertEqual(rendered[0].itemID, 1234)
        self.assertEqual(rendered[0][namespace["appConst"].ixItemID], 1234)

        source = StorageItem(34, 8, False, 99, 66, 200, True, item_id=1234)
        with mock.patch.object(adapter, "_evejs_transfer_ssu_items",
                               side_effect=lambda *args: calls.append(("transfer", args))):
            target.OnDropData([NS(item=source)])
        self.assertEqual(calls[0][0], "transfer")
        _, arguments = calls[0]
        self.assertEqual(arguments[1:4], (200, 300, {34: 8}))
        self.assertEqual(arguments[4], [source])

    def test_ssu_transfer_worker_populates_another_assembly_and_completes_both_sides(self):
        requests = []
        signals = []

        class Identifier:
            def __init__(self, sequential=None, uuid=None):
                self.sequential = sequential
                self.uuid = uuid

        class StackList(list):
            def add(self, **values):
                self.append(NS(**values))

        class Prepare:
            def __init__(self, source_container, another_assembly):
                self.source_container = source_container
                self.another_assembly = another_assembly
                self.stacks = StackList()

        class Execute:
            def __init__(self, prepared_transaction, signature):
                self.prepared_transaction = prepared_transaction
                self.signature = signature

        class InventoryItem:
            def __init__(self, **values):
                self.__dict__.update(values)

        def send_request(_, request, __):
            requests.append(request)
            if isinstance(request, Prepare):
                return NS(success=True, data=NS(
                    prepared_transaction=NS(uuid=b"uuid"),
                    prepared_transaction_attributes=NS(bcs_data_b64_bytes="transaction"),
                ))
            return NS(success=True)

        generated = {
            "eveProto.generated.eve_public.assembly.assembly_pb2": {"Identifier": Identifier},
            "eveProto.generated.eve_public.assembly.storageunit.api.requests_pb2": {
                "PrepareWithdrawItemsRequest": Prepare,
                "PrepareWithdrawItemsResponse": object,
                "ExecuteWithdrawItemsRequest": Execute,
                "ExecuteWithdrawItemsResponse": object,
            },
            "eveProto.generated.eve_public.inventory.generic_item_type_pb2": {"Identifier": Identifier},
            "eveProto.generated.eve_public.sponsoredtransaction.preparedtransaction.preparedtransaction_pb2": {
                "Identifier": Identifier,
            },
            "frontier.proto_client.client": {"send_request": send_request},
            "frontier.smart_assemblies.common.models.inventory": {"InventoryItem": InventoryItem},
        }
        signal = lambda name: lambda assembly_id, *values: signals.append(
            (name, assembly_id,
             [(item.type_id, item.quantity) for item in values[-1]]))
        service = NS(
            _messenger=NS(_public_gateway=object()),
            on_deposit_items_completed=signal("deposit-completed"),
            on_deposit_items_started=signal("deposit-started"),
            on_withdraw_items_completed=signal("withdraw-completed"),
            on_withdraw_items_started=signal("withdraw-started"),
            sui_wallet=NS(
                sign_transaction=lambda value: "signed:" + value,
                validate_wallet_address=lambda: None,
            ),
        )
        controller = NS(smart_assembly_svc=service)
        with fake_modules(generated):
            adapter._evejs_transfer_ssu_items(
                controller,
                200,
                300,
                {34: 8},
                [NS(typeID=34, itemID=NS(sequential=1234))],
            )

        self.assertEqual(requests[0].source_container.sequential, 200)
        self.assertEqual(requests[0].another_assembly.sequential, 300)
        self.assertEqual(requests[0].stacks[0].item_type.sequential, 34)
        self.assertEqual(requests[0].stacks[0].quantity, 8)
        self.assertEqual(requests[1].prepared_transaction.uuid, b"uuid")
        self.assertEqual(requests[1].signature, "signed:transaction")
        self.assertEqual([entry[:2] for entry in signals], [
            ("withdraw-started", 200),
            ("deposit-started", 300),
            ("withdraw-completed", 200),
            ("deposit-completed", 300),
        ])

    def test_nearby_ssus_include_visitor_partitions_filter_range_and_reuse_controllers(self):
        created = []
        disconnected = []
        fetched = []
        class Controller:
            def __init__(self, item, type_id, owner):
                self.item = item
                created.append((item, type_id, owner))
            def _disconnect_event_handlers(self):
                disconnected.append(self.item)
            def _fetch_items_background(self):
                self._items = [row()]
                fetched.append(self.item)
        class Inventory:
            locationFlag = 66
            def __init__(self, ss_controller, itemID, typeID):
                self.smart_storage_controller = ss_controller
                self.itemID = itemID
            def GetItems(self):
                return self.smart_storage_controller._items
        class Facility:
            facility_id = 100
            _smart_assembly_svc = NS(is_online=lambda item: item != 202)
            def get_nearby_inventories(self, *_):
                return [NS(itemID=1)]
        rows = {item: NS(itemID=item, ballID=item, typeID=42 if item != 204 else 99, ownerID=777)
                for item in [200, 201, 202, 204]}
        ballpark = NS(GetCrDataByFilter=lambda: rows, DistanceBetween=lambda _, item: 6000 if item == 201 else 100)
        modules = fake_modules({
            "spacecomponents.common": {"componentConst": NS(SMART_STORAGE_UNIT="storage")},
            "spacecomponents.common.data": {"get_space_component_for_type": lambda type_id, _: type_id == 42},
            "frontier.smart_assemblies.client.storage.controller": {"StorageController": Controller},
            "frontier.smart_assemblies.client.storage.smart_storage_inventory": {"SmartStorageUnitInventory": Inventory},
        })
        with modules, mock.patch.object(adapter, "sm", NS(GetService=lambda _: NS(GetBallpark=lambda: ballpark)), create=True), \
             mock.patch.object(adapter, "session", NS(shipid=1, charid=5), create=True):
            adapter._evejs_install_industry_storage({"AssemblyClientFacility": Facility}, "facility")
            facility = Facility()
            first_open = facility.get_nearby_inventories(False, False)
            self.assertEqual([i.itemID for i in first_open], [1, 200])
            self.assertEqual(first_open[1].GetItems()[0].stacksize, 8, "First-open Industry source picker must already have SSU contents")
            facility.get_nearby_inventories(False, False)
            self.assertEqual(created, [(200, 42, 777)])
            self.assertEqual(fetched, [200], "Cached controller must not reload on every menu render")
            rows.clear()
            self.assertEqual([i.itemID for i in facility.get_nearby_inventories(False, False)], [1])
            self.assertEqual(disconnected, [200])


@unittest.skipUnless(sys.version_info[:2] == (3, 12), "Native code patch requires Python 3.12")
class PatcherTests(unittest.TestCase):
    def test_exact_source_round_trip_unknown_and_tampered_members_fail_closed(self):
        code = compile("class FacilityPageController:\n def _deposit_input_items(self, *args): return 'native'\n", "fixture.py", "exec")
        source = importlib.util.MAGIC_NUMBER + bytes(12) + marshal.dumps(code)
        expected = hashlib.sha256(source).hexdigest()
        patched = patcher.patched_member(source, "controller")
        self.assertEqual(patcher.inspect_member(source, "controller", expected)[0], "source")
        self.assertEqual(patcher.inspect_member(patched, "controller", expected)[0], "patched")
        namespace = {}
        exec(marshal.loads(patched[16:]), namespace)
        self.assertEqual(namespace["FacilityPageController"]()._deposit_input_items([], None, False), "native")
        with self.assertRaises(patcher.IndustryStoragePatchError):
            patcher.inspect_member(patched[:-1] + b"!", "controller", expected)
        with self.assertRaises(patcher.IndustryStoragePatchError):
            patcher.inspect_archive(Path("unused"), 3502404)

    def test_windows_pipeline_requires_adapter_only_for_supported_build(self):
        self.assertEqual(windows.expected_code_states(3502403, "patched"),
                         {"docking": "patched", "features": "patched", "industryStorage": "patched",
                          "mapViewLifecycle": "patched", "fittingCompatibility": "patched",
                          "inventoryView": "patched", "collisionVfx": "patched"})
        self.assertEqual(windows.expected_code_states(3488090, "source"), {"docking": "source", "features": "source"})
        with mock.patch.object(windows, "run_python_patcher", return_value="patched") as run:
            self.assertEqual(windows.patch_code_archive(Path("unused"), 3502403), windows.expected_code_states(3502403, "patched"))
            self.assertTrue(any(call.args[0] == windows.INDUSTRY_STORAGE_PATCHER for call in run.call_args_list))
            self.assertTrue(any(call.args[0] == windows.MAP_VIEW_PATCHER for call in run.call_args_list))
            self.assertTrue(any(call.args[0] == windows.FITTING_COMPATIBILITY_PATCHER for call in run.call_args_list))

    def test_stage_upgrade_backs_up_only_adapter_files_and_rolls_back_failed_validation(self):
        for fail in [False, True]:
            with self.subTest(fail=fail), tempfile.TemporaryDirectory() as directory:
                stage = Path(directory)
                code, manifest, marker_path = stage / "code.ccp", stage / "manifest.dat", stage / ".evejs-frontier-stage.json"
                code.write_bytes(b"native and existing feature patches")
                manifest.write_bytes(b"original manifest")
                marker = {"build": 3502403, "nativeBlue": "blue.pyd", "clientPatchBackup": "retain-existing-backup",
                          "currentHashes": {"code.ccp": windows.sha256_file(code), "manifest.dat": windows.sha256_file(manifest)}}
                marker_path.write_text(json.dumps(marker), encoding="utf-8")
                original = {path: path.read_bytes() for path in [code, manifest, marker_path]}
                checks = []
                def check(*_, **options):
                    checks.append(options)
                    if len(checks) == 2 and fail:
                        raise windows.FrontierWindowsError("post-patch verification failed")
                    return {"valid": True}
                def patch(*_args, **_kwargs):
                    code.write_bytes(code.read_bytes() + b" plus Industry adapter")
                def refresh(*_):
                    manifest.write_bytes(b"refreshed manifest")
                with mock.patch.object(windows, "check_stage", side_effect=check), \
                     mock.patch.object(windows, "load_stage", return_value=(marker_path, marker)), \
                     mock.patch.object(windows, "stage_paths", return_value={"code": code, "manifest": manifest}), \
                     mock.patch.object(windows, "code_patch_states", return_value={"docking": "patched", "features": "patched", "industryStorage": "source", "mapViewLifecycle": "patched", "fittingCompatibility": "patched", "inventoryView": "patched", "collisionVfx": "patched"}), \
                     mock.patch.object(windows, "resolve_profile", return_value=(None, {})), \
                     mock.patch.object(windows, "run_python_patcher", side_effect=patch), \
                     mock.patch.object(windows, "refresh_manifest_atomic", side_effect=refresh):
                    if fail:
                        with self.assertRaisesRegex(windows.FrontierWindowsError, "verification failed"):
                            windows.upgrade_industry_storage_stage(stage)
                        self.assertEqual({path: path.read_bytes() for path in original}, original)
                    else:
                        self.assertTrue(windows.upgrade_industry_storage_stage(stage)["valid"])
                        saved = json.loads(marker_path.read_text(encoding="utf-8"))
                        self.assertEqual(saved["clientPatchBackup"], "retain-existing-backup")
                        self.assertEqual(saved["industryStoragePatchState"], "patched")
                        self.assertEqual(saved["currentHashes"]["code.ccp"], windows.sha256_file(code))
                        backup = Path(saved["industryStoragePatchBackup"])
                        self.assertEqual((backup / "code.ccp").read_bytes(), original[code])
                self.assertTrue(checks[0]["allow_industry_storage_source"])
                self.assertTrue(checks[0]["allow_map_view_source"])
                self.assertTrue(checks[0]["allow_fitting_compatibility_source"])
                self.assertNotIn("allow_industry_storage_source", checks[1])

    @unittest.skipUnless(os.environ.get("EVE_FRONTIER_TEST_ARCHIVE"), "Set EVE_FRONTIER_TEST_ARCHIVE for real bytecode validation")
    def test_supported_native_modules_install_idempotently_and_preserve_unrelated_members(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "code.ccp"
            with zipfile.ZipFile(os.environ["EVE_FRONTIER_TEST_ARCHIVE"]) as source, zipfile.ZipFile(archive, "w") as target:
                for name in patcher.PROFILES:
                    target.writestr(name, source.read(name))
                target.writestr("unrelated.pyc", b"preserve exactly")
            self.assertEqual(patcher.inspect_archive(archive)[0], "source")
            patcher.patch_archive(archive)
            once = archive.read_bytes()
            self.assertEqual(patcher.inspect_archive(archive)[0], "patched")
            patcher.patch_archive(archive)
            self.assertEqual(archive.read_bytes(), once)
            with zipfile.ZipFile(archive) as result:
                self.assertEqual(result.read("unrelated.pyc"), b"preserve exactly")


if __name__ == "__main__":
    unittest.main()
