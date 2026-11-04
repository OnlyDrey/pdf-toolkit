import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PdfPagePreview } from './PdfPagePreview'

// Large inline page view. It reuses the shared preview service (cache, queue,
// cancellation), so a failed render never blocks editing or export.
export function DocumentPagePreview({
  file,
  count,
  page,
  onPage,
}: {
  file: File
  count: number
  page: number
  onPage: (page: number) => void
}) {
  const { t } = useTranslation(),
    frame = useRef<HTMLDivElement>(null),
    [width, setWidth] = useState(320)
  useEffect(() => {
    const node = frame.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setWidth(Math.round(Math.max(160, Math.min(520, node.clientWidth)))),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const current = Math.min(page, count - 1)
  return (
    <section
      aria-label={t('preview.inline')}
      className="space-y-2"
      data-inline-preview
    >
      {count > 1 && (
        <div className="flex items-center justify-between gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={current <= 0}
            aria-label={t('preview.previous')}
            onClick={() => onPage(current - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-xs">
            {t('preview.counter', { page: current + 1, count })}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={current >= count - 1}
            aria-label={t('preview.next')}
            onClick={() => onPage(current + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      )}
      <div
        ref={frame}
        className="flex justify-center overflow-hidden rounded-md bg-muted/30 p-2"
      >
        <PdfPagePreview
          key={current}
          file={file}
          pageNumber={current + 1}
          maxWidth={Math.max(120, width - 16)}
        />
      </div>
    </section>
  )
}
