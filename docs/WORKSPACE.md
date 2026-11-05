# Document workspace

## Navigation and layout

`app/src/lib/tools.ts` is the single registry for all eight tool components, icons and categories. WorkspaceShell uses it for the expanded/collapsed desktop sidebar and full-screen mobile menu; it does not duplicate tool definitions. Appearance controls share one implementation. Only presentation preferences are remembered locally. The shell supplies one visible tool heading; mounted panels preserve control settings across navigation.

### Sticky topbar and mobile navigation

The topbar is `position: sticky` (no scroll listeners) and respects safe-area insets. It never changes between menu states: brand on the left; on the right a **Theme** icon button (sun, moon or monitor for the stored preference, so System always shows the monitor), a **Language** globe button (Norsk, English) and the hamburger. Theme and language are compact dropdowns (`menuitemradio`, active choice checked, closes on selection, Escape or outside click, arrow-key navigation). Choices persist through the existing mechanisms.

On small screens the hamburger opens a full-screen navigation panel fixed _below_ the navbar (`--topbar-h` is measured, so a wrapped navbar is respected; `100dvh`-based insets, safe-area padding). The same button turns into an X in the same position; there is no second logo. Background scrolling is locked and the workspace is `inert` while open, the panel scrolls itself, the active tool is highlighted and focused, and Escape, the X or choosing a tool closes it and restores focus. Document state and scroll position are untouched. The desktop sidebar is unchanged and stays full-height and sticky with its own scroll area.

The document panel sits beside tool controls on wide screens and stacks on smaller screens. Open a PDF there, or create one with Merge or Images to PDF, then continue with the same working document across tools. The mobile menu closes on selection, Escape or the X button and restores focus. Theme transitions resolve atomically as described in [accessibility](ACCESSIBILITY.md).

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

## PDF compression

**Previous behavior (investigated):** Compress only reloaded the document with pdf-lib and saved it with object streams. That removes xref/dictionary overhead but never touches embedded images, so scans and photo PDFs (where almost all bytes are image data) barely shrink; superseded revisions and duplicate images were kept.

**Current architecture (all local, no new dependency, no WASM):** `app/src/lib/pdf-compress.ts` works on the pdf-lib object graph; `pdf-compress-codec.ts` supplies browser-native image decoding/encoding (`createImageBitmap`, canvas, `DecompressionStream`). Both load lazily when Compress runs. No document leaves the browser. Heavier engines (for example Ghostscript or MuPDF compiled to WASM) were rejected for now: multi-megabyte bundles, AGPL/GPL redistribution obligations, large linear-memory use, and no need for them to cover the common case.

| Mode               | Structure                                                                  | Images                                                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lossless           | Remove unreachable objects, share byte-identical images, Flate raw streams | Never changed                                                                                                                                                                   |
| Balanced (default) | Same                                                                       | Limit to 150 dpi relative to the page; JPEG q 0.72; photographic Flate rasters become JPEG, line art is only downscaled (lossless Flate); replaced only if at least 10% smaller |
| Maximum            | Same                                                                       | Limit to 100 dpi; JPEG q 0.50; replaced only if at least 5% smaller                                                                                                             |

Resolution targets use the size of the page(s) that reference an image, so an image is never reduced below the stated dpi for any placement that fits the page. Text, fonts, vector content, links, outlines, form fields and page boxes are not touched. Alpha soft masks are kept as they are. Skipped (kept byte-for-byte): CMYK, Indexed, Lab, masked or `/Decode`d images, images below 0.25 MP or above 48 MP, 16-bit or unsupported filters (JBIG2, JPX, CCITT), and anything the browser cannot decode. Gray photos become 3-channel JPEG, which can be slightly larger; they are replaced only if smaller.

Safeguards: the mode is chosen before the single **Compress PDF** action; documents with digital signatures are left unchanged with an explanation (any rewrite would invalidate them); encrypted documents are rejected as before. The output is reopened and must keep its page count. If the result is not smaller, nothing is committed, the original stays in place and the tool says so; the user can retry another mode. Images are processed one at a time with the event loop yielded between them and an AbortSignal-based Cancel button. The last chosen mode is stored in `localStorage` (`pdf-toolkit-compress-mode`). An advanced settings section was intentionally not added: dpi/quality are fixed per mode so every shown option is actually enforced.

Quality and compatibility: Balanced and Maximum are lossy for images (JPEG re-encoding adds generation loss and can soften fine detail or scanned text; Maximum is visibly softer). Canvas decode of a very large image allocates width × height × 4 bytes transiently, hence the 48 MP cap; mobile browsers may fail earlier, in which case that image is kept. Browser JPEG decoding ignores embedded ICC profiles; the original ColorSpace entry is kept in the output. Safari/Firefox/Chromium all provide the required APIs. Real measurements are recorded in [VERIFICATION](VERIFICATION.md).
