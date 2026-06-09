import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import wasmBinary from "sql.js/dist/sql-wasm.wasm";

export const SQL_DATABASE_EXTENSIONS = ["sqlite", "sqlite3", "db"] as const;
export const SQL_SIDECAR_EXTENSIONS = ["sqlite-wal", "sqlite-shm", "db-wal", "db-shm"] as const;
export const SQL_EXTENSIONS: string[] = [...SQL_DATABASE_EXTENSIONS, ...SQL_SIDECAR_EXTENSIONS];
export const PREVIEW_ROW_LIMIT = 100;
export const QUERY_ROW_LIMIT = 200;
export const QUERY_TIMEOUT_MS = 750;
export const MAX_QUERY_LENGTH = 5000;

export type SqliteSidecarExtension = (typeof SQL_SIDECAR_EXTENSIONS)[number];
export type SqliteSidecarKind = "write-ahead log" | "shared-memory index";

export interface SqliteSidecarInfo {
  databasePath: string;
  extension: SqliteSidecarExtension;
  kind: SqliteSidecarKind;
}

export type SqliteObjectType = "table" | "view" | "index";

export interface SqliteObjectSummary {
  name: string;
  type: SqliteObjectType;
  tableName: string;
  sql: string;
  rowCount: number | null;
}

export interface SqliteColumn {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string;
  primaryKey: boolean;
}

export interface SqliteMetadata {
  pageCount: number | null;
  pageSize: number | null;
  userVersion: number | null;
  applicationId: number | null;
  schemaVersion: number | null;
  encoding: string;
}

export interface SqliteTablePreview {
  name: string;
  type: "table" | "view";
  columns: SqliteColumn[];
  result: QueryResult;
}

export interface SqliteInspection {
  metadata: SqliteMetadata;
  objects: SqliteObjectSummary[];
  warnings: string[];
  defaultObject: string;
}

export interface QueryResult {
  columns: string[];
  rows: string[][];
  renderedRowCount: number;
  truncated: boolean;
  elapsedMs: number;
}

export interface QueryValidation {
  ok: boolean;
  message?: string;
}

const SQLITE_SIDECAR_SUFFIXES: Array<{
  databaseSuffix: string;
  extension: SqliteSidecarExtension;
  kind: SqliteSidecarKind;
  suffix: string;
}> = [
  { extension: "sqlite-wal", suffix: ".sqlite-wal", databaseSuffix: ".sqlite", kind: "write-ahead log" },
  { extension: "sqlite-shm", suffix: ".sqlite-shm", databaseSuffix: ".sqlite", kind: "shared-memory index" },
  { extension: "db-wal", suffix: ".db-wal", databaseSuffix: ".db", kind: "write-ahead log" },
  { extension: "db-shm", suffix: ".db-shm", databaseSuffix: ".db", kind: "shared-memory index" },
];

let sqlModulePromise: Promise<SqlJsStatic> | null = null;
const sqlWasmBinary = wasmBinary.buffer.slice(
  wasmBinary.byteOffset,
  wasmBinary.byteOffset + wasmBinary.byteLength,
) as ArrayBuffer;

export async function inspectSqliteDatabase(data: ArrayBuffer): Promise<SqliteInspection> {
  assertSqliteHeader(data);
  return withDatabase(data, (db) => {
    const metadata = readMetadata(db);
    const objects = readObjects(db);
    const warnings: string[] = [];
    const defaultObject = objects.find((object) => object.type === "table" || object.type === "view")?.name ?? "";

    if (objects.length === 0) warnings.push("No tables, views, or indexes found.");

    return { metadata, objects, warnings, defaultObject };
  });
}

export async function previewSqliteObject(data: ArrayBuffer, name: string): Promise<SqliteTablePreview> {
  assertSqliteHeader(data);
  return withDatabase(data, (db) => {
    const object = readObjects(db).find((item) => item.name === name && (item.type === "table" || item.type === "view"));
    if (!object) throw new Error(`Table or view not found: ${name}`);

    const columns = readColumns(db, name);
    const result = runSafeSelect(db, `SELECT * FROM ${quoteIdentifier(name)}`, PREVIEW_ROW_LIMIT);
    return { name, type: object.type as "table" | "view", columns, result };
  });
}

export async function runReadOnlyQuery(data: ArrayBuffer, sql: string): Promise<QueryResult> {
  assertSqliteHeader(data);
  const validation = validateReadOnlyQuery(sql);
  if (!validation.ok) throw new Error(validation.message ?? "Query is not allowed.");
  return withDatabase(data, (db) => runSafeSelect(db, sql, QUERY_ROW_LIMIT));
}

export function validateReadOnlyQuery(sql: string): QueryValidation {
  const normalized = stripSqlComments(sql).trim();
  if (!normalized) return { ok: false, message: "Enter a SELECT or WITH query." };
  if (normalized.length > MAX_QUERY_LENGTH) return { ok: false, message: "Query is too long for the read-only runner." };
  if (hasMultipleStatements(normalized)) return { ok: false, message: "Only one read-only statement is allowed." };
  if (!/^(select|with)\b/i.test(normalized)) return { ok: false, message: "Only SELECT and WITH queries are allowed." };

  const keywordPattern =
    /\b(insert|update|delete|drop|alter|create|replace|vacuum|attach|detach|reindex|analyze|pragma|begin|commit|rollback|savepoint|release)\b/i;
  const match = normalized.match(keywordPattern);
  if (match) return { ok: false, message: `Blocked keyword: ${match[1].toUpperCase()}` };

  return { ok: true };
}

export function getSqliteSidecarInfo(path: string): SqliteSidecarInfo | null {
  const normalized = path.toLowerCase();
  const match = SQLITE_SIDECAR_SUFFIXES.find((sidecar) => normalized.endsWith(sidecar.suffix));
  if (!match) return null;

  return {
    databasePath: `${path.slice(0, -match.suffix.length)}${match.databaseSuffix}`,
    extension: match.extension,
    kind: match.kind,
  };
}

function runSafeSelect(db: Database, sql: string, rowLimit: number): QueryResult {
  const started = performance.now();
  const limitedSql = ensureLimit(sql, rowLimit + 1);
  const statement = db.prepare(limitedSql);
  const columns = statement.getColumnNames();
  const rows: string[][] = [];
  let seen = 0;

  try {
    while (statement.step()) {
      seen += 1;
      if (performance.now() - started > QUERY_TIMEOUT_MS) {
        throw new Error(`Query stopped after ${QUERY_TIMEOUT_MS} ms.`);
      }
      if (seen <= rowLimit) {
        rows.push(statement.get().map(formatSqlValue));
      }
    }
  } finally {
    statement.free();
  }

  return {
    columns,
    rows,
    renderedRowCount: rows.length,
    truncated: seen > rowLimit,
    elapsedMs: Math.max(0, Math.round(performance.now() - started)),
  };
}

async function withDatabase<T>(data: ArrayBuffer, callback: (db: Database) => T): Promise<T> {
  const SQL = await getSqlModule();
  const db = new SQL.Database(new Uint8Array(data));
  try {
    runSql(db, "PRAGMA query_only = ON;");
    return callback(db);
  } finally {
    db.close();
  }
}

function getSqlModule(): Promise<SqlJsStatic> {
  sqlModulePromise ??= initSqlJs({ wasmBinary: sqlWasmBinary });
  return sqlModulePromise;
}

function assertSqliteHeader(data: ArrayBuffer): void {
  const bytes = new Uint8Array(data, 0, Math.min(data.byteLength, 16));
  const header = new TextDecoder().decode(bytes);
  if (header !== "SQLite format 3\u0000") {
    throw new Error("File is not a valid SQLite database.");
  }
}

function readObjects(db: Database): SqliteObjectSummary[] {
  const result = runSql(db, `
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE type IN ('table', 'view', 'index')
      AND name NOT LIKE 'sqlite_%'
    ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'view' THEN 1 ELSE 2 END, name
  `)[0];

  if (!result) return [];

  return result.values.map((row) => {
    const type = String(row[0]) as SqliteObjectType;
    const name = String(row[1]);
    return {
      type,
      name,
      tableName: String(row[2]),
      sql: row[3] === null ? "" : String(row[3]),
      rowCount: type === "table" || type === "view" ? countRows(db, name) : null,
    };
  });
}

function readColumns(db: Database, name: string): SqliteColumn[] {
  const result = runSql(db, `PRAGMA table_info(${quoteIdentifier(name)})`)[0];
  if (!result) return [];

  return result.values.map((row) => ({
    cid: Number(row[0]),
    name: String(row[1]),
    type: String(row[2] ?? ""),
    notNull: row[3] === 1,
    defaultValue: row[4] === null ? "" : String(row[4]),
    primaryKey: row[5] === 1,
  }));
}

function readMetadata(db: Database): SqliteMetadata {
  return {
    pageCount: readNumericPragma(db, "page_count"),
    pageSize: readNumericPragma(db, "page_size"),
    userVersion: readNumericPragma(db, "user_version"),
    applicationId: readNumericPragma(db, "application_id"),
    schemaVersion: readNumericPragma(db, "schema_version"),
    encoding: String(readSingleValue(db, "PRAGMA encoding") ?? ""),
  };
}

function readNumericPragma(db: Database, name: string): number | null {
  const value = readSingleValue(db, `PRAGMA ${name}`);
  return typeof value === "number" ? value : null;
}

function readSingleValue(db: Database, sql: string): SqlValue | null {
  const result = runSql(db, sql)[0];
  return result?.values[0]?.[0] ?? null;
}

function countRows(db: Database, name: string): number | null {
  try {
    const value = readSingleValue(db, `SELECT COUNT(*) FROM ${quoteIdentifier(name)}`);
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

function runSql(db: Database, sql: string) {
  return db["exec"](sql);
}

function ensureLimit(sql: string, limit: number): string {
  return `SELECT * FROM (${sql.trim().replace(/;+\s*$/, "")}) AS readonly_result LIMIT ${limit}`;
}

function hasMultipleStatements(sql: string): boolean {
  return sql
    .replace(/'([^']|'')*'/g, "")
    .replace(/"([^"]|"")*"/g, "")
    .replace(/`([^`]|``)*`/g, "")
    .replace(/\[([^\]]|\]\])*\]/g, "")
    .replace(/;\s*$/, "")
    .includes(";");
}

function stripSqlComments(sql: string): string {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function formatSqlValue(value: SqlValue): string {
  if (value === null) return "NULL";
  if (value instanceof Uint8Array) return `<BLOB ${value.byteLength} bytes>`;
  return String(value);
}
