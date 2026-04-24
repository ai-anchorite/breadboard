# Breadboard — Design & Vision Document

> **Purpose:** This is the source of truth for all development decisions. Every session should start here. It defines what the app is, what it does, how it works, and where it's going.

---

## 1. What Breadboard Is

Breadboard is a **desktop media browser and organizer** for AI-generated content, distributed via Pinokio. It is built for the Stable Diffusion / AI art community — people who have been generating images and video since SD 1.5 and have accumulated massive output libraries across multiple tools and directories.

**Core value proposition:**
- Point it at any folder (or many folders) and immediately browse, search, and organize everything in one place
- Extracts and normalizes metadata embedded by generation tools (prompts, seeds, models, samplers, etc.)
- Replaces standalone image/video viewers for this use case
- Fully portable and self-contained — no system-wide installation, no leftover files

**Distribution context:** Pinokio users are technically comfortable but diverse in workflow. The app must work out of the box with zero configuration, handle massive libraries gracefully, and be resilient to the wide variety of output formats and folder structures that different tools produce.

**Two focused libraries, intentionally separate:**
Images and video serve different workflows and are kept as distinct views. The image library is for browsing generation outputs, retrieving metadata to reproduce or iterate on images, and curating training datasets. The video library is for organizing and viewing video outputs, and preparing clips for editing workflows. The use-cases don't overlap enough to justify a unified view — keeping them separate keeps each UI focused and uncluttered. They share folder management, the tag namespace, and the search syntax, but are otherwise independent.

---

## 2. Current State (as of April 2026)

### What's working — Image Library ✅
- SQLite database (`better-sqlite3`) with fingerprint-based PKs, WAL mode
- REST API (`/api/*`) for all data operations — search, tags, folders, settings, favorites, trash
- Full search system with hyperfilter syntax executed as SQL server-side
- Custom fullscreen image viewer with pan/drag, zoom (mouse wheel + keyboard), slideshow, collapsible metadata/tag panel with hyperfilters
- Simplified card grid with lazy-loaded images — tested smooth at 22k+ images
- Card header: favorite, open in explorer, trash (soft-delete), pop-out
- Soft-delete system — files move to `appdata/deleted_files/`, trash management in settings
- Custom themed delete confirmation dialog with toggle to disable
- Settings sidebar (slide-out) — theme, card display, slideshow, auto-hide nav, trash management, re-index, debug
- Folder management dropdown panel — connect, disconnect, per-folder re-index
- Frosted glass nav and footer with backdrop blur transparency
- Auto-hide nav bar with hover reveal and window drag zone
- Nav auto-hides during image viewer for unobstructed viewing
- Tag system — user tags stored in XMP on files, survive re-index
- Multi-select with drag-select and keyboard shortcuts
- Bulk operations: add tags, remove tags, delete files, re-index
- Favorites / bookmarked searches / god filters
- Dark/light theme
- Live mode (real-time updates as new files appear)
- Metadata extraction: Automatic1111, InvokeAI, ComfyUI, DiffusionBee, Imaginairy, NovelAI, Sygil, generic `.txt` sidecar
- Image formats: PNG, JPG, JPEG, WebP, GIF, BMP, TIFF
- Fully portable (all data in `./appdata/`)

### What's working — Video Library ✅ Redesigned
- Separate `/videos` route with its own SQLite database, scanner, watcher
- REST API (`/api/videos/*`) for all data operations — search, tags, folders, settings, trash
- Custom fullscreen video viewer with pan/zoom (scroll-to-zoom-to-cursor, drag-to-pan), play/pause, left/right navigation, collapsible metadata/tag panel with hyperfilters, click-release-to-close
- Video card grid with hover-to-play, click-to-lock playback (with audio)
- Card header: favorite, open in explorer, trash (soft-delete), play-lock, pop-out — matching image tab layout
- Soft-delete system — files move to `appdata/deleted_files/video/`, trash management in settings
- Custom themed delete confirmation dialog with toggle to disable
- Settings sidebar (slide-out) — theme (global), auto-hide nav, card header mode, card size zoom, contain/cover fit, re-index, delete confirmation, trash management, debug
- Folder management dropdown panel — connect, disconnect, per-folder re-scan
- Auto-hide nav bar with hover reveal, nav auto-hides during video viewer
- Multi-select with drag-select and keyboard shortcuts (Ctrl+A, Delete, Escape)
- Bulk operations: add tags, delete files
- Search with query syntax (filename, tag, field filters, date filters, numeric comparisons)
- Sort by created, updated, filename, width, duration
- Bookmarked filters, liked items (tag:favorite), search bookmark button
- Scan progress bar (Nanobar) with running file count during indexing
- Dark/light theme (global, shared with image tab)
- Tags and ratings in the video DB
- Pop-out video viewer

### What needs work next
- **Video generation metadata** — ComfyUI video nodes (AnimateDiff, Wan, HunyuanVideo) embed metadata in video files or sidecar JSON. This is the next major feature area.
- **Metadata & search improvements** — better metadata extraction and presentation, improved search UX, bookmarking polish
- **Grid-aware virtual scrolling** — for 50k+ image libraries (current direct DOM rendering works well to ~22k)
- **Improved indexing progress UX** — centered overlay with file counter and progress bar (see BACKLOG)
- **Popout video player redesign** — current prototype needs proper controls, theming, multi-monitor support (see BACKLOG)

### Known issues
- Update check throws `Entity expansion limit exceeded: 1159 > 1000` (non-critical, cosmetic)
- `better-sqlite3` is a native module — requires rebuild per Electron version, handled by `electron-builder install-app-deps`

---

## 3. Architecture

### Process model

```
Electron Main Process (app/main.js)
  ├── BreadboardServer (app/server/index.js)
  │     ├── Express HTTP server (dynamic port, default 2000)
  │     ├── Socket.IO (real-time push to renderer)
  │     ├── Chokidar file watcher
  │     ├── IPC handler registry (app/server/ipc.js)
  │     └── Crawlers (app/server/crawler/)
  ├── VideoDatabase (app/server/video-database.js) — SQLite via better-sqlite3
  ├── VideoScanner (app/server/video-scanner.js)
  └── VideoWatcher (app/server/video-watcher.js)

Renderer Process (Electron BrowserWindow → Express routes)
  ├── Image gallery: app/views/index.ejs + app/public/modules/
  │     ├── app.js       — main controller, sync orchestration, draw loop
  │     ├── api.js       — REST API + Socket.IO communication
  │     ├── navbar.js    — search bar, sort, filters, favorites
  │     ├── handler.js   — click handlers, card expand/collapse
  │     ├── card.js      — card HTML template
  │     ├── selection.js — multi-select (drag, ctrl, shift)
  │     └── zoomer.js    — responsive card sizing
  ├── Video gallery: app/views/videos.ejs + app/public/video-modules/main.js
  │     └── main.js    — full controller: grid, viewer, settings, folders, selection, scan progress
  └── Other views: settings, connect, favorites, help, viewer, screen
```

### Data stores

**Image library — SQLite via better-sqlite3 (implemented)**

All image data operations go through the REST API (`/api/*`) to the SQLite database. The frontend has no direct database access. IndexedDB/Dexie has been fully removed.

```
images      — fingerprint (PK), file_path, root_path, filename, subfolder,
              agent, model_name, model_hash, prompt, negative_prompt,
              sampler, steps, cfg_scale, seed, input_strength, loras,
              width, height, aesthetic_score,
              controlnet_module, controlnet_model, controlnet_weight,
              controlnet_guidance_strength, size, btime, mtime, indexed_at
tags        — id, name (UNIQUE COLLATE NOCASE)
image_tags  — fingerprint, tag_id, added_at
settings    — key, val
folders     — path, added_at
checkpoints — root_path, btime (incremental sync state)
favorites   — id, query, label, is_global, created_at
trash       — fingerprint, original_path, trash_path, deleted_at, metadata
```

**Video library — SQLite via better-sqlite3 (implemented)**

The video library has its own SQLite database with a REST API (`/api/videos/*`, `/api/video-folders/*`, `/api/video-settings/*`). The image and video UIs are intentionally separate but share the same UI patterns and global theme setting.

```
videos      — fingerprint (PK), file_path, filename, root_path, size,
              width, height, duration, aspect_ratio, thumbnail_path,
              created_at, modified_at, indexed_at
tags        — id, name (UNIQUE COLLATE NOCASE)
video_tags  — fingerprint, tag_id, added_at
ratings     — fingerprint, value (0-5)
folders     — id, path, added_at
settings    — key, val
trash       — fingerprint, original_path, trash_path, deleted_at
```

**XMP metadata files — filesystem (gmgm library)**
```
appdata/breadboard/gm/
  agent/  — auto-extracted metadata (one .xmp file per image, keyed by CID)
  user/   — user tags (same structure)
```

### Key design decisions

**Why SQLite for both libraries?**
IndexedDB had well-documented performance problems at scale — bulk inserts of 30k records could take minutes, and full-table scans blocked the renderer thread. SQLite with WAL mode handles hundreds of thousands of rows with sub-millisecond indexed queries, runs server-side (no renderer blocking), and gives us proper SQL for the complex filtering the search system needs. The image library migration is complete. `better-sqlite3` provides a synchronous API, prebuilt binaries for all platforms, and automatic rebuild via `electron-builder`'s `postinstall` hook.

**Why XMP on files?**
Tags and metadata are written back to the source files in XMP format. This means user tags survive a full re-index — the database is always reconstructable from the files themselves. The database is a cache; the files are the truth.

**Why fingerprint-based IDs?**
Both databases use SHA-256 fingerprinting (head + tail 64KB sampling + size + created timestamp). Files retain their identity across renames and moves.

**Why keep image and video as separate SQLite databases?**
They serve different views with different schemas, different metadata, and different workflows. A single DB would add complexity with no user-facing benefit. Two separate `.sqlite` files in `appdata/` is clean, simple, and independently resettable.

**Development approach: image-first, then video.**
The image UI/UX was perfected first — card layout, metadata display, search, tags, settings. The same patterns have now been applied to the video library. Both tabs share the same visual language, interaction patterns, and global settings (theme, auto-hide nav). Tab-specific settings (card size, fit mode) are stored separately.

---

## 4. Metadata System

### Image metadata pipeline

```
File detected by Chokidar watcher
  → parser.js detects source app (A1111, ComfyUI, InvokeAI, etc.)
  → appropriate crawler extracts raw metadata
  → normalized to XMP schema
  → written to appdata/breadboard/gm/agent/<cid>.xmp
  → indexed into SQLite (image-database.js)
  → progress broadcast via Socket.IO
  → renderer refreshes from API on completion
```

### Supported generation tools (images)

| Tool | Detection | Source |
|------|-----------|--------|
| Automatic1111 / Forge | `parsed.parameters` exists | PNG text chunk |
| InvokeAI | `parsed["sd-metadata"]` exists | PNG text chunk |
| Imaginairy | `parsed.ImageDescription` exists | EXIF |
| NovelAI | `parsed.Comment` exists | PNG comment |
| Sygil | Keys starting with `SD:` | EXIF |
| DiffusionBee | `data.json` in folder | External JSON |
| Generic | Fallback | `.txt` sidecar |

### Normalized XMP fields (images)

```
prompt, negative_prompt, sampler, steps, cfg_scale, seed,
input_strength, model_name, model_hash, model_url, agent,
width, height, aesthetic_score,
controlnet_module, controlnet_model, controlnet_weight, controlnet_guidance_strength
```

### Tag storage

Tags are stored in the `image_tags` / `video_tags` junction tables in SQLite, and mirrored in the XMP `dc:subject` bag on the file (images). This dual-write is what makes re-index non-destructive — tags survive because they're on the files.

### Video metadata (current)

Only filesystem metadata: size, dimensions (via ffprobe if available), duration, timestamps. No generation metadata extraction yet.

---

## 5. Search & Filter System

This is a core differentiator. The search system is powerful and must remain so as features are added.

### Query syntax

**Full-text (prompt search)**
```
rainy day          → tokens contain "rainy" AND "day"
```

**Field filters**
```
model_name:sdxl           → model_name contains "sdxl"
model_hash:31e35c80fc     → exact match
agent:automatic1111       → exact match
file_path:"outputs"       → file_path contains "outputs"
tag:favorite              → has tag:favorite in tokens
```

**Numeric comparisons**
```
width:>512        width:>=512       width:512
height:<1024      height:<=1024
steps:>=30        cfg_scale:7.5     seed:42
aesthetic_score:>6
```

**Negative filters**
```
-tag:nsfw                 → exclude files with tag:nsfw
-:blurry                  → exclude if tokens contain "blurry"
-file_path:grids          → exclude file paths containing "grids"
```

**Date filters**
```
before:2024-12-31         after:2024-01-01
```

**Combined**
```
tag:favorite model_name:sdxl width:>1024 -tag:nsfw after:2024-01-01
```

### Hyperfilters

Clicking a metadata value in an expanded card opens a popover with filter options:
- String fields: include / exclude
- Numeric fields: `=`, `>`, `<`, `>=`, `<=`
- Prompt tokens: include / exclude

### God filters

Bookmarked searches can be promoted to "god filters" — they apply globally to all queries, invisibly. Example: `-tag:nsfw` as a god filter hides all NSFW content everywhere without cluttering the search bar.

### Sort options

created ↓↑, updated ↓↑, prompt a-z/z-a, width ↓↑, height ↓↑, aesthetic ↓↑

---

## 6. The Database Migration — Complete

The image library has been migrated from IndexedDB/Dexie to SQLite (`better-sqlite3`). This was the foundational architectural change that everything else builds on.

### What was done
- Built `app/server/image-database.js` — full SQLite schema with fingerprint PKs, search engine, tags, soft-delete, subfolder tracking
- Built REST API layer (`/api/*` endpoints) on the Express server
- Rewired all frontend modules (`app.js`, `api.js`, `navbar.js`) to use the API
- Rewired all views (`settings.ejs`, `connect.ejs`, `favorites.ejs`, `card.ejs`, `viewer.ejs`)
- Updated IPC sync pipeline to write to SQLite during indexing
- Removed IndexedDB/Dexie entirely (`dexie.js`, `db.js`, `worker.js` deleted)
- Removed Clusterize.js (incompatible with CSS grid layout)

### What stays the same
- XMP metadata on files (tags survive re-index)
- The search query syntax (same syntax, now executed as SQL)
- The IPC/Socket.IO communication pattern for sync progress
- Card rendering and all existing UI behavior
- The video library (unchanged, still on its own SQLite DB)

---

## 7. Remaining Technical Debt

### Medium priority

**Update check entity expansion error**
`fast-xml-parser` entity expansion limit needs to be raised to ~2000 in the updater config. One-line fix.

**No video generation metadata**
ComfyUI video nodes (AnimateDiff, Wan, HunyuanVideo, etc.) embed metadata in video files or sidecar JSON. This should be extracted and indexed.

**Popout video player is a prototype**
The `/video-viewer` page is a basic HTML video element in a popup window. Needs redesign with proper controls, theming, and multi-monitor support. See BACKLOG.

### Low priority

**Grid-aware virtual scrolling for 50k+ libraries**
Current direct DOM rendering with `loading="lazy"` works well to ~22k images. For 50k+, a custom grid-aware virtualizer will be needed. Not blocking current development.

---

## 8. Feature Roadmap

Features are grouped by theme. The database migration (§6) is a prerequisite for most image library work and should happen first.

### 8.1 Database Migration ✅ Complete

- Image library migrated from IndexedDB/Dexie to SQLite/better-sqlite3
- Fingerprint-based PKs for images
- Server-side search via REST API
- All views and frontend modules rewired
- Dead code removed (Dexie, Web Worker, Clusterize)

### 8.2 Folder Management UX ✅ Complete

- Folder management dropdown panel in the image gallery nav bar (📁 icon)
- Connect, disconnect, per-folder re-index — all inline, no page navigation
- Settings sidebar handles theme, card display, trash, re-index — no separate settings page needed

### 8.3 Video Tab Redesign ✅ Complete

Applied the image tab's UI patterns to the video library:
- Custom fullscreen video viewer with pan/zoom (scroll-to-zoom-to-cursor, drag-to-pan), play/pause, navigation, metadata/tag panel with hyperfilters
- REST API (`/api/videos/*`) — search, tags, folders, settings, trash, mirroring image API
- Video database extended with folders, settings, trash tables, search with query syntax
- Settings sidebar — theme (global), auto-hide nav, card header mode, card size, contain/cover fit, re-index, trash management
- Folder management dropdown — connect, disconnect, per-folder re-scan
- Soft-delete with trash management (files to `appdata/deleted_files/video/`)
- Themed delete confirmation dialog
- Auto-hide nav during viewer
- Card header: favorite, open in explorer, trash, play-lock, pop-out — right-aligned grouping
- Multi-select with DragSelect — bulk tag add, bulk delete
- Bookmarked filters, liked items, search bookmark button
- Scan progress bar with running file count
- Nav bar matching image tab: back/forward, bookmarks, sync, search+sorter, folder panel, settings
- Cross-device file move fix (copy+delete fallback for trash operations)

### 8.4 Video Thumbnails & Playback ✅ Complete

Thumbnails are the initial card state; video playback layers on top via hover and play-lock.

- **Thumbnail generation** — ffmpeg frame extraction at 0s mark during scan, server-side. Cached to `appdata/thumbnails/video/<fingerprint>.jpg`. Input seeking (`-ss` before `-i`) for fast extraction even on large files. 30s timeout.
- **Skip-if-indexed** — scanner checks mtime before running ffprobe/ffmpeg. Unchanged files skip expensive extraction, only generating missing thumbnails. Re-index of already-indexed libraries takes seconds.
- **Thumbnail serving** — `GET /thumb/video/:fingerprint` route serves cached JPEGs.
- **Card rendering** — cards render `<img>` thumbnail by default; hidden `<video>` element loads lazily on hover or play-lock. Fallback to direct `<video>` for videos without thumbnails.
- **Playback states:** `thumbnail` → hover → `playing` (muted) → click play-lock → `locked` (with audio, volume from settings) → click again → `thumbnail`
- **Volume control** — global volume slider in video settings sidebar, applied to play-locked cards and fullscreen viewer.

### 8.5 Metadata & Search Improvements

The metadata and search system is ~70% there. Needs UX improvements and better extraction/presentation:
- Improved metadata presentation in the viewer panel
- Search UX — autocomplete, recent searches, visual feedback
- Bookmarking and god filters management polish
- Additional metadata parsers — expand tool detection, handle edge cases
- Video generation metadata — ComfyUI video nodes, AnimateDiff, Wan, HunyuanVideo

### 8.6 Tag System Improvements

Design principles:
- Tags stored on the file (XMP for images, `.json` sidecar for video) — DB is always reconstructable
- Case-insensitive, trimmed
- Same `tag:tagname` syntax across both libraries

Planned:
- **Tag autocomplete** — suggest existing tags when typing
- **Tag management view** — list all tags with usage counts, rename, merge, delete
- **Bulk tag operations** — apply/remove tags to entire search results, not just current selection
- **Video tag sidecar** — write video tags to `.json` sidecar alongside the video file

### 8.7 Metadata & Workflow Integration

- **Copy for tool** — "Copy for A1111", "Copy for ComfyUI", "Copy for Forge" buttons
- **Metadata comparison** — select two images, diff their metadata side by side
- **Batch metadata edit** — change model name, sampler, etc. across a selection

### 8.8 Training Dataset Tools *(future major update)*

Deferred. Will be tackled as a focused major update when the core library is stable.

### 8.9 Image & Video Editing *(future)*

Simple, non-destructive operations only.

- Crop / resize, rotate / flip (canvas-based)
- Video trim with ffmpeg (already available via Pinokio)
- Frame extraction — save specific frames as images

### 8.10 Agent API & Pinokio Integration

Breadboard is uniquely positioned to be the media intelligence layer for Pinokio's agent ecosystem. Pinokio 7 introduced agent-native architecture: any AI agent (Claude, Codex, Gemini, etc.) that supports `SKILL.md` can auto-discover and control Pinokio apps. Breadboard's metadata search, tag system, and file operations are exactly the capabilities agents need to organize and retrieve AI-generated media.

**Why this matters:**
An agent can ask Breadboard "find every image generated with LoRA X" or "tag all images with prompt containing 'portrait' as 'portrait-dataset'" or "move all images tagged 'reject' to a trash folder" — all without human intervention. This turns Breadboard from a manual browsing tool into a programmable media library that agents can query and manipulate as part of larger workflows (training dataset curation, batch re-generation, portfolio assembly, etc.).

**What already exists:**
Breadboard runs an Express HTTP server. There's already a `POST /ipc` endpoint that the renderer uses to call any registered IPC handler (`subscribe`, `sync`, `del`, `gm`, `xmp`, `defaults`). There's a `/file?file=<path>` endpoint for serving files. The video system has `/video/:fingerprint` for streaming. The search system, tag system, and metadata extraction all work. The bones are there.

**What needs to be built:**

Phase 1 — REST API layer:
- `GET /api/images/search?q=<query>` — execute a search query, return JSON results (same syntax as the search bar)
- `GET /api/images/:fingerprint` — get full metadata for one image
- `GET /api/images/:fingerprint/file` — serve the image file
- `GET /api/images/:fingerprint/thumbnail` — serve a thumbnail (once image thumbnails exist)
- `POST /api/images/tags` — add tags to images by fingerprint `{ fingerprints: [...], tags: [...] }`
- `DELETE /api/images/tags` — remove tags from images
- `GET /api/images/tags` — list all tags with counts
- `POST /api/images/move` — move files to a new directory `{ fingerprints: [...], destination: "..." }`
- `POST /api/images/copy` — copy files to a new directory
- `GET /api/videos/search?q=<query>` — same for video library
- `GET /api/videos/:fingerprint` — video metadata
- `GET /api/videos/:fingerprint/stream` — video file streaming
- `POST /api/videos/tags` — add tags to videos
- `GET /api/folders` — list connected folders (image and video)
- `POST /api/folders/images` — connect a folder for images
- `POST /api/folders/videos` — connect a folder for videos
- `POST /api/reindex` — trigger re-index of a folder or all folders
- `GET /api/status` — app status, version, connected folders, library counts

Phase 2 — SKILL.md:
Create a `SKILL.md` file in the project root that describes Breadboard's capabilities to Pinokio's agent system. This follows the open `SKILL.md` specification: YAML frontmatter with name/description, followed by markdown instructions that tell the agent what tools are available, what parameters they accept, and example usage patterns. Pinokio auto-discovers this and makes it available to any connected agent.

Phase 3 — Agent-friendly responses:
- All API responses include enough context for an agent to act on results (file paths, fingerprints, metadata, tag lists)
- Search results include pagination for large result sets
- Error responses are descriptive enough for an agent to self-correct
- Bulk operations return per-item success/failure so agents can handle partial failures

**Design principles for the agent API:**
- The REST API is a thin layer over the same logic the UI uses — not a separate system
- Same search syntax as the search bar — agents and humans use the same query language
- Stateless — no session management needed for API calls (unlike the Socket.IO renderer connection)
- The API is local-only (localhost) — never bound to `0.0.0.0` or exposed to the network
- All API access requires a per-session token generated at app startup and displayed to the user — no open endpoints
- Write operations (tag, move, delete) are gated behind a configurable permission model: the user can set the API to read-only, read+tag, or full access in Settings
- Destructive operations (delete, move) require an additional confirmation token or are disabled by default in the API — agents must not be able to silently delete a user's files
- The SKILL.md file advertises only the permission level the user has enabled — an agent never sees capabilities it can't use
- No file content or metadata is ever sent to external services — the API serves the local agent only
- API access is logged to `appdata/logs/api.log` so the user can audit what agents have done

---

## 9. UI/UX Principles

These guide all UI decisions.

**Privacy-first, always**
A user's generated images and video are personal creative work. They must never be accessible without explicit user consent. All data stays local. No telemetry, no analytics, no external calls except the optional GitHub update check. The Express server binds to `localhost` only — never exposed to the network unless the user explicitly enables sharing. The agent API (§8.9) is localhost-only and requires the user to have started the app. Any future feature that could expose files or metadata externally (cloud sync, sharing, remote access) must be opt-in with clear, informed consent. This is non-negotiable.

**Progressive disclosure**
Show the minimum needed. Expand on demand. The card shows prompt + tags by default; technical metadata is hidden behind "Show Details". The fullscreen viewer is one click away.

**Non-destructive**
Never modify source files without explicit user action. Tags are written to XMP but the original image data is untouched. Delete requires confirmation.

**Keyboard-first**
Power users navigate with keyboard. All core actions have shortcuts. Selection, expansion, viewer navigation, deletion — all keyboard accessible.

**Scale is a first-class requirement, not an afterthought.**
The app must handle 100k+ images and 10k+ videos without degrading. Virtual scrolling, server-side queries (SQLite), incremental sync, and lazy thumbnail loading are baseline requirements, not optimizations. IndexedDB failed this test at scale; SQLite passes it.

**Consistent search**
The same query syntax works everywhere — main search bar, URL params, bookmarks, god filters. No special cases.

**File system is the source of truth**
The database is a cache. Re-indexing always produces the same result. Tags survive re-index because they're on the files.

**Cross-platform by default**
The app runs on Windows, Linux, and macOS. Every file system operation must use `path.join()` / `path.resolve()` — never hardcode `/` or `\\` separators. Use `path.sep` or `path.normalize()` when comparing or displaying paths. Use Node.js `fs.promises` for all file operations (mkdir, rename, copy, unlink) — never shell commands like `mv`, `cp`, `mkdir`. Test path handling with both forward and backslash inputs. Be aware of platform differences: case-sensitive filesystems (Linux) vs. case-insensitive (Windows, macOS default), max path length (260 chars on older Windows), and reserved filenames (`CON`, `NUL`, etc. on Windows). Electron APIs like `dialog.showOpenDialog` handle platform differences automatically — prefer them over manual path construction for user-facing folder selection.

---

## 10. Component Reference

### Server-side (app/server/)

| File | Role |
|------|------|
| `index.js` | `BreadboardServer` class — Express, Socket.IO, Chokidar, settings |
| `ipc.js` | IPC handler registry: `subscribe`, `sync`, `del`, `gm`, `xmp`, `defaults` |
| `basicauth.js` | Optional HTTP basic auth for web/server mode |
| `video-database.js` | SQLite video library — CRUD, tags, ratings, fingerprinting |
| `video-scanner.js` | Scans directories for video files, ffprobe for metadata, ffmpeg for thumbnails |
| `video-watcher.js` | Chokidar watcher for video directories |
| `updater/index.js` | Checks GitHub releases feed for updates |
| `crawler/parser.js` | Universal metadata parser — detects tool, normalizes to XMP |
| `crawler/standard.js` | A1111, InvokeAI, NovelAI, etc. |
| `crawler/diffusionbee.js` | DiffusionBee-specific parser |
| `crawler/exifr.umd.js` | EXIF extraction library |

### Client-side (app/public/modules/)

| File | Role |
|------|------|
| `app.js` | Main controller — sync orchestration, draw loop, settings init |
| `api.js` | REST API + Socket.IO communication layer (images + videos) |
| `navbar.js` | Search bar, sort selector, favorites, view options, notifications |
| `handler.js` | Click handlers — card expand/collapse, favoriting, viewer launch |
| `card.js` | Card HTML template function — renders metadata, tags, action buttons |
| `selection.js` | Multi-select — drag-select (ds.js), ctrl/shift click, keyboard |
| `zoomer.js` | Responsive card sizing based on zoom setting |

### Client-side (app/public/video-modules/)

| File | Role |
|------|------|
| `main.js` | Full video gallery controller — grid rendering, fullscreen viewer with pan/zoom, settings sidebar, folder panel, multi-select, scan progress, hover-to-play, play-lock |

### Styles (app/public/)

| File | Role |
|------|------|
| `global.css` | All shared styles — nav, footer, viewer overlay, settings sidebar, folder panel, confirm dialog, card layout, themes |
| `videos.css` | Video-specific styles — video card, thumbnail/video layering, selection highlight, play-lock indicator, sorter theme fix |

### Views (app/views/)

| File | Route | Purpose |
|------|-------|---------|
| `index.ejs` | `/` | Main image gallery |
| `videos.ejs` | `/videos` | Video gallery |
| `settings.ejs` | `/settings` | Folder management, theme, re-index |
| `connect.ejs` | `/connect` | Folder connection wizard |
| `favorites.ejs` | `/favorites` | Bookmarked searches |
| `viewer.ejs` | `/viewer` | Fullscreen image viewer |
| `video-viewer.ejs` | `/video-viewer` | Fullscreen video player |
| `screen.ejs` | `/screen` | Slideshow mode |
| `help.ejs` | `/help` | Community links |
| `card.ejs` | `/card` | Pop-out card detail window |

### Third-party libraries (client)

| Library | Purpose |
|---------|---------|
| Viewer.js | Image zoom/pan/rotate |
| Socket.IO client | Real-time updates |
| Tippy.js | Tooltips |
| Tom Select | Dropdown selectors |
| Tagger.js | Tag input |
| Hotkeys.js | Keyboard shortcuts |
| Timeago.js | Relative timestamps |
| Font Awesome | Icons |
| ds.js | Drag-select |
| Nanobar.js | Progress bar |

---

## 11. Videoswarm Reference — What to Adopt

The `videoswarm_cloned_in_for_reference/` directory contains a React/Vite Electron app with a more mature video handling implementation. We don't adopt its architecture (React vs. vanilla JS), but these specific pieces are worth porting:

**`main/fingerprint.js`** — Better fingerprinting than our current implementation. Samples both head AND tail of file (64KB each), includes `createdMs` in the hash, produces a versioned fingerprint string (`v1-<size>-<created>-<hash>`). More collision-resistant for large video files.

**`main/thumb-cache.js`** — Disk-backed thumbnail cache with LRU eviction, signature-based lookup, and scheduled persistence. The architecture is solid. Port the cache logic, adapt to our server structure.

**`src/services/thumbService.js`** — Canvas-based thumbnail generation with a task queue, debouncing, and `waitForStableFrame` logic. This is the right approach for renderer-side thumbnail generation without ffmpeg dependency.

**`main/watcher.js`** — More robust than our `video-watcher.js`. Has polling fallback when native fs events fail (EMFILE/ENOSPC), per-file change debouncing, and EventEmitter-based API. Worth adopting for both image and video watching.

**`main/database.js`** — Has corruption detection, archive-on-corruption, and profile migration. Overkill for now but the corruption handling pattern is worth noting.

---

## 12. Development Principles

**Don't unify what should stay separate.** Images and video serve different workflows and are intentionally separate views. Don't add complexity trying to merge them. They share folder management, tag namespace, and search syntax — that's enough.

**The database is a cache.** Never store anything in the DB that can't be reconstructed from the files. Tags go on files. Metadata goes on files. The DB is for fast querying only.

**Fingerprint over path.** File paths change. Fingerprints don't. New features should use fingerprint-based identity where possible.

**No ffmpeg hard dependency** is no longer a constraint — Pinokio ships ffmpeg on PATH. ffprobe should be used for video metadata extraction and ffmpeg for thumbnail frame extraction and future video editing features. No fallback needed for Pinokio users.

**Keep the search syntax stable.** Users build workflows around search queries (bookmarks, god filters, URL sharing). Don't break the syntax. Extend it additively.

**Minimal dependencies.** The node_modules situation is already large. Prefer using what's already in the stack before adding new packages.

**Match the existing code style.** Vanilla JS, class-based modules, EJS templates. Don't introduce build steps, transpilation, or frameworks into the existing codebase without a strong reason.

---

## 13. Resolved Decisions

These were open questions, now closed.

**1. Video tag sidecar format** — `.json` sidecar alongside the video file. ✅

**2. Video thumbnail generation** — ffmpeg/ffprobe via PATH. Pinokio ships with ffmpeg preinstalled, so it's available to all users. Use ffprobe for metadata extraction and ffmpeg for frame extraction. This is the right tool for the job and will be useful for future video editing features too. ✅

**3. Folder management UX** — Separate folder lists and separate entry points for images and video. Decided:
- The video view's "Select Folder" button in the top bar is the right pattern — keep it and apply the same pattern to images
- Move folder connection out of Settings for images: add a "Connect Folder" button directly in the image gallery top bar (matching video UX)
- Settings shows currently connected folders only, with disconnect buttons
- Image folders and video folders are displayed as separate lists in Settings — a folder can be connected to both independently (important for mixed-output directories where a user wants image browsing AND video browsing from the same path)
- Settings is for management (view + disconnect), not for initial connection ✅

**4. Dataset tools** — Deferred to a future focused major update. Not in scope for current development. ✅

**5. Image DB migration** — No migration of existing data needed. App is pre-release; implement SQLite from scratch. Fresh install only. ✅

---

*Last updated: April 2026*
*Image tab and video tab UI/UX redesigns complete. Video thumbnails implemented. Metadata & search improvements are next.*
