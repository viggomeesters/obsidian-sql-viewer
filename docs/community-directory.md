# Community Directory Notes

SQL Viewer is prepared as a minimal read-only SQLite inspection plugin.

## Plugin

- Repository: `https://github.com/viggomeesters/obsidian-sql-viewer`
- Plugin id: `sql-viewer`
- Display name: `SQL Viewer`
- Version: `0.1.0`
- Supported extensions: `.sqlite`, `.sqlite3`, `.db`

## Positioning

SQL Viewer intentionally overlaps only with the safe inspection subset of existing SQLite plugins. It does not provide editing, migrations, exports, charts, note generation, server database connections, or a general SQL script viewer.

## Required checks

```bash
npm install
npm run build
npx tsc --noEmit
npm test
npm run community:check
```
