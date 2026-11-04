import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from './button'

export type MenuAction = {
  key: string
  label: string
  icon?: ReactNode
  disabled?: boolean
  destructive?: boolean
  onSelect: () => void
}

// Disclosure menu: Escape/outside-click close, arrow keys move, focus returns to the trigger.
export function ActionsMenu({
  label,
  actions,
  disabled,
}: {
  label: string
  actions: MenuAction[]
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    id = useId()
  useEffect(() => {
    if (!open) return
    root.current
      ?.querySelector<HTMLElement>('[role=menuitem]:not(:disabled)')
      ?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const close = (restore = true) => {
    setOpen(false)
    if (restore) trigger.current?.focus()
  }
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Tab') return setOpen(false)
    const items = Array.from(
      root.current?.querySelectorAll<HTMLElement>(
        '[role=menuitem]:not(:disabled)',
      ) ?? [],
    )
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next =
      event.key === 'ArrowDown'
        ? (at + 1) % items.length
        : event.key === 'ArrowUp'
          ? (at - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : -1
    if (next >= 0) {
      event.preventDefault()
      items[next]?.focus()
    }
  }
  return (
    <div ref={root} className="relative" onKeyDown={open ? keys : undefined}>
      <Button
        ref={trigger}
        variant="outline"
        size="sm"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </Button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-40 mt-1 min-w-52 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {actions.map((action) => (
            <button
              key={action.key}
              type="button"
              role="menuitem"
              disabled={action.disabled}
              onClick={() => {
                close()
                action.onSelect()
              }}
              className={`flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-muted disabled:opacity-50 ${action.destructive ? 'text-destructive-text' : ''}`}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
