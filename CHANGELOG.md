# Changelog

All notable changes to Breadboard are documented here. This project is a fork of [cocktailpeanut/breadboard](https://github.com/cocktailpeanut/breadboard), being developed for release under the [pinokiofactory](https://github.com/pinokiofactory) organization.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

---

## [Unreleased]

### Changed
- **Video playback compatibility upgrade** — Breadboard now inspects video container/codec/fps metadata with `ffprobe`, stores playback capabilities in the video database, serves correct MIME types for natively supported files, and lazily generates cached H.264/AAC MP4 transcodes for unsupported formats such as HEVC-in-MP4, AVI, and Matroska. Search/get video API responses now expose `playback_url` and `playback_strategy`, the gallery uses those URLs for hover/viewer playback, and the pop-out viewer now resolves playback through the API with an inline error state. (`app/server/video-database.js`, `app/server/video-scanner.js`, `app/server/index.js`, `app/public/video-modules/main.js`, `app/views/video-viewer.ejs`)
- **Video card header glass styling** — the video action/selection header now uses theme-scoped glass variables with lower-opacity overlay backgrounds, stronger blur, softer borders, and lighter shadows so hover-mode headers feel more translucent while keeping button readability. Hover-mode styling is now explicitly overridden on `.video-card` so it no longer gets stomped by the shared `.card` hover rule in `global.css`, and the hover header now uses a shared cross-theme glass tint with consistent white icons while the always-visible header remains theme-based. The structure is now ready for future user color-theming without reworking the card layout logic. (`app/public/videos.css`)
- **BACKLOG consolidation** — all shower thoughts from `BACKLOG.md` promoted to official tasks in `DESIGN.md`. Six new/expanded roadmap sections: §8.5 (Metadata System Expansion), §8.11 (Video Player & Viewer Enhancements), §8.12 (Library Organization & Bookmark Bar), §8.13 (External Folder Management), §8.14 (Video Gallery UX Improvements), §8.15 (Cross-Cutting UX Polish). See `DESIGN.md` §8 for full task details. (`BACKLOG.md`, `DESIGN.md`)

### Added
- **Video tab redesign** — complete rewrite of the video gallery to match the image tab's polished UX patterns:
  - **Video REST API** (`/api/videos/*` endpoints) — search, get, count, tags, soft-delete/trash, restore, folders, settings. Mirrors the image API structure. (`app/server/index.js`)
  - **Video database extensions** (`app/server/video-database.js`) — added folders, settings, and trash tables. Added search method with query syntax (filename, tag, field filters, date filters, numeric comparisons). Added soft-delete with trash management, folder CRUD, and settings storage.
  - **Fullscreen video viewer** — overlay with pan/zoom matching the image viewer. Scroll-to-zoom-to-cursor, drag-to-pan, click-release-to-close. Play/pause control, left/right navigation between videos, collapsible metadata/tag panel with hyperfilter clicks. Nav auto-hides during viewing. Keyboard shortcuts: arrows (navigate), +/- (zoom), 0 (reset), space (play/pause), i (info panel), Esc (close). (`app/public/video-modules/main.js`)
  - **Video settings sidebar** — slide-out panel matching image tab: theme toggle, auto-hide nav, card header mode (always/hover/hidden), card size zoom slider, delete confirmation toggle, trash management (count, open folder, empty trash), debug tools. Settings persisted via video-specific settings API. (`app/public/video-modules/main.js`)
  - **Video folder management panel** — dropdown from nav bar (📁 icon) with connected folders list, per-folder re-scan, disconnect, and "Connect a folder" button. Replaces the old single "Select Folder" button. (`app/public/video-modules/main.js`)
  - **Video card header controls** — matching image tab: favorite (heart), open in explorer, trash (soft-delete), plus play-lock button (right-aligned) for continuous in-grid playback with audio. (`app/public/video-modules/main.js`)
  - **Video soft-delete** — deleted videos move to `appdata/deleted_files/video/` subdirectory. Trash management in settings sidebar. Themed confirmation dialog.
  - **Video API methods** (`app/public/modules/api.js`) — added searchVideos, getVideo, getVideoCount, addVideoTags, removeVideoTags, deleteVideos, restoreVideos, getVideoTrash, emptyVideoTrash, getVideoFolders, addVideoFolder, removeVideoFolder, getVideoSetting, setVideoSetting.
- **Video nav bookmarks** — added bookmarked filters link, liked items link (tag:favorite), and search bookmark button to the video nav bar, matching the image tab. URL query parameter support (`/videos?query=tag:favorite`).
- **Video card fit mode** — contain/cover radio options in video settings sidebar. CSS variable `--video-fit` controls card video object-fit. Default is cover.
- **Video card popout button** — pop-out video viewer button restored to card header, right-aligned alongside play-lock button. Opens video in a separate window.
- **Image card popout right-aligned** — pop-out button moved to right side of card header via `.grab-right` class, matching the video tab layout. (`app/public/modules/card.js`, `app/public/global.css`)
- **Video multi-select** — drag-select (DragSelect/ds.js) and keyboard shortcuts (Ctrl+A, Escape, Delete) for selecting multiple video cards. Selection footer with: selected count, tag editor (add tags to selection), bulk delete, cancel. Matches the image tab's selection UX. (`app/public/video-modules/main.js`, `app/views/videos.ejs`)
- **Video re-index** — "Re-index from Scratch" button in video settings sidebar, triggers re-scan of all connected video folders.
- **Video scan progress** — Nanobar progress bar at top of screen during video folder scanning/re-indexing. Sync button spins while scanning. Status text shows "indexing videos... N" with running count. Listens for Electron IPC progress events (`video-scan-progress`). Live video additions/removals auto-refresh the grid.
- **Video thumbnails** — ffmpeg frame extraction at 0s mark during scan, cached to `appdata/thumbnails/video/<fingerprint>.jpg`. Cards render `<img>` thumbnails by default for performance; `<video>` loads lazily on hover or play-lock. Fallback to direct `<video>` for videos without thumbnails. (`app/server/video-scanner.js`, `app/server/video-database.js`, `app/server/index.js`, `app/public/video-modules/main.js`, `app/public/videos.css`)
- **Video database schema extended** — added `thumbnail_path` column (stores path to cached thumbnail), `root_path` column (tracks which connected folder the video belongs to, for future metadata/subfolder support). Auto-migration for existing databases. (`app/server/video-database.js`)
- **Thumbnail serving route** — `GET /thumb/video/:fingerprint` serves cached thumbnail JPEGs. (`app/server/index.js`)

### Fixed
- **Eternal indexing counter** — IPC progress listeners (`onVideoScanProgress`, `onVideoAdded`, `onVideoRemoved`) were accumulating on every page load without cleanup. Added guard against duplicate listener registration. Live reload events now debounced (2s) and suppressed during active scan. (`app/public/video-modules/main.js`)
- **Slow indexing for large files** — ffprobe had no timeout (could hang indefinitely on large movies). Added 30s timeout. ffmpeg thumbnail generation now uses input seeking (`-ss` before `-i`) which is orders of magnitude faster for large files. Timeout increased to 30s. (`app/server/video-scanner.js`)
- **Re-indexing already-indexed files** — scanner now checks if a file is already in the DB with the same mtime before running ffprobe/ffmpeg. Unchanged files skip the expensive metadata extraction entirely, only generating missing thumbnails. Re-index of 500 already-indexed files now takes seconds instead of minutes. (`app/server/video-scanner.js`, `app/server/video-database.js`)
- **Watcher starting during scan** — the `scan-videos` IPC handler was starting a new file watcher after each scan, which only tracked the last folder and could fire duplicate events. Watcher startup removed from scan handler. (`app/main.js`)
- **IPC response payload bloat** — scan results no longer return the full video array across the IPC bridge (was serializing hundreds of video objects). Returns only the count. (`app/main.js`)
- **Nav bar disappearing after viewer close** — nav restore logic was fragile with undefined state. Now explicitly restores to pre-viewer state (auto-hide or visible) regardless of edge cases. (`app/public/video-modules/main.js`)
- **Duplicate scan status management** — `scanFolder()` and `initScanProgress()` were both managing the status/spinner UI, causing conflicts. Simplified: `initScanProgress` handles all UI updates, `scanFolder` just triggers the scan. (`app/public/video-modules/main.js`)
- **Video soft-delete cross-device failure** — `fs.renameSync` fails across drives on Windows. Added copy+delete fallback matching the image tab's implementation. (`app/server/video-database.js`)
- **Duplicate event listeners on re-render** — click, mousedown, and hover listeners were added to the container on every `renderGrid()` call, causing button clicks to fire N times (e.g., popout opening 7 windows after 7 re-renders). Split into `initCardListeners()` (once at init, delegated) and `attachCardHandlers()` (per-render, IntersectionObserver only). (`app/public/video-modules/main.js`)
- **Image tab empty state** — replaced old "Connect a folder" link (pointing to removed `/connect` page) with a clean empty state matching the video tab: icon, "No images loaded", instruction to click the folder icon. (`app/public/modules/app.js`)

### Changed
- **Video nav bar** (`app/views/videos.ejs`) — rewritten to match image tab structure: back/forward, bookmarked filters, liked items, sync, search bar with bookmark button and sorter dropdown, folder management button, settings button, help link, new window. Removed old "Select Folder" button, old settings button, old settings link, minimize button.
- **Theme globalized** — theme setting (dark/light) now reads from and writes to the shared settings API (`/api/settings/theme`) used by both image and video tabs. Changing theme in either tab's settings applies globally on next tab load.
- **Video sorter dropdown** — fixed theme colors (dark/light) and text alignment (left-aligned to match image tab).
- **Video gallery controller** (`app/public/video-modules/main.js`) — complete rewrite from scratch. Now uses REST API instead of Electron IPC/localStorage. Modular architecture matching image tab patterns.
- **Video CSS** (`app/public/videos.css`) — complete rewrite. Cards now use the same `.card` class pattern as image tab with `.grab` header. Supports dark/light themes, card header visibility modes (always/hover/hidden), hover-to-preview, play-lock indicator, thumbnail/video layering.

### Removed
- Old video settings panel (slide-out DOM element with localStorage)
- Old in-grid card expansion behavior (replaced by fullscreen viewer overlay)
- Old "Select Folder" single-folder workflow (replaced by folder management panel)
- Old video card controls (play/popout buttons, replaced by header bar matching image tab)

### Added
- **SQLite image database** (`app/server/image-database.js`) — replaces IndexedDB/Dexie with server-side SQLite via `better-sqlite3`. Fingerprint-based primary keys (SHA-256, head+tail 64KB sampling). Full search engine replicating the existing query syntax as SQL. WAL mode for concurrent reads during writes. Includes: images, tags, image_tags, folders, checkpoints, settings, favorites, and trash tables.
- **REST API** (`/api/*` endpoints) — server-side search, tag management, folder management, settings, favorites, trash, XMP retrieval, and status. All endpoints return JSON. Search uses the same query syntax as the UI search bar.
- **Soft-delete system** — deleted files move to `appdata/deleted_files/` instead of permanent removal. Trash table tracks original path for restore. Includes restore, empty trash, and auto-purge by age.
- **Subfolder field** — images store their path relative to the connected root folder, enabling `subfolder:txt2img-grids` search queries.
- **LoRA search** — `loras` field indexed and searchable via `loras:detail-tweaker` query syntax.
- **ComfyUI metadata parser** (`app/server/crawler/comfyui.js`) — extracts generation parameters from ComfyUI workflow JSON embedded in images.
- **Custom image viewer** — full-screen overlay with integrated metadata/tag side panel. Pan/drag to move image, zoom toward cursor (mouse wheel, +/- keys, toolbar buttons), slideshow (space key, configurable interval), left/right navigation (arrow keys, buttons). Collapsible info panel (`i` key). Hyperfilter clicks on metadata values navigate to filtered search. Click-release to close (distinguished from click-drag to pan). Nav auto-hides during viewing for unobstructed fullscreen experience.
- **Settings sidebar** — slide-out panel from right side containing: theme toggle, auto-hide nav, card header mode, zoom/aspect/fit sliders, slideshow interval, delete confirmation toggle, trash management (count, open folder, empty trash), re-index, debug (Electron), version info. Replaces the separate `/settings` page.
- **Folder management panel** — dropdown from nav bar (📁 icon) with connected folders list, per-folder re-index and disconnect, and "Connect a folder" button. Replaces navigating to `/connect`.
- **Soft-delete with trash management** — deleted files move to flat `appdata/deleted_files/` folder. Settings sidebar shows trash count, open folder button, and empty trash with themed confirmation.
- **Custom themed confirm dialog** — replaces native `confirm()`. Respects dark/light theme. Red delete button, neutral cancel. "Ask before deleting" toggle in settings for fast workflow.
- **Auto-hide nav bar** — settings toggle. Nav slides up with 600ms delay, reveals on hover at top 8px. Thin drag zone for window movement when hidden. Nav forced to auto-hide during image viewer.
- **Project documentation** — `DESIGN.md` (architecture, roadmap, decisions), `AGENTS.md` (AI assistant context), `BACKLOG.md` (ideas pipeline), `CHANGELOG.md`.

### Changed
- **Data layer fully migrated to SQLite** — all frontend modules (`app.js`, `api.js`, `navbar.js`) now use the REST API backed by SQLite. IndexedDB/Dexie is no longer used anywhere. Search executes as SQL on the server instead of in a Web Worker.
- **All views updated** — `index.ejs`, `settings.ejs`, `connect.ejs`, `favorites.ejs`, `card.ejs`, `viewer.ejs` all rewritten to use the REST API. No Dexie dependencies remain.
- **Rendering simplified** — removed Clusterize.js virtual scrolling (incompatible with CSS grid layout). Cards render directly with `loading="lazy"` images. Handles 1-10k images smoothly; grid-aware virtualizer planned for 50k+ scale.
- **No auto-sync on startup** — app loads instantly from persisted SQLite data. Sync only triggers on explicit re-index or when DB is empty with folders connected.
- **Card header simplified** — four buttons: favorite, open in explorer, trash (soft-delete), pop-out. Eye icon removed (click image opens viewer directly).
- **Card expansion removed** — in-grid card expansion replaced by the full-screen viewer overlay. No more layout disruption when viewing an image.
- **Nav and footer transparency** — frosted glass effect (`backdrop-filter: blur`) in both dark and light themes. Subtle border separators.
- **Settings moved inline** — ⚙️ icon opens a slide-out sidebar instead of navigating to `/settings`. Card display icon repurposed as folder management dropdown.
- **Breadmachine inlined** — external `breadmachine` npm dependency merged into `app/server/`.
- **Dependencies fully updated** — Electron 22→39, electron-builder 23→26, express 4.18→4.22, axios 1.2→1.15, fast-xml-parser 4.0→4.5, socket.io 4.6→4.8, all others. Zero known vulnerabilities (was 41).
- **electron-context-menu** updated to v4 (ES module) — loaded via dynamic `import()`.
- **Data storage localized** — all data in `./appdata/` for full portability.
- **Image format support expanded** — WebP, GIF, BMP, TIFF/TIF added.
- **Window state persistence** — remembers size, position, maximized state.
- **Proper exit behavior** — close terminates the app on all platforms.

### Removed
- **IndexedDB/Dexie** — fully replaced by SQLite. `dexie.js`, `db.js`, `worker.js` deleted.
- **Clusterize.js** — removed (`clusterize.js`, `clusterize.css` deleted). Incompatible with CSS grid layout.
- **In-grid card expansion** — replaced by full-screen viewer overlay.
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
