# Contributing

Thanks for helping improve SQL Viewer.

## Local setup

```bash
npm install
npm run build
npx tsc --noEmit
npm test
```

For manual testing, copy the built runtime files into `.obsidian/plugins/sql-viewer/` in a test vault, reload the app, and open `.sqlite`, `.sqlite3`, and `.db` files.

## Pull requests

- Keep the plugin read-only.
- Do not add network APIs in runtime plugin code.
- Do not add clipboard access without explicit user action and documentation.
- Preserve coverage for valid SQLite fixtures, multiple tables, views, indexes, malformed input, blocked write queries, and row caps.
- Run build, typecheck, and tests before opening a PR.

## Release assets

Community releases must include:

- `main.js`
- `manifest.json`
- `styles.css`
