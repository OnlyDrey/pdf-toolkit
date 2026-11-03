import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Undo2,
  Redo2,
  Upload,
  Download,
  Eye,
  RotateCw,
  Trash2,
  ArrowUp,
  ArrowDown,
} from 'lucide-react'
import { useSession, DocumentOperationError } from '@/lib/session-context'
import { loadPdf, PdfInputError } from '@/lib/pdf-document'
import { rotatePages, removePages, reorderPages } from '@/lib/pdf-operations'
import { formatFileSize, downloadBlob } from '@/lib/pdf-utils'
import { Button } from '@/components/ui/button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { PdfPageGrid } from '@/components/tools/PdfPageGrid'
import { DocumentViewer } from '@/components/tools/DocumentViewer'
import { moveSelectedPages } from '@/lib/page-order'

export function DocumentPanel() {
  const { t } = useTranslation(),
    {
      session,
      busy,
      operation,
      selectedIds,
      canUndo,
      canRedo,
      discarded,
      beginOperation,
      commitOperation,
      endOperation,
      clearSession,
      selectPages,
      undo,
      redo,
      markSaved,
    } = useSession()
  const openButton = useRef<HTMLButtonElement>(null),
    input = useRef<HTMLInputElement>(null),
    [error, setError] = useState(''),
    [view, setView] = useState(false),
    [confirm, setConfirm] = useState<'clear' | 'delete' | null>(null),
    [destination, setDestination] = useState('1')
  const selected = new Set(
    session?.pageIds.flatMap((id, i) =>
      selectedIds.includes(id) ? [i] : [],
    ) ?? [],
  )
  const fail = (reason: unknown) =>
    setError(
      reason instanceof PdfInputError
        ? t('errors.' + reason.code)
        : reason instanceof DocumentOperationError
          ? t('document.errors.' + reason.code)
          : t('document.errors.resource'),
    )
  const open = async (file: File) => {
    const token = beginOperation('open')
    if (!token) return
    setError('')
    try {
      await commitOperation(
        new Uint8Array(await file.arrayBuffer()),
        file.name,
        token,
        { replace: true, saved: true, sourceFile: file },
      )
    } catch (reason) {
      fail(reason)
    } finally {
      endOperation(token)
    }
  }
  const edit = async (
    kind: 'rotate' | 'delete' | 'reorder',
    order?: number[],
  ) => {
    if (
      !session ||
      (kind === 'reorder' && order?.every((page, index) => page === index))
    )
      return
    const token = beginOperation(kind)
    if (!token) return
    setError('')
    try {
      const doc = await loadPdf(session.bytes)
      let ids = session.pageIds
      if (kind === 'rotate') rotatePages(doc, Array.from(selected), 90)
      if (kind === 'delete') {
        removePages(doc, Array.from(selected))
        ids = ids.filter((_, i) => !selected.has(i))
      }
      if (kind === 'reorder' && order) {
        reorderPages(doc, order)
        ids = order.map((i) => ids[i])
      }
      await commitOperation(await doc.save(), session.name, token, {
        pageIds: ids,
      })
    } catch (reason) {
      fail(reason)
    } finally {
      endOperation(token)
    }
  }
  const download = (save = false) => {
    if (!session) return
    downloadBlob(session.file, session.name)
    if (save) markSaved()
  }
  const move = (direction: 'up' | 'down' | number) => {
    if (session)
      void edit(
        'reorder',
        moveSelectedPages(session.pageCount, selected, direction),
      )
  }
  return (
    <aside
      className="document-panel min-w-0 space-y-4 rounded-lg border bg-card p-4"
      aria-label={t('session.working')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">{t('session.working')}</h2>
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canUndo}
            onClick={undo}
            title={t('document.undo')}
            aria-label={t('document.undo')}
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy || !canRedo}
            onClick={redo}
            title={t('document.redo')}
            aria-label={t('document.redo')}
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        tabIndex={-1}
        aria-label={t('document.open')}
        disabled={busy}
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void open(file)
        }}
      />
      {session ? (
        <>
          <p
            className="break-words text-sm font-medium [overflow-wrap:anywhere]"
            data-document-name
          >
            {session.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatFileSize(session.file.size)} ·{' '}
            {t('document.pages', { count: session.pageCount })} ·{' '}
            <span role="status">
              {t(session.dirty ? 'document.unsaved' : 'document.saved')}
            </span>
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">{t('document.empty')}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          ref={openButton}
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => input.current?.click()}
        >
          <Upload className="mr-1 h-4 w-4" />
          {t(session ? 'document.replace' : 'document.open')}
        </Button>
        {session && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => download()}
            >
              <Download className="mr-1 h-4 w-4" />
              {t('session.download')}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => download(true)}>
              {t('session.saveAndDownload')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => setView(true)}
            >
              <Eye className="mr-1 h-4 w-4" />
              {t('document.preview')}
            </Button>
            <Button
              size="sm"
              variant="destructive-ghost"
              disabled={busy}
              onClick={() => setConfirm('clear')}
            >
              {t('session.clear')}
            </Button>
          </>
        )}
      </div>
      {session && (
        <>
          <details>
            <summary className="cursor-pointer text-sm">
              {t('document.info')}
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              {t('document.infoText', { revision: session.revision })}
            </p>
          </details>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span>{t('document.selected', { count: selected.size })}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => selectPages(session.pageIds)}
            >
              {t('document.selectAll')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !selected.size}
              onClick={() => selectPages([])}
            >
              {t('document.deselectAll')}
            </Button>
          </div>
          <div
            className="flex flex-wrap gap-1"
            role="group"
            aria-label={t('document.pageActions')}
          >
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !selected.size}
              onClick={() => void edit('rotate')}
            >
              <RotateCw className="mr-1 h-4 w-4" />
              {t('document.rotate')}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={
                busy || !selected.size || selected.size === session.pageCount
              }
              onClick={() => setConfirm('delete')}
            >
              <Trash2 className="mr-1 h-4 w-4" />
              {t('document.delete')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !selected.size}
              aria-label={t('document.up')}
              onClick={() => move('up')}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !selected.size}
              aria-label={t('document.down')}
              onClick={() => move('down')}
            >
              <ArrowDown className="h-4 w-4" />
            </Button>
          </div>
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="page-destination">{t('document.moveTo')}</label>
              <input
                id="page-destination"
                className="w-16 rounded border bg-background p-1"
                type="number"
                min="1"
                max={session.pageCount}
                value={destination}
                disabled={busy}
                onChange={(event) => setDestination(event.target.value)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={
                  busy ||
                  !Number.isInteger(Number(destination)) ||
                  Number(destination) < 1 ||
                  Number(destination) > session.pageCount
                }
                onClick={() => move(Number(destination) - 1)}
              >
                {t('document.move')}
              </Button>
            </div>
          )}
          <div id="current-document-pages">
            <PdfPageGrid
              file={session.file}
              count={session.pageCount}
              selected={selected}
              disabled={busy}
              pageIds={session.pageIds}
              onReorder={(order) => void edit('reorder', order)}
              onSelect={(index) => {
                const id = session.pageIds[index]
                selectPages(
                  selectedIds.includes(id)
                    ? selectedIds.filter((item) => item !== id)
                    : [...selectedIds, id],
                )
              }}
            />
          </div>
        </>
      )}
      {busy && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('document.processing', {
            operation: t('document.operations.' + operation),
          })}
        </p>
      )}
      {discarded > 0 && (
        <p role="status" className="text-xs text-muted-foreground">
          {t('document.historyLimit')}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive-text">
          {error}
        </p>
      )}
      {view && session && (
        <DocumentViewer
          source={{ kind: 'pdf', file: session.file, pages: session.pageCount }}
          onClose={() => setView(false)}
        />
      )}
      <ConfirmationDialog
        open={confirm !== null}
        title={t(
          confirm === 'clear' ? 'session.confirmTitle' : 'document.deleteTitle',
        )}
        description={t(
          confirm === 'clear'
            ? 'document.clearDescription'
            : 'document.deleteDescription',
          { count: selected.size },
        )}
        confirmLabel={t(
          confirm === 'clear' ? 'session.clear' : 'document.delete',
        )}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          setConfirm(null)
          if (confirm === 'clear') {
            clearSession()
            requestAnimationFrame(() => openButton.current?.focus())
          } else void edit('delete')
        }}
      />
    </aside>
  )
}
