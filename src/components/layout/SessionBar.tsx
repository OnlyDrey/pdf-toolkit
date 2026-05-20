import { FileText, Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useSession } from '@/lib/session-context'
import { downloadBlob } from '@/lib/pdf-utils'

function fmt(n: number) {
  return n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`
}

export function SessionBar() {
  const { t } = useTranslation()
  const { session, clearSession } = useSession()
  if (!session) return null

  const handleDownload = () =>
    downloadBlob(new Blob([session.bytes], { type: 'application/pdf' }), session.name)

  const handleSaveAndDownload = () => {
    downloadBlob(new Blob([session.bytes], { type: 'application/pdf' }), session.name)
    clearSession()
  }

  return (
    <div className="border-b bg-primary/5">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2">
        <FileText className="h-4 w-4 shrink-0 text-primary" />
        <span className="min-w-0 flex-1 truncate text-sm">
          <span className="text-muted-foreground">{t('session.working')}: </span>
          <span className="font-medium text-foreground">{session.name}</span>
          <span className="ml-1.5 text-xs text-muted-foreground">({fmt(session.bytes.byteLength)})</span>
        </span>
        <Button variant="ghost" size="sm" className="shrink-0 gap-1.5" onClick={handleDownload}>
          <Download className="h-3.5 w-3.5" />{t('session.download')}
        </Button>
        <Button size="sm" className="shrink-0 gap-1.5" onClick={handleSaveAndDownload}>
          <Download className="h-3.5 w-3.5" />{t('session.saveAndDownload')}
        </Button>
        <Button variant="ghost" size="sm"
          className="shrink-0 gap-1.5 text-muted-foreground hover:text-destructive"
          onClick={clearSession}>
          <X className="h-3.5 w-3.5" />{t('session.clear')}
        </Button>
      </div>
    </div>
  )
}