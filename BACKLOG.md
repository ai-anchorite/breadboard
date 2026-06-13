# Backlog — Ideas & Shower Thoughts

> Dump ideas here as they come. No structure required. Date each entry. When an idea is promoted to a real task in DESIGN.md, remove it from here.



* black 1st frame issue on display card: maybe a user control in the video viewer to set current frame as the card display frame?

* need a way to reset/delete back to factory. ie delete /appdata or similar

* resynchronize button on navbar repurpose to "refresh". we have a re-index from stratch button in settings, need to understand current purpose of that resync button. Refresh is useful for a button to click to clear search bar and back to the bulk view. 

* update app theme to match Pinokio's.  palette, font and gold-colored accent etc.  will check for pinokio's electron style files. 

* need to investigate the "live update" function.  currently a power icon on the navbar.  originally this detected changes in the linked folders and auto-updated newly added media afaik.

* **2026-06-14** — Video tab drag-to-export. Currently video cards have no file-drag behaviour like image cards do. Users can select video cards (with the existing multi-select system) but can't drag them out of Breadboard into external apps. This is a core interaction for dropping videos into editing tools, ComfyUI workflows, etc. The image tab's drag-out pipeline (`ondragstart` → `selection.js` → `main.js` IPC) should be replicated for video cards, including the recently-improved `nativeImage` drag icon.

* **2026-06-14** — Pop-out video player polish. The `/video-viewer` popout window has a native OS title bar and window chrome. Offer a frameless/detached-player mode — clean window with just the video and controls. Also add the frame capture controls (save directory, format selection) from the inline viewer to the pop-out player so users don't need to switch back to the main window to take screenshots.

* **2026-06-13** — Update Node.js. We hit a real-world ESM/CJS breakage with `image-size` v2.x on Node 22 (`The "list" argument must be an instance of SharedArrayBuffer`). The package ecosystem is accelerating ESM-only releases and Node's Buffer → SharedArrayBuffer transition is causing silent breakage in CJS consumers. Staying current (Node 24 LTS when available, or tracking 22.x releases) is more critical than usual given the surge in supply-chain attacks and ESM migrations happening this year. Electron 39's bundled Node should be audited too — bumping the Electron minor may pull in a compatible version.

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


## Existing Items (carried forward)

**2026-04-21** — Grid-aware virtual scrolling for 50k+ libraries. Current direct DOM rendering with `loading="lazy"` works well to ~22k images. For 50k+, we'll need a custom virtualizer that understands the grid column count and only renders visible rows of cards. Options: custom IntersectionObserver approach, or a lightweight grid virtualizer library. Not blocking current development.

**2026-04-22** — The `/settings` and `/connect` routes still exist as standalone pages (used as fallbacks). Consider removing them entirely once the inline settings sidebar and folder panel are proven stable. Would simplify the codebase.

**2026-04-22** — Keyboard delete in image viewer is half-working: `Delete` key triggers the confirmation dialog but doesn't actually perform the deletion. Needs wiring up to complete the action after confirm.

**2026-04-23** — Improved indexing progress UX for both image and video tabs. Currently the progress indicator is a thin Nanobar at the top and a small status text in the nav. For large libraries (10k+ files), users need more reassurance that indexing is working. Proposal: a centered overlay or large inline counter showing `Video Indexing: 32 / 2,932` (or `Image Indexing: 1,204 / 22,000`) with a proper progress bar underneath. The scanner would need a two-pass approach: first a quick directory walk to count files (fast, no metadata extraction), then the actual indexing pass with known total for accurate percentage. This would also be a good place to show estimated time remaining. Applies to both initial scan and re-index operations.

