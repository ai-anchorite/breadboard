# Changelog

All notable changes to Breadboard are documented here. This project is a fork of [cocktailpeanut/breadboard](https://github.com/cocktailpeanut/breadboard), being developed for release under the [pinokiofactory](https://github.com/pinokiofactory) organization.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Added
- **SQLite image database** (`app/server/image-database.js`) — replaces IndexedDB/Dexie with server-side SQLite via `better-sqlite3`. Fingerprint-based primary keys (SHA-256, head+tail 64KB sampling). Full search engine replicating the existing query syntax as SQL. WAL mode for concurrent reads during writes. Includes: images, tags, image_tags, folders, checkpoints, settings, favorites, and trash tables.
- **REST API** (`/api/*` endpoints) — server-side search, tag management, folder management, settings, favorites, trash, XMP retrieval, and status. All endpoints return JSON. Search uses the same query syntax as the UI search bar.
- **Soft-delete system** — deleted files move to `appdata/deleted_files/` instead of permanent removal. Trash table tracks original path for restore. Includes restore, empty trash, and auto-purge by age.
- **Subfolder field** — images store their path relative to the connected root folder, enabling `subfolder:txt2img-grids` search queries.
- **LoRA search** — `loras` field indexed and searchable via `loras:detail-tweaker` query syntax.
- **ComfyUI metadata parser** (`app/server/crawler/comfyui.js`) — extracts generation parameters from ComfyUI workflow JSON embedded in images.
- **Project documentation** — `DESIGN.md` (architecture, roadmap, decisions), `AGENTS.md` (AI assistant context), `BACKLOG.md` (ideas pipeline), `CHANGELOG.md`.

### Changed
- **Data layer fully migrated to SQLite** — all frontend modules (`app.js`, `api.js`, `navbar.js`) now use the REST API backed by SQLite. IndexedDB/Dexie is no longer used anywhere. Search executes as SQL on the server instead of in a Web Worker.
- **All views updated** — `index.ejs`, `settings.ejs`, `connect.ejs`, `favorites.ejs`, `card.ejs`, `viewer.ejs` all rewritten to use the REST API. No Dexie dependencies remain.
- **Rendering simplified** — removed Clusterize.js virtual scrolling (incompatible with CSS grid layout). Cards render directly with `loading="lazy"` images. Handles 1-10k images smoothly; grid-aware virtualizer planned for 50k+ scale.
- **No auto-sync on startup** — app loads instantly from persisted SQLite data. Sync only triggers on explicit re-index or when DB is empty with folders connected.
- **Breadmachine inlined** — external `breadmachine` npm dependency merged into `app/server/`.
- **Dependencies fully updated** — Electron 22→39, electron-builder 23→26, express 4.18→4.22, axios 1.2→1.15, fast-xml-parser 4.0→4.5, socket.io 4.6→4.8, all others. Zero known vulnerabilities (was 41).
- **electron-context-menu** updated to v4 (ES module) — loaded via dynamic `import()`.
- **Data storage localized** — all data in `./appdata/` for full portability.
- **Image format support expanded** — WebP, GIF, BMP, TIFF/TIF added.
- **Card UI improved** — collapsible metadata, prominent tags, grouped action buttons.
- **Window state persistence** — remembers size, position, maximized state.
- **Proper exit behavior** — close terminates the app on all platforms.

### Removed
- **IndexedDB/Dexie** — fully replaced by SQLite. `dexie.js`, `db.js`, and `worker.js` are now dead code (to be cleaned up).
- **Clusterize.js virtual scrolling** — removed from image gallery (incompatible with grid layout).
- **`breadmachine` external dependency** — merged into `app/server/`.
- **32-bit Windows target** — removed from electron-builder config.

---

## [0.5.0] — 2026-04-17

Baseline version after forking. Breadmachine inlined, dependencies updated, localization complete.

### Prior work (original Breadboard by cocktailpeanut)
- Electron-based image browser for AI-generated content
- Metadata extraction from Automatic1111, InvokeAI, DiffusionBee, Imaginairy, NovelAI, Sygil
- XMP normalization and tag storage on files
- IndexedDB/Dexie client-side database
- Virtual scrolling, search with hyperfilter syntax, god filters
- Multi-select, bulk operations, favorites, dark/light theme
- Fullscreen image viewer, pop-out windows, keyboard shortcuts
