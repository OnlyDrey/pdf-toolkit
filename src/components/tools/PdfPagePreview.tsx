import { useActiveTool } from '@/lib/active-tool-context'
import { useTranslation } from 'react-i18next'
import { MAX_PDF_BYTES } from '@/lib/pdf-document'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentLoadingTask,
  type RenderTask,
} from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

// Vite resolves new URL(..., import.meta.url) to bundle/copy the worker file
GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).href

export interface PageDimensions {
  canvasW: number // rendered canvas width px
  canvasH: number // rendered canvas height px
  ptW: number // original page width in PDF points
  ptH: number // original page height in PDF points
}

interface PdfPagePreviewProps {
  file: File
  pageNumber?: number // 1-indexed, default 1
  maxWidth?: number // default 280
  rotateDeg?: number // CSS rotation, default 0
  className?: string
  onDimensions?: (dims: PageDimensions) => void
  children?: ReactNode // overlays rendered on top of canvas
}

/**
 * Renders a single PDF page to a canvas via pdf.js web worker.
 * Children are rendered absolutely on top once the canvas is ready.
 */
export function PdfPagePreview({
  file,
  pageNumber = 1,
  maxWidth = 280,
  rotateDeg = 0,
  className,
  onDimensions,
  children,
}: PdfPagePreviewProps) {
  const active = useActiveTool()
  const { t } = useTranslation()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let task: PDFDocumentLoadingTask | undefined
    let render: RenderTask | undefined
    setLoading(true)
    setError(false)
    setReady(false)

    ;(async () => {
      try {
        if (file.size > MAX_PDF_BYTES) throw new Error('tooLarge')
        const buf = await file.arrayBuffer()
        if (cancelled) return
        task = getDocument({ data: new Uint8Array(buf) })
        const pdf = await task.promise
        if (cancelled) {
          void task.destroy()
          return
        }
        const page = await pdf.getPage(pageNumber)
        if (cancelled) {
          void task.destroy()
          return
        }

        const rawVP = page.getViewport({ scale: 1 })
        const scale = Math.min(maxWidth / rawVP.width, 800 / rawVP.height)
        const vp = page.getViewport({ scale })

        const canvas = canvasRef.current
        if (!canvas) {
          void task.destroy()
          return
        }
        canvas.width = Math.round(vp.width)
        canvas.height = Math.round(vp.height)

        const ctx = canvas.getContext('2d')!
        render = page.render({ canvas, canvasContext: ctx, viewport: vp })
        await render.promise
        if (cancelled) {
          void task.destroy()
          return
        }

        onDimensions?.({
          canvasW: canvas.width,
          canvasH: canvas.height,
          ptW: rawVP.width,
          ptH: rawVP.height,
        })
        setLoading(false)
        setReady(true)
        void task.destroy()
      } catch {
        void task?.destroy()
        if (!cancelled) {
          setError(true)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
      render?.cancel()
      void task?.destroy()
    }
  }, [file, pageNumber, maxWidth, onDimensions, active])

  if (error)
    return (
      <p role="status" className="text-xs text-muted-foreground">
        {t('common.previewUnavailable')}
      </p>
    )

  return (
    <div
      className={cn('relative inline-block', className)}
      style={{
        transform: rotateDeg ? `rotate(${rotateDeg}deg)` : undefined,
        transition: 'transform 0.35s cubic-bezier(0.4,0,0.2,1)',
      }}
    >
      {loading && (
        <div
          className="flex items-center justify-center rounded border bg-muted/30"
          style={{ width: maxWidth, height: Math.round(maxWidth * 1.414) }}
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      )}
      <canvas
        ref={canvasRef}
        className={cn('block rounded border shadow-sm', loading && 'hidden')}
      />
      {ready && children}
    </div>
  )
}
