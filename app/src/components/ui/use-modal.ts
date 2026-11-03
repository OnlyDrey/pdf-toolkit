import { useEffect, type RefObject } from 'react'
export function trapModalFocus(event: React.KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const controls = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      'button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]',
    ),
  ).filter((node) => node.getClientRects().length)
  const first = controls[0],
    last = controls[controls.length - 1]
  if (!first) {
    event.preventDefault()
    event.currentTarget.focus()
  } else if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}
export function useModal(
  ref: RefObject<HTMLDialogElement | null>,
  open: boolean,
) {
  useEffect(() => {
    if (!open) return
    const node = ref.current!
    const previous = document.activeElement
    const overflow = document.body.style.overflow
    node.showModal()
    document.body.style.overflow = 'hidden'
    node
      .querySelector<HTMLElement>('button:not(:disabled),[tabindex="0"]')
      ?.focus()
    return () => {
      node.close()
      document.body.style.overflow = overflow
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus()
    }
  }, [open, ref])
}
