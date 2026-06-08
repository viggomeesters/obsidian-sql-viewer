# Security Policy

## Supported versions

Only the latest release is actively supported.

## Reporting a vulnerability

Please report security issues privately by emailing the maintainer or opening a minimal GitHub security advisory if available.

Do not include sensitive vault content or private database files in public issues. If a reproduction requires database content, reduce it to a minimal synthetic SQLite fixture first.

## Security posture

SQL Viewer is read-only. It reads `.sqlite`, `.sqlite3`, and `.db` files through the vault API and renders a local inspection view. It does not send vault content to external services, does not use runtime network APIs, does not read or write the system clipboard, and does not write database files back to disk.

The SQLite engine is `sql.js`, bundled into `main.js` with its WebAssembly bytes. The plugin initializes databases from the vault file bytes and enables SQLite `query_only` mode before inspection.

The query runner accepts only one `SELECT` or `WITH` statement. It blocks mutation, transaction, maintenance, attachment, and pragma keywords, applies a rendered row cap, and has an elapsed-time guard during row iteration.

Known limitation: sql.js runs synchronously in WebAssembly, so the elapsed-time guard cannot interrupt a single expensive SQLite step before that step returns. The runner is therefore limited to local inspection, not long analytical workloads.
