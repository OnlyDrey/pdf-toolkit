import { useRef, useState, type ReactNode } from 'react'
import { Menu, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { TOOLS, TOOL_GROUPS, type ToolId } from '@/lib/tools'
import { useMedia } from '@/lib/use-media'
import { useModal, trapModalFocus } from '@/components/ui/use-modal'
import { Brand, AppearanceControls } from './Header'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
export function WorkspaceShell({
  active,
  onSelect,
  children,
}: {
  active: ToolId
  onSelect: (id: ToolId) => void
  children: ReactNode
}) {
  const { t } = useTranslation(),
    desktop = useMedia('(min-width: 768px)'),
    wide = useMedia('(min-width: 1100px)')
  const [preference, setPreference] = useState<boolean | null>(() => {
    try {
      const saved = localStorage.getItem('pdf-toolkit-sidebar-collapsed')
      return saved === null ? null : saved === 'true'
    } catch {
      return null
    }
  })
  const collapsed = preference ?? !wide
  const [open, setOpen] = useState(false),
    dialog = useRef<HTMLDialogElement>(null)
  useModal(dialog, open && !desktop)
  const choose = (id: ToolId) => {
    onSelect(id)
    if (!desktop) {
      setOpen(false)
      requestAnimationFrame(() =>
        document.getElementById('tool-panel-' + id)?.focus(),
      )
    }
  }
  const navigation = (
    <nav aria-label={t('nav.tools')} className="space-y-5">
      {TOOL_GROUPS.map((group) => (
        <section key={group} aria-label={t('workspace.' + group)}>
          <h2
            className={cn(
              'mb-2 px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground',
              desktop && collapsed && 'sr-only',
            )}
          >
            {t('workspace.' + group)}
          </h2>
          <div className="space-y-1">
            {TOOLS.filter((tool) => tool.category === group).map(
              ({ id, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  id={'tool-tab-' + id}
                  data-tool={id}
                  aria-current={active === id ? 'page' : undefined}
                  aria-controls={'tool-panel-' + id}
                  onClick={() => choose(id)}
                  title={
                    desktop && collapsed
                      ? t('nav.' + id)
                      : t('tools.' + id + '.description')
                  }
                  aria-label={t('nav.' + id)}
                  className={cn(
                    'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-muted',
                    active === id
                      ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                      : 'text-muted-foreground hover:text-foreground',
                    desktop && collapsed && 'justify-center px-2',
                  )}
                >
                  <Icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  <span className={desktop && collapsed ? 'sr-only' : ''}>
                    {t('nav.' + id)}
                  </span>
                </button>
              ),
            )}
          </div>
        </section>
      ))}
    </nav>
  )
  const sidebar = (
    <>
      <div className="mb-7 flex min-h-10 items-center justify-between gap-2">
        {!desktop || !collapsed ? (
          <Brand />
        ) : (
          <span
            role="img"
            aria-label={t('app.title')}
            className="brand-mark mx-auto h-6 w-6 bg-foreground"
          />
        )}
        {!desktop && (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('workspace.closeNav')}
            onClick={() => setOpen(false)}
          >
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>
      {navigation}
      {desktop && (
        <Button
          variant="ghost"
          className="mt-auto w-full gap-2"
          aria-label={t(collapsed ? 'workspace.expand' : 'workspace.collapse')}
          title={t(collapsed ? 'workspace.expand' : 'workspace.collapse')}
          onClick={() => {
            const next = !collapsed
            setPreference(next)
            try {
              localStorage.setItem(
                'pdf-toolkit-sidebar-collapsed',
                String(next),
              )
            } catch {
              /* Preference storage is optional. */
            }
          }}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-5 w-5" />
          ) : (
            <>
              <PanelLeftClose className="h-5 w-5" />
              {t('workspace.collapse')}
            </>
          )}
        </Button>
      )}
    </>
  )
  return (
    <div
      className="min-h-screen bg-background md:grid"
      style={{
        gridTemplateColumns: desktop
          ? `${collapsed ? 76 : 248}px minmax(0,1fr)`
          : undefined,
      }}
    >
      <a href="#main-content" className="skip-link">
        {t('common.skipToContent')}
      </a>
      {desktop ? (
        <aside className="sticky top-0 flex h-screen flex-col gap-3 overflow-y-auto border-r bg-card p-3">
          {sidebar}
        </aside>
      ) : (
        <dialog
          ref={dialog}
          aria-label={t('nav.tools')}
          className="workspace-drawer"
          onCancel={(event) => {
            event.preventDefault()
            setOpen(false)
          }}
          onKeyDown={trapModalFocus}
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              const bounds = event.currentTarget.getBoundingClientRect()
              if (
                event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom
              )
                setOpen(false)
            }
          }}
        >
          {sidebar}
        </dialog>
      )}
      <div className="min-w-0">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 md:px-7">
          {!desktop ? (
            <div className="flex min-w-0 max-w-full items-center gap-2">
              <Button
                id="workspace-menu"
                variant="ghost"
                size="icon"
                aria-label={t('workspace.openNav')}
                aria-expanded={open}
                onClick={() => setOpen(true)}
              >
                <Menu className="h-5 w-5" />
              </Button>
              <Brand />
            </div>
          ) : (
            <span className="text-sm text-muted-foreground">
              {t('workspace.local')}
            </span>
          )}
          <AppearanceControls />
        </header>
        {children}
      </div>
    </div>
  )
}
