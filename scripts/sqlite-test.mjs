import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import esbuild from "esbuild";
import initSqlJs from "sql.js";

const fixtureDir = path.resolve("test-fixtures");
fs.mkdirSync(fixtureDir, { recursive: true });

await createFixtures();

await esbuild.build({
  bundle: true,
  entryPoints: ["src/sqlite.ts"],
  format: "esm",
  loader: { ".wasm": "binary" },
  outfile: ".tmp-sqlite-test.mjs",
  platform: "browser",
  target: "es2022",
});

const {
  SQL_EXTENSIONS,
  getSqliteSidecarInfo,
  inspectSqliteDatabase,
  previewSqliteObject,
  runReadOnlyQuery,
  validateReadOnlyQuery,
} = await import(new URL("../.tmp-sqlite-test.mjs", import.meta.url));

const simple = readFixture("simple.sqlite");
const inspection = await inspectSqliteDatabase(simple);
assert.equal(inspection.objects.some((object) => object.name === "people" && object.type === "table"), true);
assert.equal(inspection.metadata.pageSize, 4096);

const preview = await previewSqliteObject(simple, "people");
assert.deepEqual(preview.result.columns, ["id", "name", "role"]);
assert.equal(preview.result.rows[0][1], "Ada");
assert.equal(preview.columns.some((column) => column.primaryKey), true);

const multi = await inspectSqliteDatabase(readFixture("multiple.sqlite3"));
assert.equal(multi.objects.some((object) => object.name === "active_people" && object.type === "view"), true);
assert.equal(multi.objects.some((object) => object.name === "idx_people_role" && object.type === "index"), true);

const largePreview = await previewSqliteObject(readFixture("large.db"), "events");
assert.equal(largePreview.result.renderedRowCount, 100);
assert.equal(largePreview.result.truncated, true);

const selectResult = await runReadOnlyQuery(simple, "SELECT * FROM people LIMIT 20");
assert.equal(selectResult.renderedRowCount, 2);

const withResult = await runReadOnlyQuery(simple, "WITH named AS (SELECT name FROM people) SELECT * FROM named");
assert.deepEqual(withResult.columns, ["name"]);

for (const sql of [
  "INSERT INTO people (name) VALUES ('x')",
  "UPDATE people SET name = 'x'",
  "DELETE FROM people",
  "DROP TABLE people",
  "ALTER TABLE people ADD COLUMN x TEXT",
  "CREATE TABLE x (id INTEGER)",
  "VACUUM",
  "ATTACH DATABASE 'x.db' AS x",
  "PRAGMA journal_mode = WAL",
]) {
  assert.equal(validateReadOnlyQuery(sql).ok, false, `${sql} should be blocked`);
  await assert.rejects(() => runReadOnlyQuery(simple, sql));
}

await assert.rejects(() => inspectSqliteDatabase(readFixture("malformed.db")));

assert.deepEqual(
  ["sqlite-wal", "sqlite-shm", "db-wal", "db-shm"].filter((extension) => SQL_EXTENSIONS.includes(extension)),
  ["sqlite-wal", "sqlite-shm", "db-wal", "db-shm"],
);

for (const [sidecarPath, databasePath, kind] of [
  [".brain-vault-index.sqlite-wal", ".brain-vault-index.sqlite", "write-ahead log"],
  [".brain-vault-index.sqlite-shm", ".brain-vault-index.sqlite", "shared-memory index"],
  [".life_os.db-wal", ".life_os.db", "write-ahead log"],
  [".life_os.db-shm", ".life_os.db", "shared-memory index"],
]) {
  const info = getSqliteSidecarInfo(sidecarPath);
  assert.equal(info?.databasePath, databasePath);
  assert.equal(info?.kind, kind);
}

assert.equal(getSqliteSidecarInfo("notes.sqlite"), null);

fs.rmSync(new URL("../.tmp-sqlite-test.mjs", import.meta.url));
console.log("SQL Viewer SQLite fixture tests passed.");

async function createFixtures() {
  const SQL = await initSqlJs();

  const simpleDb = new SQL.Database();
  simpleDb.run(`
    PRAGMA page_size = 4096;
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT);
    INSERT INTO people (name, role) VALUES ('Ada', 'admin'), ('Linus', 'reader');
  `);
  saveFixture("simple.sqlite", simpleDb);

  const multiDb = new SQL.Database();
  multiDb.run(`
    CREATE TABLE people (id INTEGER PRIMARY KEY, name TEXT NOT NULL, role TEXT, active INTEGER NOT NULL);
    CREATE TABLE notes (id INTEGER PRIMARY KEY, person_id INTEGER, body TEXT);
    CREATE INDEX idx_people_role ON people(role);
    CREATE VIEW active_people AS SELECT id, name, role FROM people WHERE active = 1;
    INSERT INTO people (name, role, active) VALUES ('Grace', 'admin', 1), ('Ken', 'reader', 0);
    INSERT INTO notes (person_id, body) VALUES (1, 'compiler'), (2, 'unix');
  `);
  saveFixture("multiple.sqlite3", multiDb);

  const largeDb = new SQL.Database();
  largeDb.run("CREATE TABLE events (id INTEGER PRIMARY KEY, label TEXT);");
  const statement = largeDb.prepare("INSERT INTO events (label) VALUES (?);");
  for (let index = 1; index <= 250; index += 1) {
    statement.run([`event-${index}`]);
  }
  statement.free();
  saveFixture("large.db", largeDb);

  fs.writeFileSync(path.join(fixtureDir, "malformed.db"), Buffer.from("not a sqlite database"));
  fs.writeFileSync(path.join(fixtureDir, "sidecar.sqlite-wal"), Buffer.from("sqlite wal sidecar fixture"));
  fs.writeFileSync(path.join(fixtureDir, "sidecar.sqlite-shm"), Buffer.from("sqlite shm sidecar fixture"));
  fs.writeFileSync(path.join(fixtureDir, "sidecar.db-wal"), Buffer.from("db wal sidecar fixture"));
  fs.writeFileSync(path.join(fixtureDir, "sidecar.db-shm"), Buffer.from("db shm sidecar fixture"));
}

function saveFixture(name, db) {
  fs.writeFileSync(path.join(fixtureDir, name), Buffer.from(db.export()));
  db.close();
}

function readFixture(name) {
  const buffer = fs.readFileSync(path.join(fixtureDir, name));
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}
