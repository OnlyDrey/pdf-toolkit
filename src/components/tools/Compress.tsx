import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Minimize2, AlertCircle, CheckCircle2, Info, Download } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import { readFileAsArrayBuffer, formatFileSize, downloadBlob } from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

export function Compress() {
  const { t } = useTranslation()
  const { session, setSession } = useSession()
  const [file, setFile] = useState<File|null>(null)
  const [ffs, setFfs] = useState(false) // fileFromSession
  const [origSize, setOrigSize] = useState<number|null>(null)
  const [compSize, setCompSize] = useState<number|null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string|null>(null)
  const [done, setDone] = useState(false)
  const [outBytes, setOutBytes] = useState<Uint8Array|null>(null)
  const [outName, setOutName] = useState('')

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (session && (!file || ffs)) {
      const f = new File([session.bytes], session.name, { type: 'application/pdf' })
      setFile(f); setOrigSize(session.bytes.byteLength); setFfs(true)
      setCompSize(null); setDone(false); setError(null); setOutBytes(null); setOutName('')
    } else if (!session && ffs) {
      setFile(null); setFfs(false); setOrigSize(null)
    }
  }, [session])

  const handleFile = (files: File[]) => {
    const f = files[0]; setFile(f); setOrigSize(f.size); setFfs(false)
    setCompSize(null); setDone(false); setError(null); setOutBytes(null); setOutName('')
  }

  const handleProcess = async () => {
    if (!file) return; setProcessing(true); setError(null); setDone(false)
    try {
      const doc = await PDFDocument.load(await readFileAsArrayBuffer(file))
      const pdfBytes = await doc.save({ useObjectStreams: true })
      const name = `${file.name.replace(/\.pdf$/i, '')}_compressed.pdf`
      setCompSize(pdfBytes.length); setSession(pdfBytes, name)
      setOutBytes(pdfBytes); setOutName(name); setDone(true)
    } catch(e) { setError(e instanceof Error ? e.message : 'Unknown error') }
    finally { setProcessing(false) }
  }

  const handleReset = () => {
    setCompSize(null); setDone(false); setError(null); setOutBytes(null); setOutName('')
    if (session) {
      const f = new File([session.bytes], session.name, { type: 'application/pdf' })
      setFile(f); setOrigSize(session.bytes.byteLength); setFfs(true)
    } else { setFile(null); setFfs(false); setOrigSize(null) }
  }

  const reduction = origSize && compSize
    ? Math.max(0, Math.round(((origSize - compSize) / origSize) * 100)) : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Minimize2 className="h-5 w-5"/>{t('tools.compress.title')}
          </CardTitle>
          <CardDescription>{t('tools.compress.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FileDropZone onFiles={handleFile} hasFile={!!file}
            fileLabel={file ? `${file.name} (${formatFileSize(file.size)})` : undefined}
            sessionName={!file && session ? session.name : undefined}
            onUseSession={!file && session ? () => handleFile([new File([session.bytes], session.name, { type: 'application/pdf' })]) : undefined}/>
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0"/>{t('tools.compress.note')}
          </div>
          {done && origSize && compSize && (<><Separator/>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div><p className="text-xs text-muted-foreground">{t('tools.compress.originalSize')}</p>
                <p className="mt-1 font-medium">{formatFileSize(origSize)}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('tools.compress.reduction')}</p>
                <p className="mt-1 font-medium text-green-600 dark:text-green-400">
                  {reduction && reduction > 0 ? `-${reduction}%` : '~0%'}</p></div>
              <div><p className="text-xs text-muted-foreground">{t('tools.compress.compressedSize')}</p>
                <p className="mt-1 font-medium">{formatFileSize(compSize)}</p></div>
            </div>
            {reduction === 0 && <p className="text-xs text-muted-foreground">{t('tools.compress.noReduction')}</p>}
          </>)}
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