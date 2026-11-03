import { useTranslation } from 'react-i18next'
import { ActiveToolContext } from '@/lib/active-tool-context'
import { useState, useCallback } from 'react'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { WorkspaceShell } from '@/components/layout/WorkspaceShell'
import { SessionBar } from '@/components/layout/SessionBar'
import { SessionContext, type SessionFile } from '@/lib/session-context'
import { TOOLS, type ToolId } from '@/lib/tools'
export default function App() {
  const { t } = useTranslation()
  const [active, setActive] = useState<ToolId>('merge'),
    [session, setSessionState] = useState<SessionFile | null>(null)
  const setSession = useCallback(
    (bytes: Uint8Array, name: string) => setSessionState({ bytes, name }),
    [],
  )
  const clearSession = useCallback(() => setSessionState(null), [])
  return (
    <SessionContext.Provider value={{ session, setSession, clearSession }}>
      <ThemeProvider>
        <WorkspaceShell active={active} onSelect={setActive}>
          <SessionBar />
          <main
            id="main-content"
            tabIndex={-1}
            className="workspace-main mx-auto min-w-0 max-w-[1500px] px-4 py-6 md:px-7"
          >
            <header className="mb-6">
              <h1 className="text-2xl font-semibold tracking-tight">
                {t('tools.' + active + '.title')}
              </h1>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                {t('tools.' + active + '.description')}
              </p>
            </header>
            {TOOLS.map(({ id, component: Tool }) => (
              <div
                key={id}
                id={'tool-panel-' + id}
                role="region"
                aria-label={t('nav.' + id)}
                tabIndex={0}
                className={active === id ? 'workspace-tool' : 'hidden'}
              >
                <ActiveToolContext.Provider value={active === id}>
                  <Tool />
                </ActiveToolContext.Provider>
              </div>
            ))}
          </main>
        </WorkspaceShell>
      </ThemeProvider>
    </SessionContext.Provider>
  )
}
