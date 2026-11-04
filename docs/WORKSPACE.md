# Document workspace

## Navigation and layout

`app/src/lib/tools.ts` is the single registry for all eight tool components, icons and categories. WorkspaceShell uses it for the expanded/collapsed desktop sidebar and accessible mobile drawer; it does not duplicate tool definitions. Appearance controls share one implementation. Only presentation preferences are remembered locally. The shell supplies one visible tool heading; mounted panels preserve control settings across navigation.

### Sticky topbar and drawer

The topbar is `position: sticky` (no scroll listeners) above the content column and respects safe-area insets. On small screens it shows the brand on the left and, on the right, theme, language and the hamburger. The hamburger opens a native modal drawer from the right that traps focus, locks background scrolling, exposes `aria-expanded`/`aria-controls`, and closes on Escape, backdrop click or tool selection, restoring focus to the hamburger. The desktop sidebar stays full-height and sticky with its own scroll area, so only the page scrolls.

The document panel sits beside tool controls on wide screens and stacks on smaller screens. Open a PDF there, or create one with Merge or Images to PDF, then continue with the same working document across tools. The mobile drawer closes on selection, Escape or backdrop and restores focus. Theme transitions resolve atomically as described in [accessibility](ACCESSIBILITY.md).

## Shared state and transactional operations

SessionProvider wraps the existing session around DocumentStore (`app/src/lib/document-store.ts`). The store owns immutable-by-ownership PDF bytes, one current File, filename, monotonic revision, stable page IDs, selection, unsaved status and history. It is the document source of truth; tools do not create independent working sessions.

All eight tools acquire an operation token and commit through the provider. A result is parsed/validated and its original revision rechecked before the working state changes. Failure leaves the previous valid document intact. Concurrent conflicting edits and Undo/Redo are locked during an operation. Successful commits invalidate prior-file previews. Inactive tools release session-derived file/result references; explicitly staged source files remain available where appropriate.

The panel is a compact toolbar: filename, size, page count and one status line (Processing, Unsaved changes or Saved), Undo/Redo, a secondary **Download** (copy; keeps unsaved status), the primary **Save & Download**, and a **More document actions** menu (Preview document, Replace document, Document information, Discard). Discard asks for confirmation. Source files (for example the Images to PDF queue: index, name, dimensions, size, thumbnail or placeholder, drag handle, move up/down and remove) are separate from the single working document; converting commits one atomic operation to the shared session and never copies file data into a second state.

Download exports without clearing unsaved status. Save & Download marks the current revision saved **and keeps it open**. Confirmed Discard clears the working document and all history. Replacing unsaved work asks for confirmation; an approved replacement can be undone. Existing operations, including Extract, still update the working document; no export-only operation was silently changed into a replacement.

## Page actions and history

Numbered page buttons support selection/multi-selection and Select all / Deselect all. Rotate selected applies 90° clockwise. Remove selected requires confirmation and cannot remove every page. Reordering preserves existing PDF page objects/catalog metadata and stable IDs. Handles support pointer or Space/arrows keyboard dragging; Move selected up/down/to-page reaches distant pages in the virtual list. Groups retain their relative order. Extract shares this selection and also accepts a precise page range. Page removal and Crop are not secure redaction.

Undo/Redo restore actual bytes, filename, page order/IDs, selection and unsaved state. Supported changes include opening/replacement, image creation, merge, compression, extraction, rotation, resize, crop, header edits and direct page actions. Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo. Editable fields and dialogs keep their own keyboard behavior. A new edit clears the redo branch.

History uses shared immutable checkpoints rather than lossy inverse transformations or replay. It retains at most **20 checkpoints and 128 MiB of previous PDF buffers**, excluding current-document/temporary-operation/preview memory. Oldest entries are evicted with a notice; very large edits can therefore have fewer undo steps. History does not retain duplicate File copies. File/PDF.js/browser allocations add overhead, so this budget is not a total browser-memory limit. Documents and history stay in memory and are lost on refresh/close.

## Preview architecture and ownership

`preview-service.ts` separates source Files, lightweight thumbnails, viewer requests and cache ownership from operations. Immutable File identity/revision, page, dimensions and rotation form cache keys. ResourceCache uses LRU eviction with **64 items / 24 MiB estimated blob plus decoded-pixel cost**. Leases pin currently displayed resources; invalidated/evicted URLs are revoked on final release. Oversized or fully pinned additions are transient rather than exceeding the cache budget indefinitely.

A two-slot queue limits concurrent work. Shared PDF.js document leases cover at most two sources and destroy idle documents after a short grace period. Render tasks are cancelled or obsolete results discarded on replacement, tool changes and viewer closure. Canvases, bitmaps and URLs have explicit cleanup. The bundled PDF.js worker always comes from the installed PDF.js package.

PdfPageGrid virtualizes a bounded row window; IntersectionObserver gates visible/near-visible thumbnails. A 300-page regression mounts fewer than 50 page cells. Fixed thumbnail frames prevent loading from moving controls. Revisions invalidate old thumbnails; corrupt/encrypted/unsafe previews show fallbacks without altering document bytes.

The panel shows a large **inline page preview** of the focused page with previous/next (a one-page PDF gets the whole area and a single page toggle instead of a thumbnail grid); it uses the same cache, queue and cancellation as every other preview, and a failed render shows a notice while editing and export stay available. Thumbnails below it remain lazy and virtualized.

DocumentViewer provides previous/next, page counter, arrows, **50–400% zoom**, fit-width/page, reset, scrolling/panning, Escape, fullscreen (when the browser allows it) and focus restoration. Shortcuts: arrows or PageUp/PageDown change page, Home/End jump to first/last, +/- zoom, 0 resets to fit page. PDF zoom requests are debounced; each rendered surface is limited to **four million pixels**. This avoids unbounded zoom canvases but is not full-resolution tiled viewing.

## Large images and practical limits

JPEG export embeds original image data; PNG processing streams through the existing worker pipeline where feasible. Preview size never changes original export resolution. Ordinary image viewing requests a bounded native preview (up to 1600 px); queue thumbnails are much smaller. Native resized bitmap decoding is not a guarantee that the browser avoids a full-resolution allocation.

Very large images, including 10800 × 14400 PNG, can use an existing tiny thumbnail with an explicit preview-quality notice when detailed decoding is unsafe. PDF raster previews have a separate estimated **128 MiB RGBA budget**, checked before pixel rendering. The valid working PDF remains editable/downloadable when such a preview is unavailable. Browser canvas limits, device memory and codec/PDF.js support can still prevent detailed viewing or conversion. There is no unlimited-size, total-memory or byte-identical-archive guarantee.

Supported formats, EXIF/DPI behavior, transparency and GIF/TIFF limitations are documented in [deployment](DEPLOYMENT.md#images-to-pdf). Current test results, actual platform coverage and remaining manual checks are maintained in [verification](VERIFICATION.md).
