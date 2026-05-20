import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, AlertCircle, CheckCircle2, Download } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import { readFileAsArrayBuffer, formatFileSize, downloadBlob } from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

const PDF_VERSIONS = ['1.0','1.1','1.2','1.3','1.4','1.5','1.6','1.7','2.0'] as const
type PdfVersion = (typeof PDF_VERSIONS)[number]

function detectVersion(b: Uint8Array) {
  const h = new TextDecoder('ascii', { fatal: false }).decode(b.slice(0, 1024))
  const m = h.match(/%PDF-(\d+\.\d+)/); return m ? m[1] : null
}
function rewriteVersion(bytes: Uint8Array, tv: PdfVersion): Uint8Array | null {
  const enc = new TextEncoder(), tgt = enc.encode(`%PDF-${tv}`), srch = enc.encode('%PDF-')
  const lim = Math.min(bytes.length, 1024)
  for (let i = 0; i < lim - 4; i++) {
    if (bytes[i]===srch[0]&&bytes[i+1]===srch[1]&&bytes[i+2]===srch[2]&&bytes[i+3]===srch[3]&&bytes[i+4]===srch[4]) {
      const p = new Uint8Array(bytes); for (let j = 0; j < tgt.length; j++) p[i+j] = tgt[j]; return p
    }
  }
  return null
}

export function VersionFix() {
  const { t } = useTranslation()
  const { session, setSession } = useSession()
  const [file, setFile] = useState<File|null>(null)
  const [ffs, setFfs] = useState(false)
  const [detected, setDetected] = useState<string|null>(null)
  const [targetVersion, setTargetVersion] = useState<PdfVersion>('1.7')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const [done, setDone] = useState(false)
  const [outBytes, setOutBytes] = useState<Uint8Array|null>(null)
  const [outName, setOutName] = useState('')

  const detect = async (f: File) => {
    try { const buf = await readFileAsArrayBuffer(f); setDetected(detectVersion(new Uint8Array(buf))) }
    catch { setDetected(null) }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session && (!file || ffs)) {
      const f = new File([session.bytes], session.name, { type: 'application/pdf' })
      setFile(f); setFfs(true); setDone(false); setError(null); setOutBytes(null); setOutName('')
      detect(f)
    } else if (!session && ffs) { setFile(null); setFfs(false); setDetected(null) }
  }, [session])

  const handleFile = async (files: File[]) => {
    const f = files[0]; setFile(f); setFfs(false)
    setDone(false); setError(null); setOutBytes(null); setOutName('')
    await detect(f)
  }

  const handleProcess = async () => {
    if (!file) return; setProcessing(true); setError(null); setDone(false)
    try {
      const buf = await readFileAsArrayBuffer(file)
      const patched = rewriteVersion(new Uint8Array(buf), targetVersion)
      if (!patched) { setError('Could not find the PDF header (%PDF-) in this file.'); return }
      const name = `${file.name.replace(/\.pdf$/i, '')}_v${targetVersion}.pdf`
      setSession(patched, name); setOutBytes(patched); setOutName(name); setDone(true)
    } catch(e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setProcessing(false) }
  }

  const handleReset = () => {
    setDone(false); setError(null); setOutBytes(null); setOutName('')
    if (session) {
      const f = new File([session.bytes], session.name, { type: 'application/pdf' })
      setFile(f); setFfs(true); detect(f)
    } else { setFile(null); setFfs(false); setDetected(null) }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5"/>{t('tools.versionFix.title')}</CardTitle>
          <CardDescription>{t('tools.versionFix.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FileDropZone onFiles={handleFile} hasFile={!!file}
            fileLabel={file ? `${file.name} (${formatFileSize(file.size)})` : undefined}
            sessionName={!file && session ? session.name : undefined}
            onUseSession={!file && session ? () => handleFile([new File([session.bytes], session.name, { type: 'application/pdf' })]) : undefined}/>
          {file && (<><Separator/>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">{t('tools.versionFix.currentVersion')}</Label>
                <div>{detected ? <Badge variant="outline">PDF {detected}</Badge> : <Badge variant="destructive">{t('tools.versionFix.unknown')}</Badge>}</div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="tv" className="text-xs text-muted-foreground">{t('tools.versionFix.targetVersion')}</Label>
                <Select value={targetVersion} onValueChange={v => setTargetVersion(v as PdfVersion)}>
                  <SelectTrigger id="tv" className="w-64"><SelectValue/></SelectTrigger>
                  <SelectContent>{PDF_VERSIONS.map(v => <SelectItem key={v} value={v}>{t(`tools.versionFix.versions.${v}`)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div></>)}
          {error && <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0"/>{error}</div>}
          {done && <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400"><CheckCircle2 className="h-4 w-4 shrink-0"/>{t('common.appliedToSession')}</div>}
          <div className="flex gap-2">
            <Button onClick={handleProcess} disabled={!file||processing} className="flex-1">
              {processing ? t('common.processing') : t('common.apply')}</Button>
            {done && outBytes && (
              <Button variant="outline" className="gap-1.5"
                onClick={() => downloadBlob(new Blob([outBytes], { type: 'application/pdf' }), outName)}>
                <Download className="h-4 w-4"/>{t('common.downloadResult')}</Button>)}
            {file && !done && <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}