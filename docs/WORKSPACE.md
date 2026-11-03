# Document workspace

## Architecture audit and plan — 2026-11-03

The baseline uses eight mounted tool panels, Radix horizontal tabs, a session of immutable PDF bytes/name, and local tool inputs/results. Every existing operation already writes to the session on success; Extract is a document-changing operation, not export-only. The shared toolbar owns Download / Save & Download / confirmed Discard. Images to PDF separately confirms replacement and protects concurrent document changes. Tools validate PDF errors through shared utilities and English/Norwegian keys. Some tool-specific result download buttons duplicate the working-file toolbar.

PDF.js documents are reference-counted by File and destroyed on final release. Rendering is active-tool-only but eager within Extract's first 12 pages, without a shared render queue/cache/viewer. Large raster previews are deliberately rejected before pixel decode. Image preparation is format-aware in a worker: bounded thumbnails, streamed high-resolution PNG, byte-preserving JPEG, cached compressed plans and explicit URL/cache release. This pipeline will be retained.

Plan:

1. Central tool registry and responsive shell: grouped vertical navigation, remembered collapse preference, one mobile modal drawer, shared appearance controls and a single tool heading. Preserve mounted tool state and existing IDs while updating navigation tests.
2. Bounded preview service: shared document leases, two-slot render scheduling, visibility gating, LRU thumbnail cache with explicit disposal, lazy PDF thumbnails and a modal page/image viewer. Keep preview resolution independent of export and keep high-raster fallback visible. Keys include source revision, page, dimensions and rotation; obsolete work is cancelled/discarded.
3. Extend the existing session, rather than adding another document store: atomic revision checks/operation locks, bounded immutable checkpoints and stable page IDs. A shared document panel owns opening/replacement, save, preview/info, selected-page actions and history. All eight tools commit through the same transactional mechanism. Remove duplicate downloads once the shared workflow is available.

Risks: stale async results, source changes during operations, canvas/URL/document retention, and checkpoint memory. Use scoped leases/cancellation, revision-based commits, bounded queues/cache/history and visible history eviction. Snapshot history is selected for fidelity across crop/resize/merge/extract/header edits; unsafe inverse/replay logic is avoided. Identical immutable buffers are shared, and large checkpoints evict older entries within an explicit budget. No document storage or new processing dependency is planned.

Run targeted checks after each phase, commit/push each completed phase to work, then run the complete local/container regression. No Actions, PRs, releases, images or main writes are authorized.

## Phase 1

One `TOOLS` registry supplies component, icon, category and localized metadata keys. Navigation is a standard grouped button navigation (Tab/Enter/Space, aria-current), not a mix of tab and button interaction models. Desktop collapse is a locally remembered presentation preference; tablet defaults compact. The mobile native dialog locks background scroll, traps focus and closes on Escape, backdrop or selection. Appearance controls share one implementation. Tool panels stay mounted, and the shell exposes one visible tool heading with wider border-free controls.

Baseline: typecheck, 81 unit tests and four existing desktop/mobile workflow cases passed. Targeted Phase 1 checks passed for sidebar persistence, mobile drawer focus/closure, language/theme/confirmation workflows and modal axe states. A loading-preview layout shift was identified during fast dropdown interaction; Phase 2 will reserve fixed preview frames so loading cannot move controls. Dropdowns also track anchor movement and available viewport height.

## Phase 2

The preview service owns a 64-entry / 24 MiB LRU resource cache, two concurrent render slots, keyed in-flight work and explicit leases. Keys use immutable File identity (document revision), page, dimensions and rotation. Cache eviction/revision invalidation revokes URLs when the last active lease is released. PDF.js documents are shared, bounded to two concurrent sources and destroyed after a short idle grace; cancelled/obsolete work cannot publish into a current view. Each rendered surface is limited to four million pixels. Fixed preview frames prevent loading from moving form controls.

Extract now virtualizes all pages in a bounded scrolling grid rather than eagerly rendering the first 12. IntersectionObserver gates near-visible thumbnails. The reusable modal viewer supplies page navigation, keyboard arrows, 50–400% zoom, fit-width/fit-page/reset, scroll/pan and Escape/focus restoration. PDF zoom requests are debounced. Image viewing requests a bounded native preview through the existing worker when within the decode budget; exceptionally large images use their existing tiny thumbnail with an explicit quality notice. Export pixels are never changed. The existing safe large-raster PDF fallback remains: full interactive rendering of those PDFs is not claimed.

Targeted validation passed: 84 unit tests (including LRU/disposal/pinning and queue cancellation), typecheck/lint/build, 300-page virtualization and viewer/cancellation cases on both devices, scoped viewer axe checks, 155 MP PNG image fallback/original-preserving conversion and 16-bit PDF rendering. The live grid mounted fewer than 50 page cells for 300 pages. Image thumbnails are native-lazy decoded, and their existing bounded preparation/cache lifecycle is reused.

## Using the workspace

Open a PDF in the document panel, or create a working file with Merge or Images to PDF. Switch tools without uploading that PDF again. On desktop the controls and document panel share the workspace; on smaller screens they stack. Collapse the desktop sidebar for more room. Mobile navigation opens as a modal drawer; Escape, the backdrop or selecting a tool closes it.

The document panel owns Download, Save & Download, Preview, information and confirmed Discard. Download exports without changing unsaved status. Save & Download marks the current revision saved **and keeps it open**, replacing the old behavior that cleared the working file. Discard explicitly removes the document and all history. Replacing unsaved work asks for confirmation; an approved replacement can be undone. All existing tools still apply their result to the working document, including Extract. There are no new export-only operations.

Select pages with their numbered buttons (Tab/Enter/Space), or Select all / Deselect all. Rotate selected applies 90° clockwise. Remove selected asks for confirmation and cannot remove every page. Drag a page by its handle; keyboard users can lift/drop with Space and move with arrows. Dragging uses the visible virtual grid; Move selected up/down and Move group to page also reach distant pages without dragging. Selected pages retain their relative order. Extract uses the same selection in the document panel, with a page-range input for precise selection. Page removal, like Crop, is not secure redaction.

### History and transactions

Undo and Redo restore actual PDF bytes, filename, stable page identities, selection and unsaved status. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z redoes; Ctrl+Y also redoes. Shortcuts do not intercept text inputs or open dialogs. New document edits discard the redo branch. Opening, image creation, merging, compression, extraction, rotation, resize, crop, version edits and direct page actions all commit through the existing shared session.

History uses immutable checkpoints, shared by reference rather than duplicated into history Files. It keeps at most **20 checkpoints and 128 MiB of previous PDF buffers**, excluding the current document and temporary operation/preview memory. Oldest checkpoints are evicted with an on-screen notice. A very large edit may therefore have fewer undo steps. This is a bounded checkpoint model; PDF compression, extraction and other lossy operations are not reversed by fragile inverse replay. One current File supplies all tools and previews. Inactive tools release references to session-derived files/results. Browser/File/PDF.js allocations still add overhead; the history budget is not a total browser memory guarantee.

Only one document-changing operation can run at a time. Results are validated before an atomic revision-checked commit. Failure or a stale result preserves the previous valid document. Undo/Redo invalidate prior preview work. Everything stays in memory; refreshing or closing the page loses documents and history. No document bytes are stored in localStorage; only presentation preferences are remembered.

### Preview limits

Original image/PDF data and preview pixels are independent. PDF thumbnails are visibility-gated and virtualized; a 300-page test mounts fewer than 50 page cells. The shared queue allows two render jobs, and the resource cache is limited to 64 items / 24 MiB (estimated blob plus decoded pixels), with pinned views released after use. Each PDF render surface is bounded to four million pixels. Zoom changes are debounced and bounded to 50–400%; fit-width/page and scrolling provide navigation without changing export quality.

JPEG/PNG export retains the established original-preserving image pipeline. Native resized bitmap decoding is used for ordinary image previews, but browsers may still allocate a full decoded source internally. The existing decode budget therefore protects exceptionally large images: the viewer can show a tiny thumbnail and explicitly explain its limited resolution. A 10800 × 14400 PNG remains convertible even if a detailed interactive preview is unsafe. The existing PDF.js large-raster guard similarly reports unavailable previews before unsafe decode; it does not alter or discard the working PDF. Canvas limits, corrupt/encrypted sources and device memory can still prevent previews. There is no promise of full-resolution interactive viewing or unlimited document size.

## Phase 3

The original session is now a transactional document store with bounded byte checkpoints, monotonic revisions and stable page IDs. All eight tools use its operation lock and commit path. The shared panel replaces duplicated download buttons and the old session toolbar; Extract shares its selection and virtual preview grid. Direct page reordering preserves original page objects and catalog metadata. Confirmed Discard clears history, and save keeps the document available for continued editing.

Targeted Phase 3 validation passed: typecheck, lint, formatting and production build; 91 unit tests overall and 25 focused history/PDF tests; desktop/mobile PDF operation chains, page actions, keyboard reorder, replacement rollback and save/discard behavior. Repeated viewer/edit/discard instrumentation returned all newly created preview object URLs to zero on both devices. Image conversion failure retained the original bytes; conflicting edits were disabled, and a successful replacement restored the original bytes through Undo.
