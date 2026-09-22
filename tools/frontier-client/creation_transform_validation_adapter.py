"""Make native Creation client validation understand EveJS reflections."""


def _evejs_reflection(value):
    try:
        return int(value) % 360 == 180
    except (TypeError, ValueError):
        return False


def _evejs_cell_coordinates(cell):
    """Normalize native FSD cell records and test-friendly sequences."""
    try:
        return cell.x, cell.y, 0
    except AttributeError:
        values = tuple(cell)
        if len(values) == 2:
            return values[0], values[1], 0
        return values[0], values[1], values[2]


def _evejs_install_creation_transform_validation(namespace):
    validator = namespace.get("CreationLayoutValidator")
    if validator is None or getattr(validator, "_evejs_reflections", False):
        return

    def absolute_cells(placement, cells):
        cells = [_evejs_cell_coordinates(cell) for cell in cells or ()]
        if not cells:
            return []
        min_x = min(cell[0] for cell in cells)
        max_x = max(cell[0] for cell in cells)
        min_y = min(cell[1] for cell in cells)
        max_y = max(cell[1] for cell in cells)
        mirror_x = _evejs_reflection(getattr(placement.rotation, "x", 0))
        mirror_y = _evejs_reflection(getattr(placement.rotation, "y", 0))
        result = []
        for dx, dy, dz in cells:
            if mirror_x:
                dx = min_x + max_x - dx
            if mirror_y:
                dy = min_y + max_y - dy
            dx, dy, dz = validator._rotate_offset(
                dx, dy, dz, placement.rotation.z
            )
            result.append((
                placement.x + dx,
                placement.y + dy,
                placement.z + dz,
            ))
        return result

    validator._absolute_cells = staticmethod(absolute_cells)
    validator._evejs_reflections = True
