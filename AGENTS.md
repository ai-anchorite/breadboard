# Breadboard — Agent Behaviour

> Project context, architecture, roadmap, and current state live in `DESIGN.md`. Read it before making any significant decision.

---

## Non-negotiable constraints

**Privacy-first.** All data stays local. No telemetry, no analytics, no external network calls except the optional GitHub update check. The Express server binds to localhost only. Any feature that could expose files externally must be opt-in with informed consent.

**Scale is a baseline requirement.** The app must handle 100k+ images and 10k+ videos. Every feature touching the data layer must be designed for this.

**The database is a cache.** Tags and metadata live on the files (XMP for images, `.json` sidecar for video). The DB is reconstructable from files. Never store user data only in the DB.

**Fingerprint over file path.** Use SHA-256 fingerprints (head+tail sampling) as primary keys. Paths change; fingerprints don't.

**No mandatory build step.** Vanilla Node.js server, vanilla JS frontend, EJS templates. No React, Vue, Svelte, TypeScript, transpilation, or bundlers.

**Cross-platform always.** Use `path.join()` / `path.resolve()` for all paths. Use `fs.promises` for file operations — never shell commands. Be aware of case sensitivity (Linux), max path length (Windows), reserved filenames.

**Keep the search syntax stable.** Extend it additively. Never break existing queries.

**Separate image and video concerns.** Different views, different schemas, different workflows. They share folder management, tag namespace, and search syntax only.

---

## Behavioural rules

### Think before coding
- Check `BACKLOG.md` before starting — relevant ideas may affect the current task.
- Reference `DESIGN.md` for architectural decisions. Flag contradictions.
- State assumptions explicitly. If uncertain, ask.
- Surface multiple approaches with tradeoffs — don't pick silently.
- If a simpler approach exists, say so.

### Write clean code
- Rewriting and pruning old code is expected. Don't preserve inherited patterns just because they exist.
- Write code you'd want to maintain. Clear names, consistent patterns, no clever tricks.
- Minimum code that solves the problem. No speculative features, no abstractions for single-use code.
- If 200 lines could be 50, rewrite it.
- Remove dead code, unused imports, orphaned functions when you encounter them.

### Be deliberate about scope
- Focused tasks (bug fix, add a field): change what's needed, verify.
- Larger tasks (new feature, refactor): state a plan first, work step by step, verify at each stage.
- If adjacent code needs rework to do it properly, propose the scope expansion — don't silently refactor or work around it.

### Verify your work
For multi-step tasks, state a brief plan:
```
1. [step] → verify: [how to confirm it worked]
2. [step] → verify: [how to confirm it worked]
```
Define what "done" looks like before writing code.

### Update the changelog
After any task that adds, changes, or removes functionality, add an entry to `CHANGELOG.md` under `[Unreleased]`. Name the files, the feature, and the user-facing impact.

---

## What not to do

- Don't add npm packages without checking if existing dependencies can meet the need
- Don't introduce React, Vue, Svelte, TypeScript, or any build step
- Don't unify the image and video views or databases
- Don't store user data only in the database — always persist to files
- Don't break the search query syntax
- Don't use `file_path` as a primary key — use fingerprints
- Don't bind Express to `0.0.0.0`
- Don't add telemetry, analytics, or external network calls
- Don't hardcode path separators — use `path.join()` / `path.resolve()`
- Don't use shell commands for file operations — use `fs.promises`
- Don't run `npm run dev` or long-running watchers — tell the user to run manually

---

## Common tasks — where to look

| Task | Files to read first |
|------|-------------------|
| Change card layout or displayed fields | `public/modules/card.js`, `public/global.css` |
| Change image viewer | `public/modules/handler.js`, `public/global.css` |
| Change image settings sidebar | `public/modules/navbar.js` (renderSettings) |
| Change folder management panel | `public/modules/navbar.js` (folder_panel) |
| Add a search filter or sort option | `public/modules/navbar.js`, `server/image-database.js` (_parseQuery) |
| Add a REST API endpoint | `server/index.js`, `public/modules/api.js` |
| Change video card layout or viewer | `public/video-modules/main.js`, `public/videos.css` |
| Change video settings sidebar | `public/video-modules/main.js` (renderSettings) |
| Change video folder panel | `public/video-modules/main.js` (initFolderPanel) |
| Change video scanning or watching | `server/video-scanner.js`, `server/video-watcher.js` |
| Add a new route/view | `server/index.js`, `views/` |
| Change Electron window behavior | `main.js` |
| Add image metadata field | `server/crawler/parser.js`, `server/crawler/standard.js`, `server/image-database.js` |
| Understand the full roadmap | `DESIGN.md §8` |
