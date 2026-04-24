# Backlog — Ideas & Shower Thoughts

> Dump ideas here as they come. No structure required. Date each entry. When an idea is promoted to a real task in DESIGN.md, remove it from here.

---

## Video Player Controls — Inline & Popout

**2026-04-24** — Full video player controls for both the inline fullscreen viewer and the popout player. The inline viewer currently has play/pause (Space), pan/zoom, left/right navigation, and info panel toggle. The popout player is a bare `<video>` element prototype. Both need to be brought up to a proper media player standard. This is a single cohesive feature area — the inline viewer gets the controls first, then the popout player mirrors them.

### Seek bar
The inline viewer has no seek bar. This is essential for video. HTML5 `<video>` provides `currentTime`, `duration`, and `buffered` — all the primitives are there. A custom seek bar goes in the toolbar row (which is already click-isolated from the close handler, so no pan/zoom/close conflicts). Shows elapsed/total time, scrub handle, buffered range indicator. Clicking anywhere on the bar seeks to that position. Dragging the handle scrubs. The seek bar is the single most important missing control.

### Volume controls in the viewer
A volume slider + mute toggle in the toolbar, next to the play/pause button. The volume state already exists (`this.volume` from settings). The viewer toolbar just needs the UI. Mute toggle is a speaker icon that cycles between volume levels (muted / low / high). Slider appears on hover or click of the speaker icon (compact, doesn't eat toolbar space). Consolidates the existing BACKLOG entry about mute/volume controls (2026-04-23).

### Mute toggle on play-locked cards
A mute button in the card header, visible only when the card is play-locked. Tight on space — a small speaker icon next to the play-lock button. Toggles mute on that specific card's `<video>` element. Independent of the global volume setting (mute is per-card, volume is global).

### Frame capture (save frame as PNG)
A toolbar button (camera icon) that captures the current video frame as a PNG. Implementation: draw the `<video>` element to an offscreen `<canvas>` via `drawImage()`, export with `canvas.toDataURL('image/png')`, trigger a download. This is client-side and instant — no server round-trip needed. The captured frame is exactly what's displayed, which is what i2v and upscale workflows want. A server-side ffmpeg approach (`ffmpeg -ss <time> -i <file> -frames:v 1 output.png`) could be added later for frame-exact extraction, but the canvas approach is the right MVP. Keyboard shortcut: `s` (save/snapshot).

### Frame advance / retreat
Step forward or backward by one frame while paused. HTML5 video has no native frame-step API, so the approach is: pause the video, then seek by `1/fps` seconds. This requires knowing the video's frame rate. **Dependency:** add `fps` (frame rate) to the video DB schema, extracted via ffprobe during scan (the `r_frame_rate` field). Fall back to 1/30 if fps is unknown. Keyboard shortcuts: `.` (forward one frame) and `,` (back one frame) — this matches VLC, DaVinci Resolve, and most NLEs. Frame step only works when paused; pressing `,`/`.` while playing first pauses, then steps. The frame counter or timecode could optionally display in the toolbar when stepping.

### Customizable keybinds (future)
Pencil this in as a future Settings category. All viewer keyboard shortcuts (play/pause, frame step, zoom, close, panel toggle, frame capture, navigation) should eventually be user-configurable. Store keybind mappings in settings. Not needed for the initial implementation — use sensible defaults first, add customization when users request it. This applies to both image and video viewers.

### Left-click behavior change for video viewer
Currently, click-release on the video area closes the viewer (matching the image viewer). For video, this conflicts with the instinct to click-to-pause. **Decided:** single click toggles play/pause; double-click or Esc closes the viewer. The X button in the toolbar also closes. This keeps everything on the mouse — important for users reclining with the keyboard out of reach. The image viewer keeps its existing click-to-close behavior (no playback state to conflict with). The drag-to-pan behavior is unaffected (drag detection already distinguishes click from drag via the 5px threshold). Double-click detection uses a standard ~300ms window; if the user single-clicks (pause) and then doesn't click again within the window, it stays paused. If they double-click, the pause is momentary and the viewer closes.

### Popout player redesign
Consolidates the existing BACKLOG entry (2026-04-24). The popout player should mirror the inline viewer's full control set: seek bar, volume, frame step, frame capture, pan/zoom, keyboard shortcuts. Key differences from inline: (a) standalone window with filename in the title bar, (b) no left/right navigation (it's a single video), (c) no info panel (or a minimal one), (d) multiple popout windows can be open simultaneously for multi-monitor viewing. The popout should be a purpose-built minimal player, not a full copy of the inline viewer — it doesn't need the metadata panel, navigation arrows, or card grid context. Themed to match the current app theme.

### Implementation order
1. Seek bar (highest impact, unblocks everything else)
2. Volume controls in viewer + mute on play-locked cards
3. Click-to-pause behavior change
4. Frame capture
5. Frame advance/retreat (requires fps in DB — do the schema change early, populate during next scan)
6. Popout player redesign (mirrors all of the above)

### Dependencies
- Frame advance/retreat requires `fps` column in the videos table, populated by ffprobe during scan
- Popout player redesign depends on all inline controls being finalized first
- No other cross-feature dependencies

---

## Viewer Meta Panel Default State Setting

**2026-04-24** — A settings toggle to control whether the metadata panel in the image and video viewers starts open or collapsed. Currently the panel is visible every time the viewer opens, and users who just want to browse media have to manually close it each time.

### Design
Two separate settings (image viewers have rich metadata worth seeing by default; video metadata is currently sparse):
- Image settings: `viewer_panel_default` = `open` | `closed`
- Video settings: `viewer_panel_default` = `open` | `closed`

When the viewer opens, read the setting and apply the `collapsed` class to the panel element if set to `closed`. The existing toggle button (i key / toolbar button) still works for per-session override — it just doesn't persist across viewer opens.

### Implementation
~10 lines per viewer. In `_openViewer` / `openViewer`: read the setting, then after building the overlay, apply `panel.classList.add('collapsed')` if the default is closed. Add a toggle row to each settings sidebar ("Default panel state: Open / Closed"). Store via the existing settings API (`/api/settings/` for images, `/api/video-settings/` for videos).

### Scope
Small, self-contained. No dependencies. Can be done alongside any other work.

---

## Library Organization Strategy — Bookmark Bar & Smart Folders

**2026-04-24** — The core organizational rethink. Currently both libraries dump all media into a single flat scrolling grid. The search/filter system is powerful but requires users to know what to search for. We need a layered organization strategy that makes the library browsable without requiring search expertise.

### The problem
A user with 20k images in one view is overwhelmed. The metadata and search system is the key to managing this, but it's currently "pull" only — the user has to construct queries. We need "push" organization that surfaces structure automatically and lets users build their own organizational layers.

### Proposed architecture: three layers

**Layer 1 — The "All Media" view (exists, stays as-is)**
The current flat grid with search/sort. This is the power-user view, the "inbox", the firehose. It remains the default landing page. Everything is here, searchable, sortable. No changes needed.

**Layer 2 — Bookmark bar (new, primary organizational UI)**
A horizontal bar below the nav showing saved searches as clickable chips/tabs. This is the main new UI element. Design reference: browser bookmark bars (Chrome, Firefox). Clicking a chip applies that search query and filters the grid. The bookmarked searches system already exists (`favorites` table, bookmark button in nav) — this is a new *presentation* for it, not new backend logic.

Layout:
- A horizontal row below the nav bar, always visible (with a setting to hide it)
- Each bookmark rendered as a compact chip: icon + label (e.g., `🏷 anime`, `📁 outputs/portraits`, `🎨 SDXL`)
- Overflow: horizontal scroll or a "more" dropdown for bookmarks that don't fit
- Right-click or long-press on a chip: edit label, delete, move to folder group
- A "+" button at the end to bookmark the current search (same as the existing star button, just more discoverable)
- Bookmark folders/groups: chips can be grouped under named headers (like Chrome bookmark folders). Clicking a folder header shows its children as a dropdown. This allows hierarchical organization without a sidebar.

The bookmark bar transforms the existing bookmarked searches from a hidden dropdown into a persistent, visible navigation layer. Users build their own organizational structure by saving searches and arranging them on the bar.

**Layer 3 — Auto-suggested smart folders (future refinement)**
The app could auto-generate bookmark suggestions based on indexed data:
- One per connected root folder (e.g., "ComfyUI outputs", "A1111 outputs")
- One per unique `agent` value
- One per high-frequency `model_name`
- Date-based: "Today", "This week", "This month"
- One per unique subfolder path (for users with organized directory structures)

These would appear as suggestions (e.g., a "Suggested bookmarks" section in the bookmark management UI) that the user can pin to the bar or dismiss. Not auto-pinned — the user controls what's on their bar.

### Folder-based grouping within the grid
Separate from the bookmark bar, a "Group by folder" view mode that inserts folder header dividers into the card grid. The data is already there — images have `subfolder`, videos have `root_path` + `file_path`. This would be a sort/view toggle (alongside the existing sort options) that groups cards by their source directory. Each group gets a collapsible header showing the folder path and card count. This is a rendering change only — no new data needed.

### Scope concern: auto-suggestion volume
A user who bulk-indexes a media folder with 100 subdirectories should not see 100 auto-pinned bookmarks. Auto-suggestions are strictly opt-in: they appear in a management UI (like Brave's bookmark manager) where the user can review and selectively pin. The bookmark bar only shows what the user explicitly puts there. The management UI can present suggestions grouped by type (folders, models, agents, dates) with counts, and the user picks what's useful. Browsers have solved this presentation problem — we can draw from Chrome/Brave/Firefox bookmark management patterns for the management UI.

### What this replaces
The existing "bookmarked filters" dropdown button in the nav. That button would become the bookmark bar toggle (show/hide the bar) or be removed entirely if the bar is always visible.

### Implementation order
1. Bookmark bar UI — render existing bookmarks as a horizontal chip bar below nav
2. Bookmark management — edit labels, reorder, delete from the bar
3. Bookmark folders/groups — hierarchical grouping on the bar
4. Group-by-folder view mode — folder header dividers in the card grid
5. Auto-suggested smart folders — analyze indexed data, suggest bookmarks

### Dependencies
- No backend changes for steps 1-3 (uses existing favorites/bookmarks API)
- Group-by-folder needs the `subfolder` field (images already have it; videos need it added — derive from `file_path` relative to `root_path`)
- Auto-suggestions need a query to aggregate unique values (agent, model_name, subfolder) with counts

---

## External Folder Management — Organize & Move Files

**2026-04-24** — The ability to create named folders within Breadboard's managed directory and move selected files into them. This is the "sort and organize" workflow: browse the bulk view, select/tag, move to organized folders, then drag the organized folders out via the OS file manager.

### Workflow
1. User creates a named folder (e.g., "portraits", "landscapes", "training-data") within Breadboard's managed space (`appdata/organized/` or similar)
2. Selects images/videos in the grid (multi-select already works)
3. Clicks "Move to folder" → picks a target folder from a dropdown or creates a new one
4. Files physically move via `fs.promises.rename()` (or copy+delete for cross-device)
5. DB records update with the new `file_path`
6. User can browse organized folders via the bookmark bar (auto-bookmark each managed folder) or via a dedicated "My Folders" section

### Why within the app's directory
Avoids the risk of the app permanently deleting or reorganizing files on the user's actual storage. The user explicitly moves files *into* Breadboard's space, organizes them there, then manually moves the organized folders out to wherever they want via their OS file manager. Breadboard never touches the user's source directories beyond reading them.

### Technical notes
- Moving files changes `file_path` but not `fingerprint` — DB update is a simple path change
- XMP sidecars (images) are keyed by fingerprint (CID), not path — they survive moves automatically
- Video tag sidecars (`.json`) would need to move alongside the video file
- **Post-move indexing ramifications:** if the user re-indexes the original source folder after moving files out, those files won't be found (correct — they're gone). If they re-index the managed folder, moved files are re-discovered at their new path (correct). The app should alert the user about these implications before performing a move — a brief info message in the move confirmation dialog explaining that moved files will no longer appear under their original folder. Details to be refined during live testing.
- Cross-device moves (source on one drive, appdata on another) need copy+delete fallback — the video trash system already handles this pattern

### API
- `POST /api/managed-folders` — create a named folder
- `GET /api/managed-folders` — list managed folders with file counts
- `DELETE /api/managed-folders/:name` — remove a managed folder (only if empty, or with force flag)
- `POST /api/images/move` — move images to a managed folder `{ fingerprints: [...], folder: "name" }`
- `POST /api/videos/move` — move videos to a managed folder `{ fingerprints: [...], folder: "name" }`

These endpoints are already sketched in DESIGN.md §8.10 (Agent API). Building them for the UI also satisfies the agent API requirement.

### Dependencies
- Multi-select (exists for both image and video)
- A UI for folder creation and selection (new — could be a modal or a section in the settings sidebar)
- The bookmark bar (Layer 2 above) would make managed folders easily accessible as pinned bookmarks

---

## Metadata System Expansion

**2026-04-24** — Expanding metadata extraction to cover more generation tools and improving how metadata is presented to the user.

### New image parsers needed
The original parsers are ~4 years old. The SD ecosystem has grown significantly. Tools to add or verify:
- **Forge** (A1111 fork) — likely uses the same PNG text chunk format as A1111. May already work with the existing `standard.js` parser. Needs testing with real Forge outputs to confirm, and the `agent` field should identify it as "forge" if detectable.
- **Fooocus** — stores metadata in PNG text chunks but with a different format from A1111. Needs its own parser or a branch in `standard.js`.
- **Flux** — newer architecture with different parameter names (guidance scale vs cfg_scale, different sampler names). May need schema additions or flexible field mapping.
- **SDXL-specific fields** — refiner model, base/refiner split step, SDXL-specific LoRA handling. These are additional fields on top of the existing schema, not a new parser.
- **Stable Cascade** — different parameter set (stages, prior model). Niche but worth supporting if the format is documented.
- **Generic fallback improvements** — better handling of unknown formats, extract what we can even if we can't identify the tool.

### Video generation metadata
Already flagged in DESIGN.md §8.5. The two primary sources for Pinokio users are ComfyUI (via the VHS node) and Wan2GP. Other tools may emerge, so the parser should be designed as a blanket extractor rather than per-tool parsers.

**Known metadata sources:**

**ComfyUI VHS node** — outputs video metadata in a **companion PNG** file alongside the video (not embedded in the video itself). The PNG contains the ComfyUI workflow JSON in its text chunks, same as any ComfyUI-generated image. The video scanner needs to detect companion PNGs (same filename stem, `.png` extension) and parse them using the existing ComfyUI image parser. This is a key detail — the metadata extraction pipeline for ComfyUI video is actually the *image* metadata pipeline applied to a companion file.

**Wan2GP** — a Pinokio companion app that embeds metadata as either JSON sidecar or EXIF tag. Example metadata structure (from real Wan2GP output):
```json
{
  "prompt": "Close-up portrait of a Sikh man...",
  "negative_prompt": "",
  "resolution": "480x832",
  "video_length": 737,
  "seed": 42,
  "num_inference_steps": 8,
  "guidance_scale": 1,
  "sample_solver": "unipc",
  "activated_loras": [],
  "model_type": "infinitetalk",
  "model_filename": "https://huggingface.co/DeepBeepMeep/Wan2.1/resolve/main/...",
  "generation_time": 990,
  "creation_date": "2026-03-30T12:51:02",
  "type": "WanGP v11 by DeepBeepMeep - Infinitetalk Single Speaker 480p 14B",
  "settings_version": 2.55
}
```
Key fields map to: `prompt`, `negative_prompt`, `seed`, `num_inference_steps` → steps, `guidance_scale` → cfg, `sample_solver` → sampler, `model_filename` → model, `activated_loras` → loras, `model_type` → agent/type.

**Blanket parser approach:**
Rather than writing per-tool parsers for video (like we did for images), design a single flexible video metadata extractor that:
1. Scans for companion files: `<stem>.png`, `<stem>.json`, `<stem>_workflow.json`, `<stem>.workflow.json`
2. For companion PNGs: run through the existing image metadata parser pipeline (detects ComfyUI, A1111, etc.)
3. For JSON sidecars: attempt to extract known fields by key name, regardless of tool. Look for `prompt`, `negative_prompt`, `seed`, `steps`/`num_inference_steps`, `cfg`/`cfg_scale`/`guidance_scale`, `sampler`/`sample_solver`/`scheduler`, `model`/`model_name`/`model_filename`/`model_type`, `loras`/`activated_loras`. Normalize to our schema.
4. For EXIF tags: check for embedded JSON strings in standard EXIF fields (UserComment, ImageDescription)
5. Store the detected source tool as `agent` (e.g., "comfyui", "wan2gp", "unknown")

**Field priority for extraction:** prompt and LoRAs are the most important (sorting and discovery). Model next (grouping). Then seed/steps/cfg/sampler/scheduler (reproduction detail). Users who need exact reproduction can drag the metadata-containing companion image directly into their generation tool — Breadboard's job is sorting and basic parameter display, not workflow recreation.

### Metadata presentation improvements
The viewer panel currently shows raw field names and values in a flat table. For a better browsing experience:
- **Grouped sections:** Generation (prompt, negative, steps, cfg, sampler), Model (checkpoint, LoRAs, VAE), Output (dimensions, seed), File (path, size, dates)
- **Prompt as a readable block** — not a single-line table cell. Wrap text, maybe a slightly different background to distinguish it.
- **LoRA names as clickable chips** — each LoRA is a hyperfilter that finds other images using the same LoRA
- **Model hash as a clickable filter** — click to find all images from the same model
- **Copy buttons** — copy prompt, copy negative prompt, copy seed. Essential for the "reproduce this" workflow.
- **Civitai-style layout** — users are familiar with how Civitai displays generation parameters. We don't need to replicate it exactly, but the grouping and emphasis should feel familiar.

### Implementation order
1. Blanket video metadata parser — companion PNG detection + JSON sidecar extraction (highest impact, unlocks video metadata entirely)
2. Metadata panel redesign (grouped sections, copy buttons, prompt block) — applies to both image and video viewers
3. New image parsers (Forge verification, Fooocus, Flux)
4. SDXL-specific fields
5. Auto-suggested smart folders based on metadata (ties into the organization strategy above)

### Dependencies
- Video metadata parsing needs new columns in the video DB schema (prompt, negative_prompt, seed, steps, cfg, sampler, model_name, loras, agent — mirroring the image schema where applicable)
- Companion PNG parsing reuses the existing image crawler pipeline — no new parser needed for ComfyUI video
- Metadata panel redesign is UI-only, no backend changes
- New image parsers are independent of each other

---

## Subfolder Checkbox in Folder Panel

**2026-04-22 / 2026-04-24** — Consolidates the existing BACKLOG entry. Add a checkbox to the folder connection flow (both image and video) to control whether subdirectories are included in the scan.

### Current state
- Video scanner already accepts `{ recursive: true/false }` in options — the backend supports this
- Image watcher (Chokidar) has `recursive: true` hardcoded in `server/index.js`
- The folder panel UI has no checkbox — all folders are always recursive

### Implementation
1. Add a `recursive` column to the `folders` table in both image and video DBs (default: `1` / true)
2. In the folder panel connect flow, add a checkbox: "☑ Include subfolders" (checked by default)
3. Store the preference when connecting a folder
4. Video scanner: read the preference and pass `{ recursive }` to `scanDirectory()` (already supported)
5. Image watcher: read the preference per-folder and configure Chokidar accordingly. This may require separate watcher instances per folder (currently one watcher watches all paths). Alternatively, use a single recursive watcher but filter events by checking if the file's depth exceeds the folder's allowed depth.
6. Show the current recursive state in the folder list (a small indicator or the checkbox state when viewing connected folders)

### Scope
Small-medium. The video side is nearly free (backend already supports it). The image side needs a bit more work with the Chokidar watcher configuration.

---

## Existing Items (carried forward)

**2026-04-21** — Grid-aware virtual scrolling for 50k+ libraries. Current direct DOM rendering with `loading="lazy"` works well to ~22k images. For 50k+, we'll need a custom virtualizer that understands the grid column count and only renders visible rows of cards. Options: custom IntersectionObserver approach, or a lightweight grid virtualizer library. Not blocking current development.

**2026-04-22** — The `/settings` and `/connect` routes still exist as standalone pages (used as fallbacks). Consider removing them entirely once the inline settings sidebar and folder panel are proven stable. Would simplify the codebase.

**2026-04-22** — Keyboard delete in image viewer is half-working: `Delete` key triggers the confirmation dialog but doesn't actually perform the deletion. Needs wiring up to complete the action after confirm.

**2026-04-23** — Improved indexing progress UX for both image and video tabs. Currently the progress indicator is a thin Nanobar at the top and a small status text in the nav. For large libraries (10k+ files), users need more reassurance that indexing is working. Proposal: a centered overlay or large inline counter showing `Video Indexing: 32 / 2,932` (or `Image Indexing: 1,204 / 22,000`) with a proper progress bar underneath. The scanner would need a two-pass approach: first a quick directory walk to count files (fast, no metadata extraction), then the actual indexing pass with known total for accurate percentage. This would also be a good place to show estimated time remaining. Applies to both initial scan and re-index operations.

**2026-04-24** — Unify empty state structure between image and video tabs. Currently they use different DOM placement and centering approaches: image tab renders into a dedicated `.empty-container` sibling div (padding-based centering, needs manual nav-height offset), while video tab renders inside `.content` inside `.container` (flexbox centering, inherits nav padding automatically). Fix: move image tab empty state to render inside `.content` like the video tab, use a shared CSS class, and remove the `empty-container` div from `index.ejs` and `app.js`.

**2026-04-23** — Bouncing cube end-marker. The `fa-chess-board fa-bounce` icon at the bottom of the image and video card grids was originally a "busy/loading" indicator but now bounces eternally regardless of app state. Options: (1) hide it entirely once the grid has loaded, (2) replace with a static "end of results" marker (e.g. a simple divider or count), (3) only animate it during active indexing. The end-marker exists in both `index.ejs` and `videos.ejs`.
