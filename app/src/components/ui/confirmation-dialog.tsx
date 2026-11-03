import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './button'

// Native modal isolation, safe initial focus and the same dialog styling as Discard.
export function ConfirmationDialog({
  open,
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  const dialog = useRef<HTMLDialogElement>(null)
  const cancel = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const previous = document.activeElement
    const node = dialog.current!
    node.showModal()
    cancel.current?.focus()
    return () => {
      node.close()
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus()
    }
  }, [open])
  return (
    <dialog
      ref={dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={id + '-title'}
      aria-describedby={id + '-description'}
      className="confirmation-dialog"
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          'button:not(:disabled)',
        )
        const first = buttons[0],
          last = buttons[buttons.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last?.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first?.focus()
        }
      }}
    >
      <h2 id={id + '-title'} className="text-lg font-semibold">
        {title}
      </h2>
      <p
        id={id + '-description'}
        className="mt-2 text-sm text-muted-foreground"
      >
        {description}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <Button ref={cancel} variant="outline" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </dialog>
  )
}
