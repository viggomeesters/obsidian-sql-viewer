import {
  FileView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";
import {
  type QueryResult,
  type SqliteInspection,
  type SqliteSidecarInfo,
  type SqliteObjectSummary,
  type SqliteTablePreview,
  QUERY_ROW_LIMIT,
  SQL_EXTENSIONS,
  getSqliteSidecarInfo,
  inspectSqliteDatabase,
  previewSqliteObject,
  runReadOnlyQuery,
  validateReadOnlyQuery,
} from "./sqlite";

const VIEW_TYPE_SQL_VIEWER = "sql-viewer";

export default class SqlViewerPlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(
      VIEW_TYPE_SQL_VIEWER,
      (leaf) => new SqlViewerView(leaf),
    );
    this.registerExtensions(SQL_EXTENSIONS, VIEW_TYPE_SQL_VIEWER);

    this.addCommand({
      id: "open-current-sqlite-in-viewer",
      name: "Open current SQLite file in viewer",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!isSqliteFile(file)) return false;

        if (!checking) {
          void this.openSqliteFile(file);
        }
        return true;
      },
    });
  }

  async openSqliteFile(file: TFile): Promise<void> {
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_SQL_VIEWER,
      state: { file: file.path },
      active: true,
    });
  }
}

class SqlViewerView extends FileView {
  private fileData: ArrayBuffer | null = null;
  private inspection: SqliteInspection | null = null;
  private activeObject = "";
  private preview: SqliteTablePreview | null = null;
  private filterValue = "";
  private queryText = "";
  private queryResult: QueryResult | null = null;
  private queryMessage = "";
  private errorMessage = "";
  private sidecarInfo: SqliteSidecarInfo | null = null;
  private sidecarDatabase: TFile | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_SQL_VIEWER;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "SQL viewer";
  }

  getIcon(): string {
    return "database";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await this.loadDatabase(file);
  }

  async onUnloadFile(): Promise<void> {
    this.fileData = null;
    this.inspection = null;
    this.activeObject = "";
    this.preview = null;
    this.queryText = "";
    this.queryResult = null;
    this.queryMessage = "";
    this.errorMessage = "";
    this.sidecarInfo = null;
    this.sidecarDatabase = null;
    this.contentEl.empty();
  }

  private async loadDatabase(file: TFile): Promise<void> {
    const sidecarInfo = getSqliteSidecarInfo(file.path);
    if (sidecarInfo) {
      this.fileData = null;
      this.inspection = null;
      this.activeObject = "";
      this.preview = null;
      this.queryText = "";
      this.queryResult = null;
      this.queryMessage = "";
      this.errorMessage = "";
      this.sidecarInfo = sidecarInfo;
      const databaseFile = this.app.vault.getAbstractFileByPath(sidecarInfo.databasePath);
      this.sidecarDatabase = databaseFile instanceof TFile ? databaseFile : null;
      this.render();
      return;
    }

    try {
      this.fileData = await this.app.vault.readBinary(file);
      this.inspection = await inspectSqliteDatabase(this.fileData);
      this.activeObject = this.inspection.defaultObject;
      this.queryText = this.activeObject ? `SELECT * FROM "${this.activeObject}" LIMIT 20` : "SELECT name, type FROM sqlite_master LIMIT 20";
      this.queryResult = null;
      this.queryMessage = "";
      this.errorMessage = "";
      this.sidecarInfo = null;
      this.sidecarDatabase = null;
      await this.loadPreview();
    } catch (error) {
      this.fileData = null;
      this.inspection = null;
      this.activeObject = "";
      this.preview = null;
      this.errorMessage = `Unable to read SQLite database: ${getErrorMessage(error)}`;
      this.sidecarInfo = null;
      this.sidecarDatabase = null;
    }
    this.render();
  }

  private async loadPreview(): Promise<void> {
    if (!this.fileData || !this.activeObject) {
      this.preview = null;
      return;
    }

    try {
      this.preview = await previewSqliteObject(this.fileData, this.activeObject);
    } catch (error) {
      this.preview = null;
      this.queryMessage = `Preview failed: ${getErrorMessage(error)}`;
    }
  }

  private render(): void {
    const container = this.contentEl;
    container.empty();
    container.addClass("sql-viewer");

    const header = container.createDiv({ cls: "sql-viewer__header" });
    this.renderTitle(header);
    this.renderToolbar(header);

    if (!this.file) {
      renderMessage(container, "No SQLite file is attached to this viewer.");
      return;
    }

    if (!isSqliteFile(this.file)) {
      renderMessage(container, "This viewer supports .sqlite, .sqlite3, .db, and SQLite sidecar files.");
      return;
    }

    if (this.sidecarInfo) {
      this.renderSidecarInfo(container);
      return;
    }

    if (this.errorMessage) {
      renderMessage(container, this.errorMessage);
      return;
    }

    if (!this.inspection) {
      renderMessage(container, "Database is not loaded.");
      return;
    }

    renderWarnings(container, this.inspection.warnings);
    renderMetadata(container, this.inspection);

    const body = container.createDiv({ cls: "sql-viewer__body" });
    this.renderObjectList(body);
    const main = body.createDiv({ cls: "sql-viewer__main" });
    this.renderActiveObject(main);
    this.renderQueryRunner(main);
  }

  private renderTitle(parent: HTMLElement): void {
    const title = parent.createDiv({ cls: "sql-viewer__title" });
    title.createDiv({
      cls: "sql-viewer__filename",
      text: this.file?.name ?? "SQLite file",
    });
    title.createDiv({
      cls: "sql-viewer__path",
      text: this.file?.path ?? "",
    });
  }

  private renderToolbar(parent: HTMLElement): void {
    const toolbar = parent.createDiv({ cls: "sql-viewer__toolbar" });

    if (!this.sidecarInfo) {
      const searchWrap = toolbar.createDiv({ cls: "sql-viewer__search" });
      setIcon(searchWrap.createSpan({ cls: "sql-viewer__search-icon" }), "search");
      const searchInput = searchWrap.createEl("input", {
        attr: {
          "aria-label": "Filter objects and rows",
          placeholder: "Filter",
          spellcheck: "false",
          type: "search",
          value: this.filterValue,
        },
      });
      searchInput.addEventListener("input", () => {
        this.filterValue = searchInput.value;
        this.render();
      });
    }

    const refreshButton = createIconButton(toolbar, "refresh-cw", "Refresh database");
    refreshButton.addEventListener("click", () => {
      void this.reloadFile();
    });
  }

  private renderSidecarInfo(parent: HTMLElement): void {
    if (!this.file || !this.sidecarInfo) return;

    const panel = parent.createDiv({ cls: "sql-viewer__sidecar" });
    const header = panel.createDiv({ cls: "sql-viewer__section-header" });
    header.createDiv({ cls: "sql-viewer__section-title", text: "SQLite sidecar file" });
    header.createDiv({
      cls: "sql-viewer__section-subtitle",
      text: this.sidecarInfo.kind,
    });

    const summary = panel.createDiv({ cls: "sql-viewer__summary" });
    summary.createSpan({ cls: "sql-viewer__pill", text: this.sidecarInfo.extension });
    summary.createSpan({ cls: "sql-viewer__pill", text: this.sidecarInfo.kind });
    summary.createSpan({
      cls: "sql-viewer__pill",
      text: this.sidecarDatabase ? "base database found" : "base database not found",
    });

    panel.createEl("p", {
      text: "This is a SQLite runtime sidecar, not a standalone database. SQL Viewer does not parse WAL or SHM files as databases and never writes checkpoint, repair, or maintenance changes.",
    });
    panel.createEl("p", {
      text: `Expected base database: ${this.sidecarInfo.databasePath}`,
    });

    if (this.sidecarDatabase) {
      const openButton = createTextButton(panel, "Open base database");
      openButton.addEventListener("click", () => {
        void this.openBaseDatabase();
      });
    }
  }

  private renderObjectList(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "sql-viewer__objects" });
    panel.createDiv({ cls: "sql-viewer__panel-title", text: "Objects" });

    const objects = filterObjects(this.inspection?.objects ?? [], this.filterValue);
    if (objects.length === 0) {
      panel.createDiv({ cls: "sql-viewer__empty", text: "No objects match the filter." });
      return;
    }

    objects.forEach((object) => {
      const button = panel.createEl("button", {
        cls: "sql-viewer__object",
        attr: { type: "button", title: object.sql || object.name },
      });
      button.toggleClass("is-active", object.name === this.activeObject);
      button.createSpan({ cls: `sql-viewer__object-type is-${object.type}`, text: object.type });
      const label = button.createSpan({ cls: "sql-viewer__object-label" });
      label.createSpan({ cls: "sql-viewer__object-name", text: object.name });
      label.createSpan({
        cls: "sql-viewer__object-meta",
        text: object.rowCount === null ? object.tableName : `${object.rowCount} rows`,
      });
      button.addEventListener("click", () => {
        void this.selectObject(object.name);
      });
    });
  }

  private renderActiveObject(parent: HTMLElement): void {
    if (!this.activeObject || !this.preview) {
      renderMessage(parent, "Select a table or view to inspect.");
      return;
    }

    const header = parent.createDiv({ cls: "sql-viewer__section-header" });
    header.createDiv({ cls: "sql-viewer__section-title", text: this.preview.name });
    header.createDiv({
      cls: "sql-viewer__section-subtitle",
      text: `${this.preview.type} preview capped at ${this.preview.result.renderedRowCount}${this.preview.result.truncated ? "+" : ""} rows`,
    });

    renderSchema(parent, this.preview);
    renderSource(parent, this.inspection?.objects.find((object) => object.name === this.preview?.name));
    renderResultTable(parent, this.preview.result, this.filterValue, "Row preview");
  }

  private renderQueryRunner(parent: HTMLElement): void {
    const panel = parent.createDiv({ cls: "sql-viewer__query" });
    const header = panel.createDiv({ cls: "sql-viewer__section-header" });
    header.createDiv({ cls: "sql-viewer__section-title", text: "Read-only query" });
    header.createDiv({
      cls: "sql-viewer__section-subtitle",
      text: `SELECT/WITH only, ${QUERY_ROW_LIMIT} row cap`,
    });

    const textarea = panel.createEl("textarea", {
      cls: "sql-viewer__query-input",
      attr: {
        "aria-label": "Read-only SQL query",
        spellcheck: "false",
      },
      text: this.queryText,
    });
    textarea.addEventListener("input", () => {
      this.queryText = textarea.value;
      this.queryMessage = "";
    });

    const actions = panel.createDiv({ cls: "sql-viewer__query-actions" });
    const runButton = createTextButton(actions, "Run query");
    runButton.addEventListener("click", () => {
      this.queryText = textarea.value;
      void this.runQuery();
    });

    const validation = validateReadOnlyQuery(this.queryText);
    const status = actions.createSpan({
      cls: validation.ok ? "sql-viewer__query-status is-ok" : "sql-viewer__query-status is-blocked",
      text: validation.ok ? "Allowed" : validation.message ?? "Blocked",
    });
    status.setAttribute("aria-live", "polite");

    if (this.queryMessage) {
      panel.createDiv({ cls: "sql-viewer__query-message", text: this.queryMessage });
    }
    if (this.queryResult) {
      renderResultTable(panel, this.queryResult, "", "Query result");
    }
  }

  private async selectObject(name: string): Promise<void> {
    this.activeObject = name;
    this.queryText = `SELECT * FROM "${name.replaceAll('"', '""')}" LIMIT 20`;
    this.queryResult = null;
    this.queryMessage = "";
    await this.loadPreview();
    this.render();
  }

  private async runQuery(): Promise<void> {
    if (!this.fileData) {
      this.queryMessage = "No database is loaded.";
      this.render();
      return;
    }

    try {
      this.queryResult = await runReadOnlyQuery(this.fileData, this.queryText);
      this.queryMessage = `Query returned ${this.queryResult.renderedRowCount}${this.queryResult.truncated ? "+" : ""} rows in ${this.queryResult.elapsedMs} ms.`;
    } catch (error) {
      this.queryResult = null;
      this.queryMessage = getErrorMessage(error);
    }
    this.render();
  }

  private async reloadFile(): Promise<void> {
    if (!this.file) {
      new Notice("No SQLite file to refresh");
      return;
    }
    await this.loadDatabase(this.file);
  }

  private async openBaseDatabase(): Promise<void> {
    if (!this.sidecarDatabase) {
      new Notice("Base SQLite database not found");
      return;
    }

    const leaf = this.app.workspace.getLeaf(false);
    await leaf.setViewState({
      type: VIEW_TYPE_SQL_VIEWER,
      state: { file: this.sidecarDatabase.path },
      active: true,
    });
  }
}

function renderWarnings(parent: HTMLElement, warnings: string[]): void {
  if (warnings.length === 0) return;
  const box = parent.createDiv({ cls: "sql-viewer__warnings" });
  box.createDiv({ cls: "sql-viewer__warnings-title", text: "Database warnings" });
  warnings.slice(0, 8).forEach((warning) => {
    box.createDiv({ cls: "sql-viewer__warning", text: warning });
  });
}

function renderMetadata(parent: HTMLElement, inspection: SqliteInspection): void {
  const meta = inspection.metadata;
  const summary = parent.createDiv({ cls: "sql-viewer__summary" });
  summary.createSpan({ cls: "sql-viewer__pill", text: `${countObjects(inspection.objects, "table")} tables` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `${countObjects(inspection.objects, "view")} views` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `${countObjects(inspection.objects, "index")} indexes` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `page size ${formatNullable(meta.pageSize)}` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `pages ${formatNullable(meta.pageCount)}` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `user_version ${formatNullable(meta.userVersion)}` });
  summary.createSpan({ cls: "sql-viewer__pill", text: `application_id ${formatNullable(meta.applicationId)}` });
  summary.createSpan({ cls: "sql-viewer__pill", text: meta.encoding || "encoding unknown" });
}

function renderSchema(parent: HTMLElement, preview: SqliteTablePreview): void {
  const section = parent.createDiv({ cls: "sql-viewer__schema" });
  section.createDiv({ cls: "sql-viewer__panel-title", text: "Schema" });
  if (preview.columns.length === 0) {
    section.createDiv({ cls: "sql-viewer__empty", text: "No column metadata available." });
    return;
  }

  const table = section.createEl("table", { cls: "sql-viewer__table" });
  const head = table.createEl("thead").createEl("tr");
  ["#", "Column", "Type", "Not null", "Default", "PK"].forEach((label) => head.createEl("th", { text: label }));
  const body = table.createEl("tbody");
  preview.columns.forEach((column) => {
    const row = body.createEl("tr");
    row.createEl("td", { text: String(column.cid) });
    row.createEl("td", { text: column.name });
    row.createEl("td", { text: column.type });
    row.createEl("td", { text: column.notNull ? "yes" : "" });
    row.createEl("td", { text: column.defaultValue });
    row.createEl("td", { text: column.primaryKey ? "yes" : "" });
  });
}

function renderSource(parent: HTMLElement, object: SqliteObjectSummary | undefined): void {
  const source = parent.createDiv({ cls: "sql-viewer__source" });
  source.createDiv({ cls: "sql-viewer__panel-title", text: "Source" });
  source.createEl("pre", { text: object?.sql || "No source SQL stored for this object." });
}

function renderResultTable(parent: HTMLElement, result: QueryResult, filterValue: string, title: string): void {
  const section = parent.createDiv({ cls: "sql-viewer__result" });
  const header = section.createDiv({ cls: "sql-viewer__section-header" });
  header.createDiv({ cls: "sql-viewer__section-title", text: title });
  header.createDiv({
    cls: "sql-viewer__section-subtitle",
    text: `${result.renderedRowCount}${result.truncated ? "+" : ""} rows rendered`,
  });

  if (result.columns.length === 0) {
    renderMessage(section, "Query completed without result columns.");
    return;
  }

  const normalized = filterValue.trim().toLowerCase();
  const rows = result.rows.filter((row) => !normalized || row.join(" ").toLowerCase().includes(normalized));

  if (rows.length === 0) {
    renderMessage(section, "No rows match the current filter.");
    return;
  }

  const wrap = section.createDiv({ cls: "sql-viewer__table-wrap" });
  const table = wrap.createEl("table", { cls: "sql-viewer__table" });
  const headRow = table.createEl("thead").createEl("tr");
  result.columns.forEach((column) => headRow.createEl("th", { text: column }));
  const body = table.createEl("tbody");
  rows.forEach((values) => {
    const row = body.createEl("tr");
    values.forEach((value) => row.createEl("td", { text: value }));
  });
}

function filterObjects(objects: SqliteObjectSummary[], query: string): SqliteObjectSummary[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return objects;
  return objects.filter((object) => `${object.type} ${object.name} ${object.tableName}`.toLowerCase().includes(normalized));
}

function countObjects(objects: SqliteObjectSummary[], type: SqliteObjectSummary["type"]): number {
  return objects.filter((object) => object.type === type).length;
}

function createIconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
  const button = parent.createEl("button", {
    cls: "clickable-icon sql-viewer__button",
    attr: { "aria-label": label, title: label, type: "button" },
  });
  setIcon(button, icon);
  return button;
}

function createTextButton(parent: HTMLElement, label: string): HTMLButtonElement {
  return parent.createEl("button", {
    cls: "mod-cta sql-viewer__text-button",
    text: label,
    attr: { type: "button" },
  });
}

function renderMessage(parent: HTMLElement, message: string): void {
  parent.createDiv({ cls: "sql-viewer__message", text: message });
}

function isSqliteFile(file: TFile | null): file is TFile {
  return Boolean(file && SQL_EXTENSIONS.includes(file.extension.toLowerCase()));
}

function formatNullable(value: number | null): string {
  return value === null ? "unknown" : String(value);
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
