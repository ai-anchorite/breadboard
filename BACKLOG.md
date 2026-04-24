# Backlog — Ideas & Shower Thoughts

> Dump ideas here as they come. No structure required. Date each entry. When an idea is promoted to a real task in DESIGN.md, remove it from here.

---

**2026-04-21** — Grid-aware virtual scrolling for 50k+ libraries. Current direct DOM rendering with `loading="lazy"` works well to ~22k images. For 50k+, we'll need a custom virtualizer that understands the grid column count and only renders visible rows of cards. Options: custom IntersectionObserver approach, or a lightweight grid virtualizer library. Not blocking current development.

**2026-04-22** — The `/settings` and `/connect` routes still exist as standalone pages (used as fallbacks). Consider removing them entirely once the inline settings sidebar and folder panel are proven stable. Would simplify the codebase.

**2026-04-22** — Keyboard delete in image viewer is half-working: `Delete` key triggers the confirmation dialog but doesn't actually perform the deletion. Needs wiring up to complete the action after confirm.

**2026-04-22** — Include subfolders checkbox when adding new folders. Currently all connected folders are indexed recursively by default. Some users may want to index only the top-level folder without subfolders. Add a checkbox to the folder connection flow and store the preference per-folder.

**2026-04-23** — Improved indexing progress UX for both image and video tabs. Currently the progress indicator is a thin Nanobar at the top and a small status text in the nav. For large libraries (10k+ files), users need more reassurance that indexing is working. Proposal: a centered overlay or large inline counter showing `Video Indexing: 32 / 2,932` (or `Image Indexing: 1,204 / 22,000`) with a proper progress bar underneath. The scanner would need a two-pass approach: first a quick directory walk to count files (fast, no metadata extraction), then the actual indexing pass with known total for accurate percentage. This would also be a good place to show estimated time remaining. Applies to both initial scan and re-index operations.

**2026-04-24** — Unify empty state structure between image and video tabs. Currently they use different DOM placement and centering approaches: image tab renders into a dedicated `.empty-container` sibling div (padding-based centering, needs manual nav-height offset), while video tab renders inside `.content` inside `.container` (flexbox centering, inherits nav padding automatically). Fix: move image tab empty state to render inside `.content` like the video tab, use a shared CSS class, and remove the `empty-container` div from `index.ejs` and `app.js`.

**2026-04-23** — Bouncing cube end-marker. The `fa-chess-board fa-bounce` icon at the bottom of the image and video card grids was originally a "busy/loading" indicator but now bounces eternally regardless of app state. Options: (1) hide it entirely once the grid has loaded, (2) replace with a static "end of results" marker (e.g. a simple divider or count), (3) only animate it during active indexing. The end-marker exists in both `index.ejs` and `videos.ejs`.

**2026-04-23** — Mute/volume controls for video playback. Two contexts: (1) Card header — a mute toggle button alongside play-lock, so users can quickly mute/unmute individual play-locked videos without opening the viewer. (2) Fullscreen viewer — a volume slider in the toolbar, plus a mute toggle button. Currently play-locked videos unmute automatically and the viewer has no volume control. The card header is tight on space so the mute button should only appear when play-locked (or always visible but compact). The viewer volume slider could sit next to the play/pause button in the toolbar.

**2026-04-24** — Popout video player redesign. The current `/video-viewer` page is an early prototype — basic HTML video element in a popup window. Needs to be redesigned to match the quality of the inline fullscreen viewer (pan/zoom, metadata panel, playback controls, themed). The key use case is dragging self-contained video windows onto secondary monitors for multi-monitor viewing. Should support: proper playback controls (play/pause, seek, volume), video title in window title bar, keyboard shortcuts matching the inline viewer, and the ability to have multiple popout windows open simultaneously across monitors. Consider whether the popout should be a simplified version of the inline viewer or a purpose-built minimal player.
