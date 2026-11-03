import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Images,
  GripVertical,
  X,
  AlertCircle,
  CheckCircle2,
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { FileDropZone } from './FileDropZone'
import { useSession } from '@/lib/session-context'
import { formatFileSize } from '@/lib/pdf-utils'
import {
  prepareImage,
  releaseImage,
  imagesToPdf,
  validateImageBatch,
  DEFAULT_IMAGE_OPTIONS,
  ImageInputError,
  type ImageEntry,
  type ImagePdfOptions,
} from '@/lib/images-runtime'

function ImageRow({
  entry,
  disabled,
  remove,
}: {
  entry: ImageEntry
  disabled: boolean
  remove: () => void
}) {
  const { t } = useTranslation()
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: entry.id, disabled })
  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded-md border bg-card p-2"
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={t('tools.images.reorder', { name: entry.file.name })}
        className="flex min-h-[32px] min-w-[32px] cursor-grab touch-none items-center justify-center text-muted-foreground disabled:opacity-50"
      >
        <GripVertical className="h-4 w-4" />
      </button>
      {entry.thumbnail ? (
        <img
          src={entry.thumbnail}
          alt=""
          width={48}
          height={48}
          className="h-[48px] w-[48px] shrink-0 rounded bg-muted object-contain"
        />
      ) : (
        <Images
          aria-label={t('common.previewUnavailable')}
          className="h-12 w-12 shrink-0"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
          {entry.file.name}
        </p>
        <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {t('tools.images.dimensions', {
            width: entry.width,
            height: entry.height,
          })}{' '}
          · {formatFileSize(entry.file.size)}
        </p>
      </div>
      <button
        id={'image-remove-' + entry.id}
        type="button"
        disabled={disabled}
        onClick={remove}
        aria-label={t('common.remove') + ': ' + entry.file.name}
        className="flex min-h-[32px] min-w-[32px] items-center justify-center text-muted-foreground hover:text-destructive-text disabled:opacity-50"
      >
        <X className="h-4 w-4" />
      </button>
    </li>
  )
}
export function ImagesToPdf() {
  const { t } = useTranslation()
  const { session, setSession } = useSession()
  const sessionRef = useRef(session)
  sessionRef.current = session
  const [entries, setEntries] = useState<ImageEntry[]>([])
  const entriesRef = useRef<ImageEntry[]>([])
  const mounted = useRef(true)
  const lock = useRef(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [progress, setProgress] = useState<{
    stage: 'preparing' | 'converting'
    done: number
    total: number
  } | null>(null)
  const [error, setError] = useState<{ code: string; name?: string } | null>(
    null,
  )
  const [options, setOptions] = useState<ImagePdfOptions>({
    ...DEFAULT_IMAGE_OPTIONS,
  })
  const [confirming, setConfirming] = useState(false)
  const upload = useRef<HTMLDivElement>(null)
  const convertButton = useRef<HTMLButtonElement>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      entriesRef.current.forEach((entry) => releaseImage(entry))
    }
  }, [])
  const replace = (next: ImageEntry[]) => {
    entriesRef.current = next
    setEntries(next)
    setDone(false)
  }
  const showError = (reason: unknown, name?: string) =>
    setError({
      code: reason instanceof ImageInputError ? reason.code : 'processing',
      name,
    })
  const addFiles = async (files: File[]) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setDone(false)
    setError(null)
    const staged: ImageEntry[] = []
    let name: string | undefined
    try {
      validateImageBatch([
        ...entriesRef.current.map((entry) => entry.file),
        ...files,
      ])
      for (let n = 0; n < files.length; n++) {
        name = files[n].name
        setProgress({ stage: 'preparing', done: n + 1, total: files.length })
        staged.push(await prepareImage(files[n]))
        if (!mounted.current) return
        const all = [...entriesRef.current, ...staged]
        validateImageBatch(all.map((entry) => entry.file))
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
      replace([...entriesRef.current, ...staged])
      staged.length = 0
    } catch (reason) {
      if (mounted.current) showError(reason, name)
    } finally {
      staged.forEach((entry) => releaseImage(entry))
      lock.current = false
      if (mounted.current) {
        setBusy(false)
        setProgress(null)
      }
    }
  }
  const remove = (id: string) => {
    if (lock.current) return
    const index = entriesRef.current.findIndex((entry) => entry.id === id)
    const entry = entriesRef.current[index]
    if (!entry) return
    releaseImage(entry)
    const next = entriesRef.current.filter((entry) => entry.id !== id)
    replace(next)
    setError(null)
    requestAnimationFrame(() => {
      const target = next[Math.min(index, next.length - 1)]
      if (target) document.getElementById('image-remove-' + target.id)?.focus()
      else upload.current?.querySelector<HTMLElement>('[role=button]')?.focus()
    })
  }
  const clear = () => {
    if (lock.current) return
    entriesRef.current.forEach((entry) => releaseImage(entry))
    replace([])
    setError(null)
    upload.current?.querySelector<HTMLElement>('[role=button]')?.focus()
  }
  const reorder = ({ active, over }: DragEndEvent) => {
    if (lock.current || !over || active.id === over.id) return
    const before = entriesRef.current.findIndex(
        (entry) => entry.id === active.id,
      ),
      after = entriesRef.current.findIndex((entry) => entry.id === over.id)
    if (before >= 0 && after >= 0)
      replace(arrayMove(entriesRef.current, before, after))
  }
  const convert = async () => {
    if (lock.current || !entriesRef.current.length) return
    const previousSession = sessionRef.current
    lock.current = true
    setBusy(true)
    setError(null)
    setDone(false)
    setProgress({
      stage: 'converting',
      done: 0,
      total: entriesRef.current.length,
    })
    try {
      const bytes = await imagesToPdf(
        entriesRef.current,
        options,
        (done, total) => {
          if (mounted.current) setProgress({ stage: 'converting', done, total })
        },
      )
      if (mounted.current) {
        if (sessionRef.current !== previousSession) {
          setError({ code: 'sessionChanged' })
          return
        }
        setSession(bytes, 'images.pdf')
        setDone(true)
      }
    } catch (reason) {
      if (mounted.current) showError(reason)
    } finally {
      lock.current = false
      if (mounted.current) {
        setBusy(false)
        setProgress(null)
        requestAnimationFrame(() => convertButton.current?.focus())
      }
    }
  }
  const field = (key: keyof ImagePdfOptions, values: string[]) => (
    <div className="min-w-0 space-y-2" key={key}>
      <Label htmlFor={'images-' + key}>{t('tools.images.' + key)}</Label>
      <Select
        value={options[key]}
        disabled={busy}
        onValueChange={(value) => {
          setOptions((previous) => ({ ...previous, [key]: value }))
          setDone(false)
        }}
      >
        <SelectTrigger id={'images-' + key}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {values.map((value) => (
            <SelectItem key={value} value={value}>
              {t('tools.images.' + value)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="tool-card">
        <CardHeader className="tool-heading">
          <CardTitle className="flex items-center gap-2">
            <Images className="h-5 w-5" />
            {t('tools.images.title')}
          </CardTitle>
          <CardDescription>{t('tools.images.description')}</CardDescription>
        </CardHeader>
        <p
          role="status"
          aria-live="polite"
          className="px-4 text-sm text-muted-foreground sm:px-6"
        >
          {progress
            ? t('tools.images.' + progress.stage, progress)
            : done
              ? t('common.appliedToSession')
              : ''}
        </p>
        <CardContent aria-busy={busy} className="space-y-5">
          <div ref={upload}>
            <FileDropZone
              kind="image"
              multiple
              disabled={busy}
              onFiles={(files) => void addFiles(files)}
            />
          </div>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('tools.images.frameNote')}
          </p>
          {entries.length > 0 && (
            <section
              aria-label={t('tools.images.selected')}
              className="space-y-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="secondary">
                  {t('tools.images.count', { count: entries.length })}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={clear}
                >
                  {t('tools.images.clear')}
                </Button>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={reorder}
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
              >
                <SortableContext
                  items={entries.map((entry) => entry.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <ol className="space-y-2">
                    {entries.map((entry) => (
                      <ImageRow
                        key={entry.id}
                        entry={entry}
                        disabled={busy}
                        remove={() => remove(entry.id)}
                      />
                    ))}
                  </ol>
                </SortableContext>
              </DndContext>
            </section>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {field('size', ['a4', 'letter', 'original'])}
            {field('orientation', ['auto', 'portrait', 'landscape'])}
            {field('fit', ['contain', 'cover'])}
            {field('margin', ['none', 'small', 'normal'])}
          </div>
          <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
            {t('tools.images.sizingNote')}
          </p>
          {error && (
            <div
              role="alert"
              className="flex gap-2 text-sm text-destructive-text"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="min-w-0 [overflow-wrap:anywhere]">
                {error.name && (
                  <span className="font-medium">{error.name}: </span>
                )}
                {t('tools.images.errors.' + error.code)}
              </p>
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
              <CheckCircle2 className="h-4 w-4" />
              {t('tools.images.success')}
            </div>
          )}
          <Button
            ref={convertButton}
            className="w-full"
            disabled={busy || !entries.length}
            onClick={() => {
              if (lock.current) return
              if (session) setConfirming(true)
              else void convert()
            }}
          >
            {busy ? t('common.processing') : t('tools.images.action')}
          </Button>
        </CardContent>
      </Card>
      <ConfirmationDialog
        open={confirming}
        title={t('tools.images.replaceTitle')}
        description={t('tools.images.replaceDescription')}
        confirmLabel={t('tools.images.replaceAction')}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false)
          void convert()
        }}
      />
    </div>
  )
}
