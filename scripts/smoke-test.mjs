import fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const main = fs.readFileSync("src/main.ts", "utf8");
const sqlite = fs.readFileSync("src/sqlite.ts", "utf8");
const styles = fs.readFileSync("styles.css", "utf8");
const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
const bundle = fs.readFileSync("main.js", "utf8");

const assertions = [
  [manifest.id === "sql-viewer", "manifest id is sql-viewer"],
  [manifest.name === "SQL Viewer", "manifest name is SQL Viewer"],
  [manifest.version === packageJson.version, "manifest and package versions match"],
  [versions[manifest.version] === manifest.minAppVersion, "versions.json maps manifest version to min app version"],
  [!/obsidian/i.test(manifest.description), "manifest description avoids product name"],
  [/^[a-z-]+$/.test(manifest.id) && !manifest.id.includes("obsidian") && !manifest.id.endsWith("plugin"), "manifest id follows directory rules"],
  [main.includes("registerExtensions(SQL_EXTENSIONS"), "SQLite extensions are registered"],
  [main.includes("getSqliteSidecarInfo(file.path)"), "SQLite sidecars are detected before database parsing"],
  [main.includes("Open base database"), "SQLite sidecar view can open the base database"],
  [main.includes("extends FileView"), "binary FileView is used"],
  [main.includes("this.app.vault.readBinary(file)"), "vault binary reader is used"],
  [sqlite.includes('"sqlite-wal"') && sqlite.includes('"sqlite-shm"') && sqlite.includes('"db-wal"') && sqlite.includes('"db-shm"'), "SQLite sidecar extensions are registered"],
  [sqlite.includes("getSqliteSidecarInfo"), "SQLite sidecar base-path helper exists"],
  [sqlite.includes("sql-wasm.wasm"), "sql.js WASM dependency is bundled"],
  [sqlite.includes("PRAGMA query_only = ON"), "SQLite query_only guard is enabled"],
  [sqlite.includes("Only SELECT and WITH queries are allowed"), "query allowlist message exists"],
  [sqlite.includes("QUERY_ROW_LIMIT = 200"), "query row cap exists"],
  [sqlite.includes("QUERY_TIMEOUT_MS = 750"), "query elapsed-time guard exists"],
  [!main.includes("navigator.clipboard") && !sqlite.includes("navigator.clipboard"), "no clipboard access"],
  [!main.includes("fetch(") && !sqlite.includes("fetch("), "plugin source has no fetch usage"],
  [!main.includes("XMLHttpRequest") && !sqlite.includes("XMLHttpRequest"), "plugin source has no XHR usage"],
  [!main.includes("WebSocket") && !sqlite.includes("WebSocket"), "plugin source has no WebSocket usage"],
  [!main.includes("child_process") && !sqlite.includes("child_process"), "plugin source has no process APIs"],
  [!main.includes("eval(") && !sqlite.includes("eval(") && !main.includes("new Function") && !sqlite.includes("new Function"), "plugin source has no dynamic code execution"],
  [!main.includes("vault.modify") && !main.includes("vault.adapter"), "plugin code does not call vault mutation APIs"],
  [!styles.includes("!important"), "styles do not use important overrides"],
  [bundle.length > 800_000, "bundle includes SQLite WASM payload"],
  [fs.existsSync("README.md") && fs.existsSync("LICENSE") && fs.existsSync("manifest.json"), "root submission files exist"],
  [fs.existsSync("main.js") && fs.existsSync("styles.css"), "release assets exist"],
  [fs.existsSync("test-fixtures/simple.sqlite"), "simple SQLite fixture exists"],
  [fs.existsSync("test-fixtures/multiple.sqlite3"), "multi-object SQLite fixture exists"],
  [fs.existsSync("test-fixtures/large.db"), "large SQLite fixture exists"],
  [fs.existsSync("test-fixtures/malformed.db"), "malformed SQLite fixture exists"],
  [fs.existsSync("test-fixtures/sidecar.sqlite-wal"), "sqlite-wal sidecar fixture exists"],
  [fs.existsSync("test-fixtures/sidecar.sqlite-shm"), "sqlite-shm sidecar fixture exists"],
  [fs.existsSync("test-fixtures/sidecar.db-wal"), "db-wal sidecar fixture exists"],
  [fs.existsSync("test-fixtures/sidecar.db-shm"), "db-shm sidecar fixture exists"],
];

const failures = assertions.filter(([passes]) => !passes).map(([, label]) => label);

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`FAIL: ${failure}`);
  }
  process.exit(1);
}

console.log("SQL Viewer smoke checks passed.");
