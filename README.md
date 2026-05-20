# PDF Toolkit

> Simple, private PDF tools — processed entirely in your browser.

No uploads. No servers. No data leaves your device. All PDF processing runs locally using [pdf-lib](https://pdf-lib.js.org/) and [pdfjs-dist](https://mozilla.github.io/pdf.js/).

---

## Features

### Tools

| Tool | Description |
|---|---|
| **Merge** | Combine multiple PDFs into one. Drag to reorder before merging. |
| **Compress** | Reduce file size by optimising the internal PDF structure (object streams). |
| **Extract Pages** | Pick pages by clicking thumbnails or typing ranges (e.g. `1,3,5-8`). |
| **Rotate** | Rotate all pages or a range by 90 / 180 / 270 degrees. Live preview included. |
| **Resize** | Resize pages to any ISO A/B/C or US paper size with optional content scaling. |
| **Crop** | Trim page margins using point values. Visual overlay preview updates in real time. |
| **Version Fix** | Detect and rewrite the PDF version header (1.0 – 2.0). |

### Session Workflow

Upload a PDF once and apply multiple operations without re-uploading between steps:

1. **Upload** a PDF in any tool — it becomes the **working file** available in all tools automatically.
2. Click **Apply** in a tool — the result is saved as the new working file. No automatic download.
3. **Switch tabs freely** — the working file is already loaded in every tool.
4. When finished, use the session bar to **Download** (keep editing) or **Save & Download** (done — clears session).
5. **Discard** clears the session without downloading.

The session is held in memory only and is automatically lost on page refresh or browser close.

### UI / UX

- **Live previews** — Rotate shows a rotated first-page thumbnail; Crop shows a real-time overlay; Resize shows an original vs. target size comparison; Extract shows a clickable thumbnail grid.
- **Clickable thumbnails** in Extract — click any page to toggle selection. The text input stays in sync.
- **Theme toggle** — Light, Dark, or System (follows OS preference). Preference is stored in `localStorage`.
- **Tab state persistence** — uploading a file to a tool preserves it when switching tabs.
- **Internationalisation** — English and Norwegian Bokmål (`nb`). Language toggle in the header.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 + TypeScript |
| Build tool | Vite 5 |
| PDF processing | pdf-lib (manipulation), pdfjs-dist (page rendering / previews) |
| Styling | Tailwind CSS + shadcn/ui |
| Drag & drop (Merge) | @dnd-kit/core + @dnd-kit/sortable |
| i18n | react-i18next |
| Unit tests | Vitest |
| Container | Docker (nginx:alpine, multi-stage build) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Development

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173).

### Production build

```bash
npm run build
```

Output is in `dist/`.

### Docker

```bash
docker compose up --build
```

Serves the built app on port **80** via nginx.

---

## Project Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx          # App header with theme + language toggles
│   │   ├── NavTabs.tsx         # Tool navigation tabs
│   │   ├── SessionBar.tsx      # Working file bar (Apply / Download / Discard)
│   │   └── ThemeProvider.tsx   # Light / Dark / System theme context
│   ├── tools/
│   │   ├── FileDropZone.tsx    # Shared drag-and-drop file input
│   │   ├── PdfPagePreview.tsx  # Canvas-based PDF page renderer (pdfjs-dist)
│   │   ├── Merge.tsx
│   │   ├── Compress.tsx
│   │   ├── Extract.tsx
│   │   ├── Rotate.tsx
│   │   ├── Resize.tsx
│   │   ├── Crop.tsx
│   │   └── VersionFix.tsx
│   └── ui/                     # shadcn/ui primitives
├── i18n/
│   ├── index.ts
│   ├── en.json
│   └── nb.json
├── lib/
│   ├── paper-sizes.ts          # ISO A/B/C + US paper size catalogue
│   ├── pdf-utils.ts            # readFileAsArrayBuffer, formatFileSize, parsePageRange, downloadBlob
│   ├── session-context.ts      # React context for the working-file session
│   ├── theme-context.ts        # React context for theme preference
│   └── utils.ts                # cn() helper
├── App.tsx                     # Root component — all tools stay mounted (hidden class)
└── main.tsx
```

---

## Privacy

All processing happens **in the browser using WebAssembly and the Web APIs**. No PDF content, metadata, or filename is ever sent to any server. The app can be used fully offline once loaded.

---

## License

MIT — see [LICENSE](LICENSE).
