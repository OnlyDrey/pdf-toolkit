import { useRef } from 'react'
import { FileText, Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session-context'
import { downloadBlob } from '@/lib/pdf-utils'

function fmt(n: number) {
  return n >= 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.round(n / 1024)} KB`
}

export function SessionBar() {
  const { t } = useTranslation()
  const { session, clearSession } = useSession()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const discard = useRef<HTMLButtonElement>(null)
  const restoreToolFocus = () =>
    requestAnimationFrame(() =>
      document
        .querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')
        ?.focus(),
    )
  if (!session) return null

  const handleDownload = () =>
    downloadBlob(
      new Blob([new Uint8Array(session.bytes)], { type: 'application/pdf' }),
      session.name,
    )

  const handleSaveAndDownload = () => {
    downloadBlob(
      new Blob([new Uint8Array(session.bytes)], { type: 'application/pdf' }),
      session.name,
    )
    clearSession()
    restoreToolFocus()
  }

  return (
    <section
      aria-label={t('session.working')}
      className="border-b bg-primary/5"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 px-4 py-2">
        <FileText className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">
            {t('session.working')}:{' '}
          </span>
          <span className="font-medium text-foreground" title={session.name}>
            {session.name}
          </span>
          <span className="ml-1.5 text-xs text-muted-foreground">
            ({fmt(session.bytes.byteLength)})
          </span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={handleDownload}
        >
          <Download className="h-3.5 w-3.5" />
          {t('session.download')}
        </Button>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={handleSaveAndDownload}
        >
          <Download className="h-3.5 w-3.5" />
          {t('session.saveAndDownload')}
        </Button>
        <Button
          ref={discard}
          variant="destructive-ghost"
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => {
            dialog.current?.showModal()
            cancel.current?.focus()
          }}
        >
          <X className="h-3.5 w-3.5" />
          {t('session.clear')}
        </Button>
      </div>
      <dialog
        ref={dialog}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="discard-title"
        aria-describedby="discard-description"
        className="confirmation-dialog"
        onCancel={(event) => {
          event.preventDefault()
          dialog.current?.close()
          discard.current?.focus()
        }}
      >
        <h2 id="discard-title" className="text-lg font-semibold">
          {t('session.confirmTitle')}
        </h2>
        <p
          id="discard-description"
          className="mt-2 text-sm text-muted-foreground"
        >
          {t('session.confirmDescription')}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            ref={cancel}
            variant="outline"
            onClick={() => {
              dialog.current?.close()
              discard.current?.focus()
            }}
          >
            {t('common.cancel')}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              dialog.current?.close()
              clearSession()
              restoreToolFocus()
            }}
          >
            {t('session.clear')}
          </Button>
        </div>
      </dialog>
    </section>
  )
}
