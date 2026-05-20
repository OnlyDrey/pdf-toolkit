import { useState, useCallback } from 'react'
import { ThemeProvider } from '@/components/layout/ThemeProvider'
import { Header } from '@/components/layout/Header'
import { NavTabs, type ToolTab } from '@/components/layout/NavTabs'
import { SessionBar } from '@/components/layout/SessionBar'
import { SessionContext, type SessionFile } from '@/lib/session-context'
import { Merge }      from '@/components/tools/Merge'
import { Compress }   from '@/components/tools/Compress'
import { Extract }    from '@/components/tools/Extract'
import { Rotate }     from '@/components/tools/Rotate'
import { Resize }     from '@/components/tools/Resize'
import { Crop }       from '@/components/tools/Crop'
import { VersionFix } from '@/components/tools/VersionFix'

export default function App() {
  const [activeTab, setActiveTab] = useState<ToolTab>('merge')
  const [session, setSessionState] = useState<SessionFile | null>(null)
  const setSession = useCallback((bytes: Uint8Array, name: string) => setSessionState({ bytes, name }), [])
  const clearSession = useCallback(() => setSessionState(null), [])
  return (
    <SessionContext.Provider value={{ session, setSession, clearSession }}>
      <ThemeProvider>
        <div className="min-h-screen bg-background">
          <Header />
          <NavTabs activeTab={activeTab} onTabChange={setActiveTab} />
          <SessionBar />
          <main className="mx-auto max-w-5xl px-4 py-8">
            <div className={activeTab === 'merge'      ? '' : 'hidden'}><Merge /></div>
            <div className={activeTab === 'compress'   ? '' : 'hidden'}><Compress /></div>
            <div className={activeTab === 'extract'    ? '' : 'hidden'}><Extract /></div>
            <div className={activeTab === 'rotate'     ? '' : 'hidden'}><Rotate /></div>
            <div className={activeTab === 'resize'     ? '' : 'hidden'}><Resize /></div>
            <div className={activeTab === 'crop'       ? '' : 'hidden'}><Crop /></div>
            <div className={activeTab === 'versionFix' ? '' : 'hidden'}><VersionFix /></div>
          </main>
        </div>
      </ThemeProvider>
    </SessionContext.Provider>
  )
}