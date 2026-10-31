import { useActiveTool } from '@/lib/active-tool-context'
import { loadPdf, PdfInputError } from '@/lib/pdf-document'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Minimize2,
  AlertCircle,
  CheckCircle2,
  Info,
  Download,
} from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import {
  readFileAsArrayBuffer,
  formatFileSize,
  downloadBlob,
} from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

export function Compress() {
  const { t } = useTranslation()
  const active = useActiveTool()
  const lastOutput = useRef<Uint8Array | null>(null)
  const { session, setSession } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [ffs, setFfs] = useState(false) // fileFromSession
  const [origSize, setOrigSize] = useState<number | null>(null)
  const [compSize, setCompSize] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [outBytes, setOutBytes] = useState<Uint8Array | null>(null)
  const [outName, setOutName] = useState('')

  useEffect(() => {
    if (!active || (session && session.bytes === lastOutput.current)) return
    if (session && (!file || ffs)) {
      const f = new File([new Uint8Array(session.bytes)], session.name, {
        type: 'application/pdf',
      })
      setFile(f)
      setOrigSize(session.bytes.byteLength)
      setFfs(true)
      setCompSize(null)
      setDone(false)
      setError(null)
      setOutBytes(null)
      setOutName('')
    } else if (!session && ffs) {
      setFile(null)
      setFfs(false)
      setOrigSize(null)
    }
  }, [session, active])

  const handleFile = (files: File[]) => {
    const f = files[0]
    setFile(f)
    setOrigSize(f.size)
    setFfs(false)
    setCompSize(null)
    setDone(false)
    setError(null)
    setOutBytes(null)
    setOutName('')
  }

  const handleProcess = async () => {
    if (!file) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      setOrigSize(file.size)
      const original = new Uint8Array(await readFileAsArrayBuffer(file))
      const doc = await loadPdf(original)
      const candidate = await doc.save({ useObjectStreams: true })
      const pdfBytes = candidate.length < original.length ? candidate : original
      const name = `${file.name.replace(/\.pdf$/i, '')}_compressed.pdf`
      setCompSize(candidate.length)
      lastOutput.current = pdfBytes
      setSession(pdfBytes, name)
      setFile(
        new File([new Uint8Array(pdfBytes)], name, { type: 'application/pdf' }),
      )
      setFfs(true)
      setOutBytes(pdfBytes)
      setOutName(name)
      setDone(true)
    } catch (e) {
      setError(
        e instanceof PdfInputError
          ? t(`errors.${e.code}`)
          : t('errors.processing'),
      )
    } finally {
      setProcessing(false)
    }
  }

  const handleReset = () => {
    setCompSize(null)
    setDone(false)
    setError(null)
    setOutBytes(null)
    setOutName('')
    if (session) {
      const f = new File([new Uint8Array(session.bytes)], session.name, {
        type: 'application/pdf',
      })
      setFile(f)
      setOrigSize(session.bytes.byteLength)
      setFfs(true)
    } else {
      setFile(null)
      setFfs(false)
      setOrigSize(null)
    }
  }

  const reduction =
    origSize && compSize
      ? Math.round(((origSize - compSize) / origSize) * 100)
      : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Minimize2 className="h-5 w-5" />
            {t('tools.compress.title')}
          </CardTitle>
          <CardDescription>{t('tools.compress.description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <FileDropZone
            onFiles={handleFile}
            hasFile={!!file}
            fileLabel={
              file ? `${file.name} (${formatFileSize(file.size)})` : undefined
            }
            sessionName={!file && session ? session.name : undefined}
            onUseSession={
              !file && session
                ? () =>
                    handleFile([
                      new File([new Uint8Array(session.bytes)], session.name, {
                        type: 'application/pdf',
                      }),
                    ])
                : undefined
            }
          />
          <div className="flex items-start gap-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {t('tools.compress.note')}
          </div>
          {done && origSize && compSize && (
            <>
              <Separator />
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t('tools.compress.originalSize')}
                  </p>
                  <p className="mt-1 font-medium">{formatFileSize(origSize)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t('tools.compress.reduction')}
                  </p>
                  <p className="mt-1 font-medium text-green-600 dark:text-green-400">
                    {reduction === null
                      ? '~0%'
                      : `${reduction > 0 ? '-' : '+'}${Math.abs(reduction)}%`}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t('tools.compress.compressedSize')}
                  </p>
                  <p className="mt-1 font-medium">{formatFileSize(compSize)}</p>
                </div>
              </div>
              {reduction !== null && reduction <= 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('tools.compress.noReduction')}
                </p>
              )}
            </>
          )}
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {done && (
            <div
              role="status"
              className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {t('common.appliedToSession')}
            </div>
          )}
          <div className="flex gap-2">
            <Button
              onClick={handleProcess}
              disabled={!file || processing}
              className="flex-1"
            >
              {processing ? t('common.processing') : t('common.apply')}
            </Button>
            {done && outBytes && (
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={() =>
                  downloadBlob(
                    new Blob([new Uint8Array(outBytes)], {
                      type: 'application/pdf',
                    }),
                    outName,
                  )
                }
              >
                <Download className="h-4 w-4" />
                {t('common.downloadResult')}
              </Button>
            )}
            {file && !done && (
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
