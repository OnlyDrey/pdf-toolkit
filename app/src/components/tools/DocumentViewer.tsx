import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  X,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useModal, trapModalFocus } from '@/components/ui/use-modal'
import {
  pdfPreview,
  previewFileKey,
  imagePreview,
  type PreviewBitmap,
} from '@/lib/preview-service'
import type { ResourceLease } from '@/lib/preview-cache'
export type ViewerSource =
  | { kind: 'pdf'; file: File; pages: number; page?: number }
  | {
      kind: 'images'
      items: { id: string; name: string; url?: string; file?: File }[]
      page?: number
    }
export function DocumentViewer({
  source,
  onClose,
}: {
  source: ViewerSource
  onClose: () => void
}) {
  const { t } = useTranslation(),
    dialog = useRef<HTMLDialogElement>(null)
  const [page, setPage] = useState(source.page ?? 0),
    [zoom, setZoom] = useState(1),
    [fit, setFit] = useState<'page' | 'width'>('page'),
    [bitmap, setBitmap] = useState<PreviewBitmap | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [full, setFull] = useState(false)
  const sourceKey =
    source.kind === 'pdf'
      ? previewFileKey(source.file)
      : source.items.map((item) => item.id).join(',')
  const area = useRef<HTMLDivElement>(null),
    [bounds, setBounds] = useState({ width: 800, height: 600 })
  const count = source.kind === 'pdf' ? source.pages : source.items.length
  useModal(dialog, true)
  useEffect(() => {
    const node = area.current
    if (!node) return
    const observer = new ResizeObserver(() =>
      setBounds({
        width: Math.max(200, node.clientWidth - 32),
        height: Math.max(200, node.clientHeight - 32),
      }),
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    setPage(source.page ?? 0)
  }, [sourceKey])
  useEffect(() => {
    setZoom(1)
    setBitmap(null)
    setError('')
    setLoading(true)
  }, [page, sourceKey, count])
  useEffect(() => {
    const controller = new AbortController()
    let lease: ResourceLease<PreviewBitmap> | undefined
    setLoading(true)
    setError('')
    const ratio = Math.min(devicePixelRatio || 1, 2)
    const request = () =>
      source.kind === 'pdf'
        ? pdfPreview(
            source.file,
            {
              page: page + 1,
              width: bounds.width * zoom * ratio,
              height: fit === 'width' ? 100000 : bounds.height * zoom * ratio,
            },
            controller.signal,
          )
        : source.items[page]?.file
          ? imagePreview(
              source.items[page].file!,
              source.items[page].url,
              controller.signal,
            )
          : Promise.reject(new Error('previewUnavailable'))
    const timer = setTimeout(() => {
      void request()
        .then((value) => {
          if (controller.signal.aborted) {
            value.release()
            return
          }
          lease = value
          setBitmap(value.value)
          setLoading(false)
        })
        .catch((reason) => {
          if (!controller.signal.aborted) {
            setError(
              reason instanceof Error &&
                reason.message === 'highResolutionPreview'
                ? 'highResolutionPreview'
                : 'previewUnavailable',
            )
            setLoading(false)
          }
        })
    }, 120)

    return () => {
      clearTimeout(timer)
      controller.abort()
      lease?.release()
    }
  }, [sourceKey, page, zoom, fit, bounds.width, bounds.height])
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === dialog.current)
    document.addEventListener('fullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      if (document.fullscreenElement === dialog.current)
        void document.exitFullscreen().catch(() => {})
    }
  }, [])
  const toggleFull = () => {
    if (document.fullscreenElement)
      void document.exitFullscreen().catch(() => {})
    else void dialog.current?.requestFullscreen?.().catch(() => {})
  }
  const move = (amount: number) =>
    setPage((value) => Math.max(0, Math.min(count - 1, value + amount)))
  return (
    <dialog
      ref={dialog}
      className="document-viewer"
      aria-label={t('preview.title')}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onKeyDown={(event) => {
        trapModalFocus(event)
        if ((event.target as HTMLElement).matches('input,textarea,select'))
          return
        if (event.key === 'ArrowLeft') {
          event.preventDefault()
          move(-1)
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'PageUp') {
          event.preventDefault()
          move(-1)
        }
        if (event.key === 'PageDown') {
          event.preventDefault()
          move(1)
        }
        if (event.key === 'Home') setPage(0)
        if (event.key === 'End') setPage(count - 1)
        if (event.key === '0') {
          setFit('page')
          setZoom(1)
        }
        if (event.key === '+' || event.key === '=')
          setZoom((z) => Math.min(4, z + 0.25))
        if (event.key === '-') setZoom((z) => Math.max(0.5, z - 0.25))
      }}
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('common.close')}
          onClick={onClose}
        >
          <X className="h-5 w-5" />
        </Button>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {source.kind === 'pdf' ? source.file.name : source.items[page]?.name}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={!page}
          aria-label={t('preview.previous')}
          onClick={() => move(-1)}
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-sm">
          {t('preview.counter', { page: page + 1, count })}
        </span>
        <Button
          variant="outline"
          size="icon"
          disabled={page >= count - 1}
          aria-label={t('preview.next')}
          onClick={() => move(1)}
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={zoom <= 0.5}
          aria-label={t('preview.zoomOut')}
          onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          aria-label={t('preview.reset') + ` (${Math.round(zoom * 100)}%)`}
          onClick={() => {
            setZoom(1)
            setFit('page')
          }}
        >
          {Math.round(zoom * 100)}%
        </Button>
        <Button
          variant="ghost"
          size="icon"
          disabled={zoom >= 4}
          aria-label={t('preview.zoomIn')}
          onClick={() => setZoom((z) => Math.min(4, z + 0.25))}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFit('width')
            setZoom(1)
          }}
        >
          {t('preview.fitWidth')}
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setFit('page')
            setZoom(1)
          }}
        >
          {t('preview.fitPage')}
        </Button>
        {typeof document.documentElement.requestFullscreen === 'function' && (
          <Button
            variant="ghost"
            size="icon"
            aria-pressed={full}
            aria-label={t(
              full ? 'preview.exitFullscreen' : 'preview.fullscreen',
            )}
            title={t(full ? 'preview.exitFullscreen' : 'preview.fullscreen')}
            onClick={toggleFull}
          >
            {full ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </Button>
        )}
      </div>
      <div
        ref={area}
        role="region"
        className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4"
        tabIndex={0}
        aria-label={t('preview.pan')}
      >
        <p role="status" className="mb-2 text-sm text-muted-foreground">
          {loading
            ? t('common.processing')
            : error
              ? t('common.' + error)
              : bitmap?.limited
                ? t('preview.imageLimited')
                : t('preview.bounded')}
        </p>
        {bitmap && !error && (
          <img
            alt={t('common.previewPage', { page: page + 1 })}
            src={bitmap.url}
            className="mx-auto block max-w-none shadow-sm"
            style={{
              width:
                source.kind === 'images'
                  ? `${(fit === 'width' ? 100 : 70) * zoom}%`
                  : Math.min(
                      bounds.width / bitmap.ptW,
                      fit === 'width' ? Infinity : bounds.height / bitmap.ptH,
                    ) *
                    bitmap.ptW *
                    zoom,
              maxHeight:
                source.kind === 'images' && fit === 'page' && zoom === 1
                  ? bounds.height
                  : undefined,
              objectFit: 'contain',
              height: 'auto',
            }}
          />
        )}
      </div>
    </dialog>
  )
}
