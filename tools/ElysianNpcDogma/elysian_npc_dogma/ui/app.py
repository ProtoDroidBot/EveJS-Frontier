from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QAction
from PySide6.QtWidgets import (
    QApplication,
    QAbstractItemView,
    QCheckBox,
    QComboBox,
    QFileDialog,
    QHBoxLayout,
    QHeaderView,
    QLabel,
    QLineEdit,
    QMainWindow,
    QMessageBox,
    QPlainTextEdit,
    QPushButton,
    QSplitter,
    QTabWidget,
    QTableWidget,
    QTableWidgetItem,
    QVBoxLayout,
    QWidget,
)

from elysian_fsd.hashing import sha256_file

from ..catalog import NpcDogmaCatalog, find_source_suggestions
from ..changes import semantic_diff
from ..deployment import apply_bundle, compile_project, prepare_bundle, rollback
from ..models import (
    AttributeOperation,
    EffectOperation,
    NpcDogmaProject,
    TargetEdit,
    load_project,
    save_project,
)
from ..paths import PROJECTS_ROOT, RUNTIME_ROOT, default_client_root, default_server_root
from ..presets import ATTRIBUTE_PRESETS
from ..validation import format_report, validate_project


def _number(value) -> str:
    if value is None:
        return "—"
    numeric = float(value)
    return str(int(numeric)) if numeric.is_integer() else f"{numeric:.8g}"


class WorkbenchWindow(QMainWindow):
    def __init__(self, catalog: NpcDogmaCatalog) -> None:
        super().__init__()
        self.catalog = catalog
        self.project = NpcDogmaProject(
            name="NPC Dogma changes",
            build=catalog.profile.build if catalog.profile else 0,
            profile_id=catalog.profile.profile_id if catalog.profile else "export-only",
            type_dogma_base_sha256=(
                sha256_file(catalog.profile.table("typeDogma").resource_path)
                if catalog.profile
                else ""
            ),
        )
        self.visible_targets = []
        self.attribute_rows: list[int] = []
        self.effect_actions: dict[int, QComboBox] = {}
        self.setWindowTitle("Elysian NPC Dogma Workbench")
        self.resize(1500, 900)
        self._build_ui()
        self._refresh_targets()

    def _build_ui(self) -> None:
        file_menu = self.menuBar().addMenu("Project")
        for label, callback in (
            ("Open…", self._open_project),
            ("Save…", self._save_project),
            ("Export verified candidate…", self._export_candidate),
            ("Apply verified project…", self._apply),
            ("Rollback active NPC Dogma bundle…", self._rollback),
        ):
            action = QAction(label, self)
            action.triggered.connect(callback)
            file_menu.addAction(action)

        root = QWidget()
        layout = QVBoxLayout(root)
        summary = self.catalog.summary()
        self.summary = QLabel(
            f"Build {summary['build']} · {summary['entityTypes']} category 11 entities "
            f"({summary['publishedEntityTypes']} published / {summary['hiddenEntityTypes']} hidden) · "
            f"{summary['configuredTypes']} configured hulls · {summary['playerShipSources']} player sources"
        )
        layout.addWidget(self.summary)

        splitter = QSplitter(Qt.Orientation.Horizontal)
        splitter.addWidget(self._target_panel())
        splitter.addWidget(self._editor_panel())
        splitter.setSizes([560, 940])
        layout.addWidget(splitter, 1)

        footer = QHBoxLayout()
        add_button = QPushButton("Add/update target in project")
        add_button.clicked.connect(self._capture_current_edit)
        validate_button = QPushButton("Validate and show diff")
        validate_button.clicked.connect(self._show_validation)
        footer.addWidget(add_button)
        footer.addWidget(validate_button)
        footer.addStretch(1)
        self.project_label = QLabel("0 target edits")
        footer.addWidget(self.project_label)
        layout.addLayout(footer)
        self.setCentralWidget(root)
        self.statusBar().showMessage("Select an NPC target and a player ship source.")

    def _target_panel(self) -> QWidget:
        panel = QWidget()
        layout = QVBoxLayout(panel)
        filters = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search name, group, or type ID")
        self.search.textChanged.connect(self._refresh_targets)
        self.publication = QComboBox()
        self.publication.addItems(["Published and hidden", "Published", "Hidden"])
        self.publication.currentIndexChanged.connect(self._refresh_targets)
        self.configured_only = QCheckBox("Configured only")
        self.configured_only.stateChanged.connect(self._refresh_targets)
        self.all_entities = QCheckBox("All entities")
        self.all_entities.stateChanged.connect(self._refresh_targets)
        filters.addWidget(self.search, 1)
        filters.addWidget(self.publication)
        layout.addLayout(filters)
        flags = QHBoxLayout()
        flags.addWidget(self.configured_only)
        flags.addWidget(self.all_entities)
        flags.addStretch(1)
        layout.addLayout(flags)

        self.targets = QTableWidget(0, 5)
        self.targets.setHorizontalHeaderLabels(
            ["Type ID", "Name", "Group", "State", "Use"]
        )
        self.targets.setSelectionBehavior(QAbstractItemView.SelectionBehavior.SelectRows)
        self.targets.setSelectionMode(QAbstractItemView.SelectionMode.SingleSelection)
        self.targets.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.targets.verticalHeader().setVisible(False)
        self.targets.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.targets.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.targets.itemSelectionChanged.connect(self._target_changed)
        layout.addWidget(self.targets, 1)
        return panel

    def _editor_panel(self) -> QWidget:
        panel = QWidget()
        layout = QVBoxLayout(panel)
        source_row = QHBoxLayout()
        source_row.addWidget(QLabel("Player ship source:"))
        self.source = QComboBox()
        self.source.setEditable(True)
        self.source.setInsertPolicy(QComboBox.InsertPolicy.NoInsert)
        self.source.currentIndexChanged.connect(self._populate_editor)
        source_row.addWidget(self.source, 1)
        self.preset = QComboBox()
        self.preset.addItems(["Choose preset…", *ATTRIBUTE_PRESETS])
        self.preset.currentTextChanged.connect(self._select_preset)
        source_row.addWidget(self.preset)
        layout.addLayout(source_row)

        self.tabs = QTabWidget()
        self.attribute_table = QTableWidget(0, 5)
        self.attribute_table.setHorizontalHeaderLabels(
            ["Change", "Attribute", "Target", "Source", "Result"]
        )
        self.attribute_table.verticalHeader().setVisible(False)
        self.attribute_table.horizontalHeader().setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        self.attribute_table.horizontalHeader().setSectionResizeMode(4, QHeaderView.ResizeMode.Stretch)
        self.tabs.addTab(self.attribute_table, "Dogma attributes")

        self.effect_table = QTableWidget(0, 6)
        self.effect_table.setHorizontalHeaderLabels(
            ["Action", "Effect ID", "Effect", "Target default", "Source default", "Definition"]
        )
        self.effect_table.verticalHeader().setVisible(False)
        self.effect_table.horizontalHeader().setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        self.effect_table.horizontalHeader().setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        self.effect_table.setEditTriggers(QAbstractItemView.EditTrigger.NoEditTriggers)
        self.tabs.addTab(self.effect_table, "Dogma effects")

        self.details = QPlainTextEdit()
        self.details.setReadOnly(True)
        self.tabs.addTab(self.details, "Validation / diff")
        layout.addWidget(self.tabs, 1)
        return panel

    def _refresh_targets(self) -> None:
        query = self.search.text().casefold().strip()
        publication = self.publication.currentText()
        rows = []
        for item in self.catalog.npcs:
            if publication == "Published" and not item.published:
                continue
            if publication == "Hidden" and item.published:
                continue
            if self.configured_only.isChecked() and not item.configured:
                continue
            if not self.all_entities.isChecked() and item.classification not in {
                "npc_ship", "player_hull_used_by_npc"
            }:
                continue
            if query and query not in f"{item.type_id} {item.name} {item.group_name}".casefold():
                continue
            rows.append(item)
        self.visible_targets = rows
        self.targets.setRowCount(len(rows))
        for row, item in enumerate(rows):
            values = (
                str(item.type_id),
                item.name,
                item.group_name,
                "published" if item.published else "hidden",
                "spawnable" if item.spawnable else ("configured" if item.configured else "unused"),
            )
            for column, value in enumerate(values):
                cell = QTableWidgetItem(value)
                if column == 0:
                    cell.setData(Qt.ItemDataRole.UserRole, item.type_id)
                self.targets.setItem(row, column, cell)
        if rows:
            self.targets.selectRow(0)

    def _target(self):
        rows = self.targets.selectionModel().selectedRows()
        if not rows:
            return None
        return self.visible_targets[rows[0].row()]

    def _source_type(self):
        value = self.source.currentData()
        return self.catalog.by_type_id.get(int(value)) if value is not None else None

    def _target_changed(self) -> None:
        target = self._target()
        if target is None:
            return
        suggestions = find_source_suggestions(target, self.catalog.player_ships)
        suggested_ids = {item.type_id for item in suggestions}
        ordered = [*suggestions, *(item for item in self.catalog.player_ships if item.type_id not in suggested_ids)]
        previous = self.source.currentData()
        self.source.blockSignals(True)
        self.source.clear()
        for source in ordered:
            status = "published" if source.published else "hidden"
            self.source.addItem(f"{source.name} ({source.type_id}) [{status}]", source.type_id)
        if previous is not None:
            index = self.source.findData(previous)
            if index >= 0:
                self.source.setCurrentIndex(index)
        self.source.blockSignals(False)
        self._populate_editor()

    def _populate_editor(self) -> None:
        target = self._target()
        source = self._source_type()
        if target is None or source is None:
            return
        target_values = self.catalog.attribute_values(target.type_id)
        source_values = self.catalog.attribute_values(source.type_id)
        preset_names = {name for names in ATTRIBUTE_PRESETS.values() for name in names}
        definitions = [
            definition
            for definition in self.catalog.attributes.values()
            if definition.name in preset_names
            or definition.attribute_id in target_values
            or definition.attribute_id in source_values
        ]
        definitions.sort(key=lambda item: (item.name.casefold(), item.attribute_id))
        self.attribute_rows = [item.attribute_id for item in definitions]
        self.attribute_table.setRowCount(len(definitions))
        for row, definition in enumerate(definitions):
            change = QTableWidgetItem()
            change.setFlags(
                (change.flags() | Qt.ItemFlag.ItemIsUserCheckable)
                & ~Qt.ItemFlag.ItemIsEditable
            )
            change.setCheckState(Qt.CheckState.Unchecked)
            change.setData(Qt.ItemDataRole.UserRole, definition.attribute_id)
            self.attribute_table.setItem(row, 0, change)
            for column, text in (
                (1, f"{definition.name} ({definition.attribute_id})"),
                (2, _number(target_values.get(definition.attribute_id))),
                (3, _number(source_values.get(definition.attribute_id))),
            ):
                item = QTableWidgetItem(text)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.attribute_table.setItem(row, column, item)
            result = QTableWidgetItem(_number(source_values.get(definition.attribute_id)))
            result.setToolTip(definition.description)
            self.attribute_table.setItem(row, 4, result)

        target_effects = self.catalog.effect_values(target.type_id)
        source_effects = self.catalog.effect_values(source.type_id)
        effect_ids = sorted(set(target_effects) | set(source_effects))
        self.effect_actions = {}
        self.effect_table.setRowCount(len(effect_ids))
        for row, effect_id in enumerate(effect_ids):
            definition = self.catalog.effects.get(effect_id)
            action = QComboBox()
            action.addItem("Keep", "keep")
            if effect_id in source_effects:
                action.addItem("Add / use source default", "source")
            if effect_id in target_effects:
                action.addItem("Remove", "remove")
            self.effect_actions[effect_id] = action
            self.effect_table.setCellWidget(row, 0, action)
            self.effect_table.setItem(row, 1, QTableWidgetItem(str(effect_id)))
            self.effect_table.setItem(
                row, 2, QTableWidgetItem(definition.name if definition else f"effect_{effect_id}")
            )
            self.effect_table.setItem(row, 3, QTableWidgetItem(_number(target_effects.get(effect_id))))
            self.effect_table.setItem(row, 4, QTableWidgetItem(_number(source_effects.get(effect_id))))
            details = "unknown definition"
            if definition:
                flags = []
                if definition.is_offensive:
                    flags.append("offensive")
                if definition.is_assistance:
                    flags.append("assistance")
                if definition.is_warp_safe:
                    flags.append("warp-safe")
                details = f"category {definition.effect_category}; refs {list(definition.references)}"
                if flags:
                    details += "; " + ", ".join(flags)
            self.effect_table.setItem(row, 5, QTableWidgetItem(details))
        self.statusBar().showMessage(
            f"Editing {target.name} ({target.type_id}) from {source.name} ({source.type_id})"
        )

    def _select_preset(self, name: str) -> None:
        wanted = set(ATTRIBUTE_PRESETS.get(name, ()))
        if not wanted:
            return
        for row, attribute_id in enumerate(self.attribute_rows):
            definition = self.catalog.attributes[attribute_id]
            source_value = self.attribute_table.item(row, 3).text()
            checked = definition.name in wanted and source_value != "—"
            self.attribute_table.item(row, 0).setCheckState(
                Qt.CheckState.Checked if checked else Qt.CheckState.Unchecked
            )

    def _capture_current_edit(self) -> None:
        target = self._target()
        source = self._source_type()
        if target is None or source is None:
            return
        target_values = self.catalog.attribute_values(target.type_id)
        attributes = []
        for row, attribute_id in enumerate(self.attribute_rows):
            if self.attribute_table.item(row, 0).checkState() != Qt.CheckState.Checked:
                continue
            definition = self.catalog.attributes[attribute_id]
            text = self.attribute_table.item(row, 4).text().strip()
            if not text or text == "—":
                QMessageBox.warning(self, "Missing value", f"{definition.name} has no result value.")
                return
            try:
                value = float(text)
            except ValueError:
                QMessageBox.warning(self, "Invalid value", f"{definition.name} must be numeric.")
                return
            attributes.append(
                AttributeOperation(
                    attribute_id=attribute_id,
                    name=definition.name,
                    action="set",
                    before_value=target_values.get(attribute_id),
                    value=value,
                    source_type_id=source.type_id,
                )
            )
        target_effects = self.catalog.effect_values(target.type_id)
        source_effects = self.catalog.effect_values(source.type_id)
        effects = []
        for effect_id, control in self.effect_actions.items():
            action = control.currentData()
            definition = self.catalog.effects.get(effect_id)
            name = definition.name if definition else f"effect_{effect_id}"
            if action == "source":
                effects.append(
                    EffectOperation(
                        effect_id=effect_id,
                        name=name,
                        action="set_default" if effect_id in target_effects else "add",
                        before_is_default=target_effects.get(effect_id),
                        is_default=source_effects[effect_id],
                        source_type_id=source.type_id,
                    )
                )
            elif action == "remove":
                effects.append(
                    EffectOperation(
                        effect_id=effect_id,
                        name=name,
                        action="remove",
                        before_is_default=target_effects.get(effect_id),
                    )
                )
        edit = TargetEdit(
            target_type_id=target.type_id,
            target_name=target.name,
            source_type_id=source.type_id,
            published=target.published,
            classification=target.classification,
            attributes=attributes,
            effects=effects,
        )
        self.project.edits = [
            item for item in self.project.edits if item.target_type_id != target.type_id
        ]
        self.project.edits.append(edit)
        self.project.edits.sort(key=lambda item: item.target_type_id)
        self.project_label.setText(f"{len(self.project.edits)} target edits")
        self._show_validation()

    def _show_validation(self) -> None:
        current_sha = (
            sha256_file(self.catalog.profile.table("typeDogma").resource_path)
            if self.catalog.profile
            else None
        )
        report = validate_project(
            self.catalog, self.project, current_source_sha256=current_sha
        )
        self.details.setPlainText(
            format_report(report) + "\n" + semantic_diff(self.catalog, self.project)
        )
        self.tabs.setCurrentWidget(self.details)
        self.statusBar().showMessage(
            "Validation passed" if report.valid else f"Validation failed: {len(report.errors)} error(s)"
        )

    def _save_project(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self,
            "Save NPC Dogma project",
            str(PROJECTS_ROOT / "npc-dogma.elysiannpcdogma"),
            "NPC Dogma projects (*.elysiannpcdogma)",
        )
        if path:
            saved = save_project(self.project, Path(path))
            self.statusBar().showMessage(f"Saved {saved}")

    def _open_project(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self,
            "Open NPC Dogma project",
            str(PROJECTS_ROOT),
            "NPC Dogma projects (*.elysiannpcdogma)",
        )
        if not path:
            return
        try:
            self.project = load_project(Path(path))
            self.project_label.setText(f"{len(self.project.edits)} target edits")
            self._show_validation()
        except Exception as exc:
            QMessageBox.critical(self, "Could not open project", str(exc))

    def _export_candidate(self) -> None:
        destination = QFileDialog.getExistingDirectory(
            self, "Export verified candidate", str(RUNTIME_ROOT)
        )
        if not destination:
            return
        try:
            candidate = compile_project(self.catalog, self.project)
            root = Path(destination)
            (root / "typeDogma.fsdbinary").write_bytes(candidate.compiled.payload)
            (root / "typeDogma.data.json").write_text(
                json.dumps(candidate.server_projection, indent=2, ensure_ascii=False) + "\n",
                "utf-8",
            )
            (root / "npc-dogma-diff.txt").write_text(
                semantic_diff(self.catalog, self.project), "utf-8"
            )
            QMessageBox.information(self, "Candidate verified", f"Exported to {root}")
        except Exception as exc:
            QMessageBox.critical(self, "Compile failed", str(exc))

    def _apply(self) -> None:
        answer = QMessageBox.question(
            self,
            "Apply NPC Dogma project",
            "Compile and native-verify the project, then update the client and EveJS static Dogma in one transaction?\n\n"
            "The EVE client and EveJS server must be closed.",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        try:
            candidate = compile_project(self.catalog, self.project)
            staging = Path(tempfile.mkdtemp(prefix="elysian-npc-dogma-", dir=RUNTIME_ROOT / "staging"))
            bundle = prepare_bundle(self.catalog, self.project, candidate, staging / "bundle")
            state = apply_bundle(bundle, server_root=self.catalog.server_root)
            QMessageBox.information(
                self,
                "NPC Dogma installed",
                f"Installation state: {state}\n\nRestart the client and EveJS server before testing.",
            )
        except Exception as exc:
            QMessageBox.critical(self, "Apply failed", str(exc))

    def _rollback(self) -> None:
        answer = QMessageBox.question(
            self,
            "Rollback NPC Dogma",
            "Restore the exact client and server files captured before the active NPC Dogma apply?",
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        try:
            rollback(server_root=self.catalog.server_root)
            QMessageBox.information(self, "Rollback complete", "The NPC Dogma bundle was rolled back.")
        except Exception as exc:
            QMessageBox.critical(self, "Rollback failed", str(exc))


def run() -> int:
    app = QApplication.instance() or QApplication(sys.argv)
    app.setApplicationName("Elysian NPC Dogma Workbench")
    try:
        catalog = NpcDogmaCatalog.load(default_client_root(), default_server_root())
    except Exception as exc:
        QMessageBox.critical(None, "NPC Dogma startup failed", str(exc))
        return 1
    window = WorkbenchWindow(catalog)
    window.show()
    return app.exec()
