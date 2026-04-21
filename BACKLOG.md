# Backlog — Ideas & Shower Thoughts

> Dump ideas here as they come. No structure required. Date each entry. When an idea is promoted to a real task in DESIGN.md, remove it from here.

---

**2026-04-21** — We need to add an origin folder tag (or similar metadata field) to indexed media. When indexing with subfolders included — which will be the most common way to index large collections — we need to retain the subfolder path information so users can search/filter by it. The `file_path` field captures the full path, but a dedicated `origin_folder` or `subfolder` field relative to the connected root would make this more useful for search. Think: `subfolder:txt2img-grids` or `origin:ComfyUI/output/animations`.

**2026-04-21** ⚡ HIGH PRIORITY — Soft-delete with trash folder. Currently `del` IPC handler calls `fs.promises.rm()` directly — files are gone permanently, bypassing the OS recycle bin. Replace with a move to `appdata/deleted_files/`, preserving the original filename and path structure. Settings menu gets a "Deleted Files" management section: view trashed files, restore individual files (moves back to original location), permanently empty trash, and auto-purge setting (e.g. "permanently delete after 30 days"). This should land with or immediately after the DB migration — every delete path from day one should use soft-delete. Ties directly into the non-destructive and privacy-first principles in DESIGN.md §9.

**2026-04-21** — Grid-aware virtual scrolling for 50k+ libraries. Clusterize.js assumes one-item-per-row and doesn't work with CSS grid layouts. For the current scale (1-10k images), direct DOM rendering with `loading="lazy"` images is fine. For 50k+, we'll need a custom virtualizer that understands the grid column count and only renders visible rows of cards. Options: custom IntersectionObserver approach, or a lightweight grid virtualizer library. Not blocking current development.
