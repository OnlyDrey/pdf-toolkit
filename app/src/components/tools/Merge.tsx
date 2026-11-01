import { ProcessingStatus } from './ProcessingStatus'
import { useSession } from '@/lib/session-context'
import { loadPdf, PdfInputError, MAX_PDF_BYTES } from '@/lib/pdf-document'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Layers,
  AlertCircle,
  CheckCircle2,
  GripVertical,
  X,
} from 'lucide-react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { PDFDocument } from 'pdf-lib'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import { readFileAsArrayBuffer, formatFileSize } from '@/lib/pdf-utils'

interface PdfEntry {
  id: string
  file: File
}

function SortableItem({
  entry,
  onRemove,
}: {
  entry: PdfEntry
  onRemove: (id: string) => void
}) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id })
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-3 rounded-md border bg-card px-3 py-2"
    >
      <button
        type="button"
        aria-label={t('tools.merge.reorder') + ': ' + entry.file.name}
        {...attributes}
        {...listeners}
        className="flex min-h-8 min-w-8 items-center justify-center cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{entry.file.name}</p>
        <p className="text-xs text-muted-foreground">
          {formatFileSize(entry.file.size)}
        </p>
      </div>
      <button
        type="button"
        aria-label={t('common.remove') + ': ' + entry.file.name}
        onClick={() => onRemove(entry.id)}
        className="flex min-h-8 min-w-8 items-center justify-center text-muted-foreground hover:text-destructive-text"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

export function Merge() {
  const { t } = useTranslation()
  const { setSession } = useSession()
  const [entries, setEntries] = useState<PdfEntry[]>([])
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  const handleFiles = (files: File[]) => {
    setDone(false)
    setError(null)
    setEntries((prev) => [
      ...prev,
      ...files.map((f) => ({
        id: `${f.name}-${f.size}-${Date.now()}-${Math.random()}`,
        file: f,
      })),
    ])
  }
  const handleRemove = (id: string) =>
    setEntries((prev) => prev.filter((e) => e.id !== id))
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (over && active.id !== over.id) {
      setEntries((prev) => {
        const oi = prev.findIndex((e) => e.id === active.id)
        const ni = prev.findIndex((e) => e.id === over.id)
        if (oi === -1 || ni === -1) return prev
        return arrayMove(prev, oi, ni)
      })
    }
  }
  const handleMerge = async () => {
    if (entries.length < 2) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      if (entries.reduce((sum, e) => sum + e.file.size, 0) > MAX_PDF_BYTES)
        throw new PdfInputError('tooLarge')
      const merged = await PDFDocument.create()
      for (const e of entries) {
        const doc = await loadPdf(await readFileAsArrayBuffer(e.file))
        const pages = await merged.copyPages(doc, doc.getPageIndices())
        pages.forEach((p) => merged.addPage(p))
      }
      setSession(await merged.save(), 'merged.pdf')
      setDone(true)
    } catch (e) {
      setError(
        e instanceof PdfInputError
          ? t(`errors.${e.code}`)
          : t('errors.processing'),
      )
    } finally {
      setProcessing(false)
    }
  }
  const handleReset = () => {
    setEntries([])
    setDone(false)
    setError(null)
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="h-5 w-5" />
            {t('tools.merge.title')}
          </CardTitle>
          <CardDescription>{t('tools.merge.description')}</CardDescription>
        </CardHeader>
        <ProcessingStatus busy={processing} />
        <CardContent aria-busy={processing} className="space-y-6">
          <FileDropZone disabled={processing} multiple onFiles={handleFiles} />
          {entries.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Badge variant="secondary">
                    {t('tools.merge.fileCount', { count: entries.length })}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {t('tools.merge.reorder')}
                  </span>
                </div>
                <DndContext
                  sensors={sensors}
                  accessibility={{
                    screenReaderInstructions: {
                      draggable: t('tools.merge.keyboardInstructions'),
                    },
                    announcements: {
                      onDragStart: ({ active }) =>
                        t('tools.merge.pickedUp', {
                          name: entries.find((entry) => entry.id === active.id)
                            ?.file.name,
                        }),
                      onDragOver: ({ over }) =>
                        over
                          ? t('tools.merge.position', {
                              position:
                                entries.findIndex(
                                  (entry) => entry.id === over.id,
                                ) + 1,
                              count: entries.length,
                            })
                          : undefined,
                      onDragEnd: () => t('tools.merge.reorderDone'),
                      onDragCancel: () => t('common.cancel'),
                    },
                  }}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd}
                >
                  <SortableContext
                    items={entries.map((e) => e.id)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2">
                      {entries.map((e) => (
                        <SortableItem
                          key={e.id}
                          entry={e}
                          onRemove={handleRemove}
                        />
                      ))}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </>
          )}
          {entries.length === 1 && (
            <p className="text-sm text-muted-foreground">
              {t('tools.merge.minimumFiles')}
            </p>
          )}
          {error && (
            <div
              role="alert"
              id="merge-error"
              className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t('common.appliedToSession')}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleMerge}
              disabled={entries.length < 2 || processing}
              className="flex-1"
            >
              {processing ? t('common.processing') : t('tools.merge.action')}
            </Button>
            {entries.length > 0 && (
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
