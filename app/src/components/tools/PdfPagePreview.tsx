import { useActiveTool } from '@/lib/active-tool-context'
import { useTranslation } from 'react-i18next'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { pdfPreview, type PreviewBitmap } from '@/lib/preview-service'
import type { ResourceLease } from '@/lib/preview-cache'
import { DocumentViewer } from './DocumentViewer'
export interface PageDimensions {
  canvasW: number
  canvasH: number
  ptW: number
  ptH: number
}
interface Props {
  file: File
  pageNumber?: number
  maxWidth?: number
  rotateDeg?: number
  className?: string
  onDimensions?: (dims: PageDimensions) => void
  children?: ReactNode
  interactive?: boolean
}
export function PdfPagePreview({
  file,
  pageNumber = 1,
  maxWidth = 240,
  rotateDeg = 0,
  className,
  onDimensions,
  children,
  interactive = true,
}: Props) {
  const { t } = useTranslation(),
    active = useActiveTool(),
    root = useRef<HTMLDivElement>(null)
  const [near, setNear] = useState(false),
    [image, setImage] = useState<PreviewBitmap | null>(null),
    [error, setError] = useState(''),
    [viewer, setViewer] = useState(false)
  const height = Math.round(maxWidth * 1.414)
  useEffect(() => {
    if (!active) {
      setNear(false)
      setViewer(false)
      return
    }
    if (typeof IntersectionObserver === 'undefined') {
      setNear(true)
      return
    }
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      {
        root: root.current?.closest('[data-preview-scroll]') ?? null,
        rootMargin: '200px',
      },
    )
    if (root.current) observer.observe(root.current)
    return () => observer.disconnect()
  }, [active, file])
  useEffect(() => {
    setImage(null)
    setError('')
    if (!active || !near) return
    const controller = new AbortController()
    let lease: ResourceLease<PreviewBitmap> | undefined
    void pdfPreview(
      file,
      { page: pageNumber, width: maxWidth, height, rotation: 0 },
      controller.signal,
    )
      .then((value) => {
        if (controller.signal.aborted) {
          value.release()
          return
        }
        lease = value
        setImage(value.value)
        onDimensions?.({
          canvasW: value.value.width,
          canvasH: value.value.height,
          ptW: value.value.ptW,
          ptH: value.value.ptH,
        })
      })
      .catch((reason) => {
        if (!controller.signal.aborted)
          setError(
            reason instanceof Error &&
              reason.message === 'highResolutionPreview'
              ? 'highResolutionPreview'
              : 'previewUnavailable',
          )
      })
    return () => {
      controller.abort()
      lease?.release()
    }
  }, [file, pageNumber, maxWidth, height, active, near, onDimensions])
  const visual = (
    <div
      className={cn('relative inline-block max-w-full', className)}
      style={{
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transition: 'transform .2s',
      }}
    >
      {image && (
        <img
          data-pdf-preview={pageNumber}
          alt={t('common.previewPage', { page: pageNumber })}
          src={image.url}
          width={image.width}
          height={image.height}
          className="block max-w-full h-auto rounded border shadow-xs"
        />
      )}
      {image && children}
    </div>
  )
  return (
    <div
      ref={root}
      className="flex max-w-full items-center justify-center"
      data-preview-state={
        error ? 'error' : image ? 'ready' : near ? 'loading' : 'idle'
      }
      style={{ width: maxWidth, height }}
    >
      {error ? (
        <p
          role="status"
          className="max-w-full px-2 text-xs text-muted-foreground"
        >
          {t('common.' + error)}
        </p>
      ) : image ? (
        interactive ? (
          <button
            type="button"
            className="max-w-full rounded"
            aria-label={t('preview.openPage', { page: pageNumber })}
            onClick={() => setViewer(true)}
          >
            {visual}
          </button>
        ) : (
          visual
        )
      ) : (
        <div
          className="flex h-full w-full items-center justify-center rounded border bg-muted/30"
          role="status"
          aria-label={t('preview.loading', { page: pageNumber })}
        >
          {near && (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          )}
        </div>
      )}
      {viewer && (
        <DocumentViewer
          source={{
            kind: 'pdf',
            file,
            pages: image?.pages ?? pageNumber,
            page: pageNumber - 1,
          }}
          onClose={() => setViewer(false)}
        />
      )}
    </div>
  )
}
