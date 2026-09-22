"""Creation management mirror/flip support for Frontier build 3502403."""


def _evejs_reflection(value):
    try:
        return 180 if int(value) % 360 == 180 else 0
    except (TypeError, ValueError):
        return 0


def _evejs_reflect_cells(cells, rotation_x=0, rotation_y=0):
    cells = frozenset(tuple(cell) for cell in cells or ())
    if not cells:
        return cells
    xs = [cell[0] for cell in cells]
    ys = [cell[1] for cell in cells]
    min_x, max_x = min(xs), max(xs)
    min_y, max_y = min(ys), max(ys)
    mirror_x = _evejs_reflection(rotation_x) == 180
    mirror_y = _evejs_reflection(rotation_y) == 180
    return frozenset(
        (
            min_x + max_x - cell[0] if mirror_x else cell[0],
            min_y + max_y - cell[1] if mirror_y else cell[1],
        )
        for cell in cells
    )


def _evejs_transform_cells(namespace, type_id, rotation):
    cells = namespace["get_module_cells"](type_id)
    cells = _evejs_reflect_cells(
        cells,
        getattr(rotation, "x", 0),
        getattr(rotation, "y", 0),
    )
    return namespace["rotate_cell_grid"](
        cells,
        getattr(rotation, "z", 0),
    )


def _evejs_modifier_state():
    try:
        from carbonui.uiconst import VK_CONTROL, VK_SHIFT
        from carbonui.uicore import uicore
        return (
            bool(uicore.uilib.Key(VK_SHIFT)),
            bool(uicore.uilib.Key(VK_CONTROL)),
        )
    except (AttributeError, ImportError):
        return False, False


def _evejs_install_creation_transforms(namespace):
    integration = namespace.get("ManagementViewIntegration")
    manager = namespace.get("CreationManager")
    if integration is None or manager is None:
        return
    if getattr(integration, "_evejs_creation_transforms", False):
        return

    original_start_drag = integration._start_drag_interior_module
    original_mouse_wheel = integration._handle_global_mouse_wheel
    original_compute_hints = integration._compute_binding_hints
    original_create_controller = integration._create_module_controller
    original_update_part = integration._update_part_controller
    original_release = integration._release_held_module

    held_type = namespace["HeldModule"]
    held_part_source = namespace["HeldModulePartSource"]
    held_inventory_source = namespace["HeldModuleInventorySource"]
    snapped_part_cell = namespace["SnappedPartCell"]
    module_controller = namespace["ModuleController"]
    cell_grid_data = namespace["CellGridData"]
    binding_hint = namespace["BindingHintData"]
    diagnostic_code = namespace["DiagnosticCode"]

    def transform_for_placement(creation, item_id, placement):
        module = creation.modules.get(item_id)
        if module is None:
            return frozenset()
        return _evejs_transform_cells(namespace, module.type_id, placement.rotation)

    def refresh_held(self):
        held = self._held_module
        if not isinstance(held, held_type):
            return
        base = namespace["get_module_cells"](held.source.type_id)
        cells = _evejs_reflect_cells(
            base,
            getattr(held, "_evejs_rotation_x", 0),
            getattr(held, "_evejs_rotation_y", 0),
        )
        cells = namespace["rotate_cell_grid"](cells, held.rotation_z)
        held.cells = cells
        held.anchor_offset = namespace["find_cell_grid_center"](cells)
        dragged = self._controller.dragged_module
        if dragged:
            dragged.anchor_offset = held.anchor_offset
            dragged.cells = cells
        hover = held.hover_state
        if isinstance(hover, snapped_part_cell):
            part_controller = self._part_controller_by_id.get(hover.part_id)
            if part_controller is not None and part_controller.preview_module:
                part_controller.preview_module = module_controller(
                    cell=hover.cell,
                    shape=cell_grid_data(cells),
                )
        self._update_highlight_cells()
        self._update_binding_hints()

    def start_drag(self, source):
        original_start_drag(self, source)
        held = self._held_module
        if not isinstance(held, held_type):
            return
        rotation_x = rotation_y = 0
        if isinstance(source, held_part_source):
            placement = self._creation_manager.creation.interior_placements.get(
                source.item_id
            )
            if placement is not None:
                rotation_x = _evejs_reflection(placement.rotation.x)
                rotation_y = _evejs_reflection(placement.rotation.y)
        held._evejs_rotation_x = rotation_x
        held._evejs_rotation_y = rotation_y
        self._creation_manager._evejs_rotation_x = rotation_x
        self._creation_manager._evejs_rotation_y = rotation_y
        refresh_held(self)

    def get_snap_location(self, held_module, part_cell_fraction):
        part_id = self._part_id_by_controller.get(
            part_cell_fraction.part_controller
        )
        if part_id is None:
            return None

        column_offset, row_offset = held_module.anchor_offset
        fraction_column, fraction_row = part_cell_fraction.cell_fraction
        snapped_column = int(round(fraction_column - column_offset))
        snapped_row = int(round(fraction_row - row_offset))
        rotation_x = _evejs_reflection(
            getattr(held_module, "_evejs_rotation_x", 0)
        )
        rotation_y = _evejs_reflection(
            getattr(held_module, "_evejs_rotation_y", 0)
        )

        source = held_module.source
        if isinstance(source, held_part_source):
            item_id = source.item_id
            changes = [namespace["MoveChange"](
                module_item_id=item_id,
                part_id=part_id,
                x=snapped_column,
                y=snapped_row,
                z=0,
                rotation_x=rotation_x,
                rotation_y=rotation_y,
                rotation_z=held_module.rotation_z,
            )]
        elif isinstance(source, held_inventory_source):
            item_id = source.item_id
            changes = [namespace["AddChange"](
                module_item_id=item_id,
                type_id=source.type_id,
                part_id=part_id,
                x=snapped_column,
                y=snapped_row,
                z=0,
                rotation_x=rotation_x,
                rotation_y=rotation_y,
                rotation_z=held_module.rotation_z,
                source_location_id=source.location_id,
                source_flag_id=source.flag_id,
            )]
        else:
            raise TypeError("Unknown source {}".format(source))

        validator = namespace["CreationLayoutValidator"]
        baseline = self._creation_manager.creation
        final_layout = validator.reconstruct_final_layout(
            baseline=baseline, changes=changes
        )
        errors = validator.validate_layout(final_layout)
        errors += validator.validate_changes(
            baseline=baseline, changes=changes
        )
        for error in errors:
            if error.code != diagnostic_code.INVALID_PLACEMENT:
                continue
            if (
                error.module_item_id == item_id
                or error.params.get("conflicting_item_id") == item_id
            ):
                return None
        return snapped_column, snapped_row

    def mouse_wheel(self, event):
        if not isinstance(self._held_module, held_type):
            return original_mouse_wheel(self, event)
        shift, control = _evejs_modifier_state()
        if not shift and not control:
            return original_mouse_wheel(self, event)
        if not int(round(event.delta)):
            return None
        held = self._held_module
        if shift:
            held._evejs_rotation_x = 0 if _evejs_reflection(
                getattr(held, "_evejs_rotation_x", 0)
            ) else 180
        if control:
            held._evejs_rotation_y = 0 if _evejs_reflection(
                getattr(held, "_evejs_rotation_y", 0)
            ) else 180
        self._creation_manager._evejs_rotation_x = held._evejs_rotation_x
        self._creation_manager._evejs_rotation_y = held._evejs_rotation_y
        refresh_held(self)
        return None

    def compute_hints(self):
        result = tuple(original_compute_hints(self))
        if isinstance(self._held_module, held_type):
            result += (
                binding_hint("Shift + Scroll", "Mirror"),
                binding_hint("Ctrl + Scroll", "Flip"),
            )
        return result

    def create_controller(self, creation, item_id):
        controller = original_create_controller(self, creation, item_id)
        placement = creation.interior_placements.get(item_id)
        if placement is not None:
            controller.shape = cell_grid_data(
                transform_for_placement(creation, item_id, placement)
            )
        return controller

    def update_part(self, creation, part_id, part_controller):
        result = original_update_part(self, creation, part_id, part_controller)
        for item_id, placement in creation.interior_placements.items():
            if placement.part_id != part_id:
                continue
            controller = self._module_controller_by_id.get(item_id)
            if controller is not None:
                controller.shape = cell_grid_data(
                    transform_for_placement(creation, item_id, placement)
                )
        return result

    def release(self):
        try:
            return original_release(self)
        finally:
            self._creation_manager._evejs_rotation_x = 0
            self._creation_manager._evejs_rotation_y = 0

    def move(self, item_id, part_id, cell, rotation_z):
        return self._apply_change(namespace["MoveChange"](
            module_item_id=item_id,
            part_id=part_id,
            x=cell[0],
            y=cell[1],
            z=0,
            rotation_x=_evejs_reflection(
                getattr(self, "_evejs_rotation_x", 0)
            ),
            rotation_y=_evejs_reflection(
                getattr(self, "_evejs_rotation_y", 0)
            ),
            rotation_z=rotation_z,
        ))

    def install_from_inventory(
        self, item_id, type_id, location_id, flag_id, part_id, cell, rotation_z
    ):
        add = namespace["AddChange"](
            module_item_id=item_id,
            type_id=type_id,
            source_location_id=location_id,
            source_flag_id=flag_id,
            part_id=part_id,
            x=cell[0],
            y=cell[1],
            z=0,
            rotation_x=_evejs_reflection(
                getattr(self, "_evejs_rotation_x", 0)
            ),
            rotation_y=_evejs_reflection(
                getattr(self, "_evejs_rotation_y", 0)
            ),
            rotation_z=rotation_z,
        )
        placements = namespace["default_hardpoint_placements"](
            creation=self.creation,
            interior_item_id=item_id,
            interior_type_id=type_id,
            own_part_id=part_id,
        )
        return self._apply_changes([add, *placements])

    def available_part_cells(self, part_id, changes):
        creation = self.creation
        if changes:
            creation = namespace["CreationLayoutValidator"].reconstruct_final_layout(
                creation, changes
            )
        part = creation.layout.parts.get(part_id)
        if part is None:
            return None
        cells = namespace["get_part_cells"](part.graphic_id)
        for item_id, placement in creation.interior_placements.items():
            if placement.part_id != part_id:
                continue
            module = creation.modules.get(item_id)
            if module is None:
                continue
            module_cells = _evejs_transform_cells(
                namespace, module.type_id, placement.rotation
            )
            anchor = (placement.x, placement.y)
            cells.difference_update(
                namespace["cell_add"](anchor, cell) for cell in module_cells
            )
        return cells

    integration._start_drag_interior_module = start_drag
    integration._get_snap_location = get_snap_location
    integration._handle_global_mouse_wheel = mouse_wheel
    integration._compute_binding_hints = compute_hints
    integration._create_module_controller = create_controller
    integration._update_part_controller = update_part
    integration._release_held_module = release
    integration._evejs_creation_transforms = True
    manager.move = move
    manager.install_from_inventory = install_from_inventory
    manager.get_available_part_cells = available_part_cells
