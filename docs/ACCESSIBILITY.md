# Accessibility and appearance

The responsive workspace uses one grouped button navigation with localized labels, `aria-current`, visible keyboard focus and Lucide icons. Desktop collapse retains accessible names and tooltips. The native mobile drawer traps/restores focus, locks background scrolling and closes on Escape, backdrop or tool selection. There is no horizontal tab strip.

All eight tools, the document panel, image queue, virtual page grid, modal preview, settings and status/error/confirmation states are covered in English and Norwegian Bokmål. Controls derive names from visible content, filenames wrap, actions stack/wrap on narrow screens, and destructive confirmations initially focus Cancel. Disabled operations use real disabled/aria-disabled states; conflicting document edits are locked.

## Contrast and deterministic themes

Light-mode muted text uses HSL `215.4 16.3% 35%`; dark-mode muted text uses `215 20.2% 72%`, with margin above normal-text AA contrast on supported surfaces. Inactive navigation has consistent muted text and foreground-on-muted hover/focus styling; active navigation keeps primary/primary-foreground styling.

Two individually accessible palettes can still interpolate through unreadable colors. ThemeProvider therefore applies light/dark/system changes in a layout effect, temporarily suppressing CSS transitions while the palette resolves. A `data-theme-changing` marker clears after rendering frames; the system-preference listener uses the same path. Navigation and language/theme selection controls do not tween opposing foreground/background colors. Reduced-motion and forced-colors behavior remain supported.

Browser checks wait for palette readiness and `document.fonts.ready`, not arbitrary sleeps. The new rendered-frame test measures actual computed/composited navigation colors while hovering, focusing, selecting tools and changing themes. Existing axe rules, AA thresholds and browser retries were not weakened. The previously flaky populated Images to PDF accessibility cases passed three repeats per device with retries disabled during stabilization.

## Document and preview interaction

Page selection uses numbered buttons and explicit selection state. Reordering supports drag handles, Space/arrows/drop/cancel keyboard operation and Move up/down/to-page alternatives. Undo/Redo shortcuts do not intercept editable fields or open dialogs. Preview navigation, fit/zoom controls, Escape and focus restoration work without a pointer. Loading and fallback states explain unavailable previews without losing the working document or silently reducing export quality.

Image processing stays in a worker where supported. Sequential preparation, progress and duplicate-action locks are retained. Native bitmap decoders may still allocate full source buffers; very large preview fallbacks and memory guidance are described in [workspace limits](WORKSPACE.md). GIF/animated WebP first-frame limitations and unsupported TIFF are explicit.

## Verification boundaries

Automated coverage includes both themes/languages on desktop/mobile, 320/640 CSS-pixel reflow, 200% root text sizing, keyboard interaction, production Nginx/CSP and axe scans. This is not a WCAG certification or a claim of manual browser-chrome 400% zoom/screen-reader validation. Representative Windows/macOS/mobile assistive-technology and browser high-contrast/zoom review remain manual checks. Current counts and results are in [verification](VERIFICATION.md).

VersionFix edits only the three header version characters and preserves the remaining bytes; it does not implement real PDF feature conversion. Canonical local branding/favicon assets remain theme-aware and have no externally loaded resources.
