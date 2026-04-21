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

### What's working
- Electron app, fully portable (all data in `./appdata/`)
- Express + Socket.IO server on a dynamic port
- Image gallery: PNG, JPG, JPEG, WebP, GIF, BMP, TIFF
- Metadata extraction from: Automatic1111, InvokeAI, DiffusionBee, Imaginairy, NovelAI, Sygil, generic `.txt` sidecar
- XMP normalization — metadata is written back to files in a standard format
- IndexedDB (via Dexie) for the image library — fast, client-side
- Virtual scrolling (Clusterize.js) for large libraries
- Full search system with hyperfilter syntax (see §5)
- Tag system — user tags stored in XMP on the file itself, so they survive re-index
- Multi-select with drag-select and keyboard shortcuts
- Bulk operations: add tags, remove tags, delete files, re-index
- Favorites / bookmarked searches
- God filters (global background filters)
- Fullscreen image viewer (Viewer.js)
- Pop-out windows
- Dark/light theme
- Live mode (real-time updates as new files appear)
- Video section: separate `/videos` route with its own SQLite database (`better-sqlite3`), scanner, watcher, and card UI

### What's partially implemented
- **Video section** — functional with its own SQLite database, UI, and folder management. Tags exist in the video DB but are not yet connected to the shared tag namespace. Folder management UX needs the overhaul described in §8.2.
- **Video thumbnails** — no thumbnail generation yet; relies on browser-native video rendering
- **Metadata for video** — only file system metadata (size, dimensions via ffprobe if available, duration). No generation metadata extraction.
- **Card UI** — recently improved (collapsible metadata, tags prominent), but still has rough edges

### What's missing
- Video thumbnail generation and caching
- Generation metadata for video (ComfyUI video nodes, AnimateDiff, etc.)
- Training dataset tools (LoRA dataset curation)
- Simple image/video editing
- Batch export / format conversion
- Advanced filtering UI (visual query builder)
- Collections / albums beyond the tag system

### Known issues
- Update check throws `Entity expansion limit exceeded: 1159 > 1000` (non-critical, cosmetic)
- Video and image folder management are separate entry points — needs the UX overhaul in §8.2
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
  │     ├── app.js       — main controller, DB init, sync orchestration
  │     ├── api.js       — HTTP + Socket.IO communication
  │     ├── db.js        — IndexedDB init (Dexie)
  │     ├── navbar.js    — search bar, sort, filters, favorites
  │     ├── handler.js   — click handlers, card expand/collapse
  │     ├── card.js      — card HTML template
  │     ├── selection.js — multi-select (drag, ctrl, shift)
  │     └── zoomer.js    — responsive card sizing
  ├── Video gallery: app/views/videos.ejs + app/public/video-modules/main.js
  └── Other views: settings, connect, favorites, help, viewer, screen
```

### Data stores

**Image library — SQLite via better-sqlite3 (target state)**
See §6 for the migration decision and rationale. The current state uses IndexedDB/Dexie.

```
images      — fingerprint (PK), file_path, root_path, filename,
              agent, model_name, model_hash, prompt, negative_prompt,
              sampler, steps, cfg_scale, seed, input_strength,
              width, height, aesthetic_score,
              controlnet_module, controlnet_model, controlnet_weight,
              controlnet_guidance_strength, btime, mtime, indexed_at
tags        — id, name (UNIQUE COLLATE NOCASE)
image_tags  — fingerprint, tag_id, added_at
settings    — key, val
folders     — path, added_at
checkpoints — root_path, btime (incremental sync state)
favorites   — query, label, is_global, created_at
```

**Video library — SQLite via better-sqlite3 (current)**
```
videos      — fingerprint (PK), file_path, filename, size,
              width, height, duration, aspect_ratio,
              created_at, modified_at, indexed_at
tags        — id, name (UNIQUE COLLATE NOCASE)
video_tags  — fingerprint, tag_id, added_at
ratings     — fingerprint, value (0-5)
```

**XMP metadata files — filesystem (gmgm library)**
```
appdata/breadboard/gm/
  agent/  — auto-extracted metadata (one .xmp file per image, keyed by CID)
  user/   — user tags (same structure)
```

### Key design decisions

**Why SQLite for both libraries?**
IndexedDB (the current image store) has well-documented performance problems at scale. Bulk inserts of 30k records can take minutes. Full-table scans for complex queries are slow and block the renderer thread. SQLite with WAL mode handles hundreds of thousands of rows with sub-millisecond indexed queries, runs on the server side (no renderer blocking), and gives us proper SQL for the complex filtering the search system needs. `better-sqlite3` is the right choice: synchronous API (no callback hell), fastest Node.js SQLite binding, prebuilt binaries for Win/Mac/Linux x64 and arm64 via `electron-builder`'s `postinstall` rebuild. The native rebuild is a one-time setup cost, not an ongoing burden.

**Why XMP on files?**
Tags and metadata are written back to the source files in XMP format. This means user tags survive a full re-index — the database is always reconstructable from the files themselves. This is a strong design principle to preserve. The database is a cache; the files are the truth.

**Why fingerprint-based IDs?**
The video database already uses SHA-256 fingerprinting (head + tail sampling + size + mtime). The image library currently uses file path as PK — a known weakness. When a file is renamed or moved, it loses its DB record. The migration to SQLite is the right time to fix this for images too. Fingerprint = stable identity across renames and moves.

**Why keep image and video as separate SQLite databases?**
They serve different views with different schemas, different metadata, and different workflows. A single DB would add complexity with no user-facing benefit. Two separate `.sqlite` files in `appdata/` is clean, simple, and independently resettable.

---

## 4. Metadata System

### Image metadata pipeline

```
File detected by Chokidar
  → parser.js detects source app
  → appropriate crawler extracts raw metadata
  → normalized to XMP schema
  → written to appdata/breadboard/gm/agent/<cid>.xmp
  → broadcast via Socket.IO
  → renderer inserts into IndexedDB
  → card rendered in gallery
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

Tags are stored as `tag:tagname` entries in the `tokens` array in IndexedDB, and mirrored in the XMP `dc:subject` bag on the file. This dual-write is what makes re-index non-destructive.

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

## 6. The Database Migration — The Foundational Decision

This is the most important architectural decision in the near-term roadmap. Everything else builds on it.

### The problem with IndexedDB at scale

The image library currently uses IndexedDB via Dexie.js. This works fine for small libraries but has hard limits:

- Bulk inserts of 30k records can take several minutes (documented Dexie issue)
- Full-table scans for complex queries run on the renderer thread — they block the UI
- No server-side query layer — all filtering happens in a Web Worker, which is limited
- The `tokens[]` array approach for search is a workaround for the lack of proper SQL
- IndexedDB storage can balloon unpredictably (Chromium's LevelDB underneath)
- No WAL mode, no VACUUM, no fine-grained indexing control

For a user with 50k+ images — which is normal for this community — this is a real problem, not a theoretical one.

### The solution: better-sqlite3 for images too

Migrate the image library from IndexedDB to SQLite (`better-sqlite3`), matching the video library's approach. This gives us:

- Sub-millisecond indexed queries on 500k+ rows
- WAL mode for concurrent reads during writes (no UI blocking during sync)
- Proper SQL for the complex multi-field filtering the search system needs
- Server-side query execution — renderer just receives results
- Predictable storage size
- Fingerprint-based PKs (fix the rename/move problem at the same time)
- One consistent data layer for both libraries

**On the native module concern:** `better-sqlite3` requires a native rebuild per Electron version. This is handled automatically by `electron-builder`'s `postinstall` hook (`electron-builder install-app-deps`), which is already in `package.json`. Prebuilt binaries exist for Win/Mac/Linux x64 and arm64. This is a solved problem in the Electron ecosystem — VS Code, Obsidian, and many other major Electron apps use `better-sqlite3`.

### Migration plan (high level)

1. Build the new SQLite image schema (modeled on the video DB, with image-specific fields)
2. Build a server-side query API that mirrors the current IPC interface
3. On first launch after update: detect existing IndexedDB data, offer migration or fresh re-index
4. For Pinokio users (fresh installs): no migration needed, just re-index
5. Keep XMP files as the source of truth — re-index always works from files

### What stays the same

- XMP metadata on files (tags survive re-index)
- The search query syntax (same syntax, now executed as SQL)
- The IPC/Socket.IO communication pattern
- Virtual scrolling and card rendering in the renderer
- All existing UI behavior

### Current state

The image library is still on IndexedDB. The video library is on SQLite. The migration is the next major foundational task before building new features on top of the image library.

---

## 7. Other Technical Debt

### Medium priority

**Video thumbnails missing**
The video gallery renders `<video>` elements directly — no thumbnail generation. For large libraries this is a performance problem. The videoswarm reference project has a solid thumbnail cache implementation using canvas-based frame capture. The hover-to-play and click-to-lock behavior must be preserved — thumbnails are the initial state, video plays on hover, locks on click.

**Video folder management is separate from image folder management**
Users currently manage two separate folder lists with different UX patterns. The folder management overhaul (§8.2) will give both views a consistent "Connect Folder" button in the top bar, with Settings showing both lists for management and disconnect. Folders can be independently connected to either or both libraries.

**Update check entity expansion error**
`fast-xml-parser` entity expansion limit needs to be raised to ~2000 in the updater config. One-line fix.

**No video generation metadata**
ComfyUI video nodes (AnimateDiff, Wan, HunyuanVideo, etc.) embed metadata in video files or sidecar JSON. This should be extracted and indexed once the video DB is stable.

### Low priority

**Card UI rough edges**
The "View XML" button was removed in the recent card refactor but the XMP viewer functionality still exists. The tag input UX needs polish. These are cosmetic and can be addressed incrementally.

---

## 8. Feature Roadmap

Features are grouped by theme. The database migration (§6) is a prerequisite for most image library work and should happen first.

### 8.1 Database Migration (prerequisite)

- Migrate image library from IndexedDB/Dexie to SQLite/better-sqlite3
- Fingerprint-based PKs for images (fix rename/move identity loss)
- Server-side query API replacing the Web Worker search approach
- Fresh install only — no migration of existing IndexedDB data needed

### 8.2 Folder Management UX Overhaul

- Add "Connect Folder" button directly in the image gallery top bar (matching the video view's "Select Folder" pattern)
- Remove folder connection from Settings — Settings becomes management-only (view connected folders, disconnect)
- Settings displays image folders and video folders as separate lists
- A folder can be independently connected to both image and video libraries (for mixed-output directories)

### 8.3 Video Thumbnails & Playback

The current hover-to-play, click-to-lock behavior is a keeper. Thumbnails are the initial state; the playback behavior layers on top.

- **Thumbnail generation** — ffmpeg frame extraction at ~1s mark, server-side. Cached to `appdata/thumbnails/video/`, fingerprint-keyed
- **Thumbnail cache** — disk-backed with LRU eviction (reference: videoswarm `thumb-cache.js`)
- **Lazy loading** — generate thumbnails only for visible cards (IntersectionObserver)
- **Playback states:** `thumbnail` → hover → `playing` → click → `locked` → click again → `thumbnail`

### 8.4 Tag System Improvements

Design principles:
- Tags stored on the file (XMP for images, `.json` sidecar for video) — DB is always reconstructable
- Case-insensitive, trimmed
- Same `tag:tagname` syntax across both libraries

Planned:
- **Tag autocomplete** — suggest existing tags when typing
- **Tag management view** — list all tags with usage counts, rename, merge, delete
- **Bulk tag operations** — apply/remove tags to entire search results, not just current selection
- **Video tag sidecar** — write video tags to `.json` sidecar alongside the video file

### 8.5 Video Metadata

- **ComfyUI video metadata** — parse workflow JSON from sidecar or embedded metadata
- **AnimateDiff / Wan / HunyuanVideo** — detect and extract generation params
- **Basic video fields** — duration, fps, codec, resolution always shown in expanded card
- **ffprobe** — already available via Pinokio PATH; use for metadata extraction

### 8.6 Metadata & Workflow Integration

- **Copy for tool** — "Copy for A1111", "Copy for ComfyUI", "Copy for Forge" buttons
- **Metadata comparison** — select two images, diff their metadata side by side
- **Batch metadata edit** — change model name, sampler, etc. across a selection

### 8.7 Training Dataset Tools *(future major update)*

Deferred. Will be tackled as a focused major update when the core library is stable.

### 8.8 Image & Video Editing *(future)*

Simple, non-destructive operations only.

- Crop / resize, rotate / flip (canvas-based)
- Video trim with ffmpeg (already available via Pinokio)
- Frame extraction — save specific frames as images

### 8.9 Agent API & Pinokio Integration

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
| `video-scanner.js` | Scans directories for video files, calls ffprobe optionally |
| `video-watcher.js` | Chokidar watcher for video directories |
| `updater/index.js` | Checks GitHub releases feed for updates |
| `crawler/parser.js` | Universal metadata parser — detects tool, normalizes to XMP |
| `crawler/standard.js` | A1111, InvokeAI, NovelAI, etc. |
| `crawler/diffusionbee.js` | DiffusionBee-specific parser |
| `crawler/exifr.umd.js` | EXIF extraction library |

### Client-side (app/public/modules/)

| File | Role |
|------|------|
| `app.js` | Main controller — DB init, sync orchestration, live updates, draw loop |
| `api.js` | HTTP + Socket.IO communication layer |
| `db.js` | IndexedDB init via Dexie — schema, migrations |
| `navbar.js` | Search bar, sort selector, favorites, view options, notifications |
| `handler.js` | Click handlers — card expand/collapse, favoriting, viewer launch |
| `card.js` | Card HTML template function — renders metadata, tags, action buttons |
| `selection.js` | Multi-select — drag-select (ds.js), ctrl/shift click, keyboard |
| `zoomer.js` | Responsive card sizing based on zoom setting |

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
| Dexie.js | IndexedDB wrapper |
| Clusterize.js | Virtual scrolling |
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
*Reflects codebase state after: Phase 1 (breadmachine inlined), Phase 2 (deps updated), video system added, card UI improved, localization complete*
