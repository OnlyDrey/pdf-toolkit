import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye } from 'lucide-react'
import { useActiveTool } from '@/lib/active-tool-context'
import { PdfPagePreview } from './PdfPagePreview'
import { DocumentViewer } from './DocumentViewer'
import { cn } from '@/lib/utils'
export function PdfPageGrid({
  file,
  count,
  selected,
  onSelect,
  disabled = false,
}: {
  file: File
  count: number
  selected: Set<number>
  onSelect: (index: number) => void
  disabled?: boolean
}) {
  const { t } = useTranslation(),
    active = useActiveTool(),
    root = useRef<HTMLDivElement>(null),
    [columns, setColumns] = useState(1),
    [scroll, setScroll] = useState(0),
    [view, setView] = useState<number | null>(null)
  useEffect(() => {
    const node = root.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setColumns(Math.max(1, Math.floor(node.clientWidth / 154))),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setScroll(0)
    setView(null)
    if (root.current) root.current.scrollTop = 0
  }, [file])
  useEffect(() => {
    if (!active) setView(null)
  }, [active])
  const rowHeight = 232,
    start = Math.max(0, Math.floor(scroll / rowHeight) - 1),
    end = Math.min(Math.ceil(count / columns), start + 5),
    indices = Array.from(
      { length: Math.max(0, Math.min(count, end * columns) - start * columns) },
      (_, n) => start * columns + n,
    )
  return (
    <>
      <div
        ref={root}
        data-preview-scroll
        data-rendered-pages={indices.length}
        className="max-h-[520px] overflow-auto rounded-md border p-2"
        style={{
          height: Math.min(520, Math.ceil(count / columns) * rowHeight + 16),
        }}
        onScroll={(event) => setScroll(event.currentTarget.scrollTop)}
      >
        <div
          style={{
            height: Math.ceil(count / columns) * rowHeight,
            position: 'relative',
          }}
        >
          <div
            className="grid gap-2"
            style={{
              gridTemplateColumns: `repeat(${columns},minmax(0,1fr))`,
              position: 'absolute',
              insetInline: 0,
              top: start * rowHeight,
            }}
          >
            {indices.map((index) => (
              <div
                key={index}
                className={cn(
                  'flex h-[224px] min-w-0 flex-col items-center justify-between rounded-md border p-1',
                  selected.has(index)
                    ? 'border-primary bg-primary/5'
                    : 'bg-card',
                )}
              >
                <button
                  type="button"
                  disabled={disabled}
                  aria-pressed={selected.has(index)}
                  aria-label={t('common.pageLabel', { page: index + 1 })}
                  onClick={() => onSelect(index)}
                  className="flex min-h-8 w-full flex-1 flex-col items-center gap-1 rounded p-1"
                >
                  <PdfPagePreview
                    file={file}
                    pageNumber={index + 1}
                    maxWidth={112}
                    interactive={false}
                  />
                  <span className="text-xs">
                    {t('common.pageLabel', { page: index + 1 })}
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={t('preview.openPage', { page: index + 1 })}
                  onClick={() => setView(index)}
                  className="flex min-h-8 w-full items-center justify-center rounded text-muted-foreground hover:bg-muted"
                >
                  <Eye className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {view !== null && (
        <DocumentViewer
          source={{ kind: 'pdf', file, pages: count, page: view }}
          onClose={() => setView(null)}
        />
      )}
    </>
  )
}
