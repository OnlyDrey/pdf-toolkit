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
