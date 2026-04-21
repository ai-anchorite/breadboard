# Breadboard — Agent Context

## What this project is

Breadboard is an Electron desktop app for browsing, searching, and organizing AI-generated images and video. It's distributed via Pinokio to the Stable Diffusion community — users with massive output libraries from tools like Automatic1111, ComfyUI, InvokeAI, and similar. The full design, architecture, and roadmap live in `DESIGN.md`. **Read it before making any significant decision.**

The app is pre-release and under active development. There are no existing users to break.

---

## Project orientation

```
/
├── DESIGN.md                        ← source of truth, read this first
├── app/                             ← the Electron application
│   ├── main.js                      ← Electron main process
│   ├── preload.js                   ← renderer bridge
│   ├── server/                      ← Express + Socket.IO backend
│   │   ├── index.js                 ← BreadboardServer class
│   │   ├── ipc.js                   ← IPC handler registry
│   │   ├── video-database.js        ← SQLite video library (better-sqlite3)
│   │   ├── video-scanner.js         ← video file scanner (ffprobe)
│   │   ├── video-watcher.js         ← Chokidar watcher for video dirs
│   │   └── crawler/                 ← image metadata extraction
│   │       ├── parser.js            ← universal parser, detects tool
│   │       ├── standard.js          ← A1111, InvokeAI, NovelAI, etc.
│   │       └── diffusionbee.js      ← DiffusionBee-specific
│   ├── public/                      ← frontend assets
│   │   ├── modules/                 ← image gallery JS modules
│   │   │   ├── app.js               ← main controller
│   │   │   ├── card.js              ← card HTML template
│   │   │   ├── handler.js           ← click/interaction handlers
│   │   │   ├── navbar.js            ← search, sort, filters
│   │   │   ├── selection.js         ← multi-select
│   │   │   └── db.js                ← IndexedDB via Dexie (being replaced)
│   │   └── video-modules/main.js    ← video gallery controller
│   └── views/                       ← EJS templates
│       ├── index.ejs                ← image gallery (route: /)
│       ├── videos.ejs               ← video gallery (route: /videos)
│       └── settings.ejs             ← settings (route: /settings)
├── appdata/                         ← runtime data, gitignored
│   └── breadboard/gm/               ← XMP metadata files (per-image)
└── videoswarm_cloned_in_for_reference/  ← reference project, do not modify
```

**Tech stack:** Electron 39, Express, Socket.IO, Chokidar, better-sqlite3, Dexie (IndexedDB, being replaced), EJS templates, vanilla JS. No build step, no transpilation, no framework.

**Environment:** Pinokio ships ffmpeg and ffprobe on PATH. They are available and should be used for video work.

---

## Current state snapshot

The image library runs on **IndexedDB (Dexie)** — this is the next thing being replaced with SQLite. The video library already runs on **SQLite (better-sqlite3)**. The DB migration for images is the top priority in the roadmap (DESIGN.md §6 and §8.1).

The two libraries (image and video) are **intentionally separate** — different views, different schemas, different workflows. Do not attempt to unify them into a single view or database.

Key things that work and must not be broken:
- Search query syntax (DESIGN.md §5) — users build workflows around this
- Tag system — tags are written to XMP files on disk, survive re-index
- Virtual scrolling — Clusterize.js, required for large libraries
- Video hover-to-play / click-to-lock playback behavior

---

## Non-negotiable constraints

**Privacy-first.** A user's generated images and video are personal creative work. All data stays local. No telemetry, no analytics, no external network calls except the optional GitHub update check. The Express server binds to localhost only. The agent API requires a per-session token and user-configured permission levels. Any feature that could expose files externally must be opt-in with informed consent. See DESIGN.md §9 for the full privacy principle.

**Scale is a baseline requirement.** The app must handle 100k+ images and 10k+ videos. Any feature touching the data layer must be designed for this. IndexedDB is being replaced precisely because it fails at this scale.

**The database is a cache.** Tags and metadata live on the files (XMP for images, `.json` sidecar for video). The DB is reconstructable from files at any time. Never store user data only in the DB.

**Fingerprint over file path.** Use SHA-256 fingerprints (head+tail sampling) as primary keys, not file paths. Paths change; fingerprints don't.

**No mandatory build step.** The server side stays vanilla Node.js. Existing image gallery modules stay vanilla JS. For new complex UI (multi-state panels, tag manager, video gallery components) Preact or Alpine.js are approved options — both work without a build step via a single local script file. React, Vue, Svelte, and TypeScript all require build tooling and are not in scope. The choice between Preact and Alpine.js is made per-feature when the need arises.

**Cross-platform always.** The app targets Windows, Linux, and macOS equally. Use `path.join()` / `path.resolve()` for all paths — never hardcode separators. Use `fs.promises` for all file operations — never shell commands (`mv`, `cp`, `mkdir`). Be aware of case sensitivity (Linux), max path length (Windows), and reserved filenames (Windows). See DESIGN.md §9 for the full principle.

**Keep the search syntax stable.** Extend it additively. Never break existing query syntax.

**Separate image and video concerns.** They share folder management UI, tag namespace, and search syntax. Everything else is independent.

**Agent-first API design.** Breadboard runs inside Pinokio, which has agent-native architecture (Pinokio 7+). Any feature that touches search, tags, or file operations should be accessible via the REST API (`/api/*`), not just the renderer UI. The API uses the same search syntax as the search bar — agents and humans share one query language. See DESIGN.md §8.9 for the full API design.

---

## Behavioral rules

### Think before coding
- **Check BACKLOG.md before starting any task.** It contains ideas and requirements that may affect the current work. If a backlog entry is relevant to the task at hand, factor it in — don't implement something that a high-priority backlog item would immediately change.
- **Reference DESIGN.md for architectural decisions.** If something contradicts it, flag it. If the design doc doesn't cover the situation, ask.
- State assumptions explicitly before implementing. If uncertain, ask.
- If multiple approaches exist, surface them with tradeoffs — don't pick silently.
- If a simpler approach exists, say so.

### Write clean code
- We're building a modern app on old bones. Rewriting, pruning, and improving existing code is expected and encouraged — don't preserve old patterns just because they exist.
- Write the code you'd want to maintain in a year. Clear names, consistent patterns, no clever tricks.
- Minimum code that solves the problem. No speculative features, no abstractions for single-use code.
- If you write 200 lines and it could be 50, rewrite it.
- When touching a file, it's fine to clean up the code around your changes if it improves clarity — but stay focused on the task. Don't turn a tag feature into a full module rewrite.

### Be deliberate about scope
- For focused tasks (fix a bug, add a field): change what's needed, verify it works.
- For larger tasks (DB migration, new feature): state a plan first, work through it step by step, verify at each stage.
- If a task reveals that adjacent code needs rework to do it properly, say so and propose the scope expansion — don't silently refactor or silently work around it.
- Remove dead code, unused imports, and orphaned functions when you encounter them — don't leave debris.

### Verify your work
For multi-step tasks, state a brief plan before starting:
```
1. [step] → verify: [how to confirm it worked]
2. [step] → verify: [how to confirm it worked]
```
Define what "done" looks like before writing code.

### Update the changelog
After completing any task that adds, changes, or removes functionality, add an entry to `CHANGELOG.md` under the `[Unreleased]` section. This project is a fork being returned to the original developer and transferred to the pinokiofactory organization — the changelog is how they understand what we've done. Be specific: name the files, the feature, and the user-facing impact.

---

## Common tasks — where to look

| Task | Files to read first |
|------|-------------------|
| Add a new image metadata field | `server/crawler/parser.js`, `server/crawler/standard.js` |
| Change card layout or displayed fields | `app/public/modules/card.js`, `app/public/global.css` |
| Add a search filter or sort option | `app/public/modules/navbar.js`, `app/public/worker.js` |
| Add a click handler or card interaction | `app/public/modules/handler.js` |
| Add an IPC command (server↔renderer) | `app/server/ipc.js`, `app/public/modules/api.js` |
| Change video DB schema or queries | `app/server/video-database.js` |
| Change video scanning or watching | `app/server/video-scanner.js`, `app/server/video-watcher.js` |
| Change settings UI | `app/views/settings.ejs` |
| Add a new route/view | `app/server/index.js`, `app/views/` |
| Change Electron window behavior | `app/main.js` |
| Understand the image DB migration | `DESIGN.md §6` |
| Understand the full roadmap | `DESIGN.md §8` |
| Understand the agent API design | `DESIGN.md §8.9` |

---

## What not to do

- Don't touch `videoswarm_cloned_in_for_reference/` — it's a read-only reference
- Don't add new npm packages without checking if the need can be met by existing dependencies
- Don't introduce React, Vue, Svelte, or TypeScript — all require a build step
- Don't add a build step or bundler to the project
- Don't unify the image and video views or databases
- Don't store user-facing data (tags, favorites, settings) only in the database
- Don't break the search query syntax
- Don't use `file_path` as a primary key for new features — use fingerprints
- Don't bind the Express server to `0.0.0.0` or any non-localhost address
- Don't add telemetry, analytics, or any external network calls
- Don't expose file paths, metadata, or file content to external services
- Don't allow API write operations (delete, move) without the user's configured permission level
- Don't hardcode path separators (`/` or `\\`) — use `path.join()` / `path.resolve()`
- Don't use shell commands for file operations — use `fs.promises` (mkdir, rename, cp, unlink)
- Don't run `npm run dev` or any long-running watcher — tell the user to run it manually
