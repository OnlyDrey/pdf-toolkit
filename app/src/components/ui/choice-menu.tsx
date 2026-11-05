import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check } from 'lucide-react'
import { Button } from './button'

export type Choice = { value: string; label: string; icon?: ReactNode }

// Compact icon button with a radio-style dropdown (theme, language).
export function ChoiceMenu({
  label,
  icon,
  choices,
  value,
  onChange,
}: {
  label: string
  icon: ReactNode
  choices: Choice[]
  value: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null),
    trigger = useRef<HTMLButtonElement>(null),
    id = useId()
  useEffect(() => {
    if (!open) return
    root.current
      ?.querySelector<HTMLElement>('[role=menuitemradio][aria-checked=true]')
      ?.focus()
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [open])
  const close = () => {
    setOpen(false)
    trigger.current?.focus()
  }
  const keys = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key === 'Tab') return setOpen(false)
    const items = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[role=menuitemradio]') ?? [],
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
        variant="ghost"
        size="icon"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen(!open)}
      >
        {icon}
      </Button>
      {open && (
        <div
          id={id}
          role="menu"
          aria-label={label}
          className="absolute right-0 z-50 mt-1 min-w-40 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {choices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              role="menuitemradio"
              aria-checked={choice.value === value}
              onClick={() => {
                onChange(choice.value)
                close()
              }}
              className="flex min-h-10 w-full items-center gap-2 rounded px-3 text-left text-sm hover:bg-muted"
            >
              {choice.icon}
              <span className="flex-1">{choice.label}</span>
              {choice.value === value && (
                <Check aria-hidden="true" className="h-4 w-4" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
