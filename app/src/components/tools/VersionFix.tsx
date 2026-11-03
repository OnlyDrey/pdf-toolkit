import { ProcessingStatus } from './ProcessingStatus'
import { useActiveTool } from '@/lib/active-tool-context'
import {
  readVersionInfo,
  rewriteVersion,
  PdfInputError,
} from '@/lib/pdf-document'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, AlertCircle, CheckCircle2 } from 'lucide-react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import { readFileAsArrayBuffer, formatFileSize } from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

const PDF_VERSIONS = [
  '1.0',
  '1.1',
  '1.2',
  '1.3',
  '1.4',
  '1.5',
  '1.6',
  '1.7',
  '2.0',
] as const
type PdfVersion = (typeof PDF_VERSIONS)[number]

export function VersionFix() {
  const { t } = useTranslation()
  const active = useActiveTool()
  const lastOutput = useRef<Uint8Array | null>(null)
  const {
    session,
    busy: documentBusy,
    beginOperation,
    commitOperation,
    endOperation,
  } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [ffs, setFfs] = useState(false)
  const detectionRequest = useRef(0)
  const [catalog, setCatalog] = useState<string | null>(null)
  const [detected, setDetected] = useState<string | null>(null)
  const [targetVersion, setTargetVersion] = useState<PdfVersion>('1.7')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const detect = async (f: File) => {
    const request = ++detectionRequest.current
    setDetected(null)
    setCatalog(null)
    try {
      const buf = await readFileAsArrayBuffer(f)
      const info = await readVersionInfo(new Uint8Array(buf))
      if (request === detectionRequest.current) {
        setDetected(info.header)
        setCatalog(info.catalog)
      }
    } catch {
      if (request === detectionRequest.current) {
        setDetected(null)
        setCatalog(null)
      }
    }
  }

  useEffect(() => {
    if (!active) {
      if (ffs) {
        setFile(null)
        lastOutput.current = null
      }
      return
    }
    if (
      session &&
      session.bytes === lastOutput.current &&
      file === session.file
    )
      return
    if (session && (!file || ffs)) {
      const f = session.file
      setFile(f)
      setFfs(true)
      setDone(false)
      setError(null)

      detect(f)
    } else if (!session && ffs) {
      lastOutput.current = null
      setFile(null)
      setFfs(false)
      setDetected(null)
    }
  }, [session?.revision, active])

  const handleFile = async (files: File[]) => {
    const f = files[0]
    setFile(f)
    setFfs(false)
    setDone(false)
    setError(null)

    await detect(f)
  }

  const handleProcess = async () => {
    if (!file) return
    const token = beginOperation('versionFix')
    if (!token) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      const buf =
        ffs && session ? session.bytes : await readFileAsArrayBuffer(file)
      const patched = await rewriteVersion(
        buf instanceof Uint8Array ? buf : new Uint8Array(buf),
        targetVersion,
      )
      const name = `${file.name.replace(/\.pdf$/i, '')}_v${targetVersion}.pdf`
      const committed = await commitOperation(patched, name, token, {
        replace: !ffs,
      })
      if (!committed) return
      lastOutput.current = patched
      setFile(committed.file)
      setFfs(true)
      setDetected(targetVersion)

      setDone(true)
    } catch (e) {
      setError(
        e instanceof PdfInputError
          ? t(`errors.${e.code}`)
          : t('errors.processing'),
      )
    } finally {
      endOperation(token)
      setProcessing(false)
    }
  }

  const handleReset = () => {
    setDone(false)
    setError(null)

    if (session) {
      const f = session.file
      setFile(f)
      setFfs(true)
      detect(f)
    } else {
      setFile(null)
      setFfs(false)
      setDetected(null)
    }
  }

  const warning =
    catalog && Number(catalog) > Number(targetVersion)
      ? t('tools.versionFix.catalogWarning', { version: catalog })
      : detected && Number(targetVersion) < Number(detected)
        ? t('tools.versionFix.lowerWarning')
        : ''

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="tool-card">
        <CardHeader className="tool-heading">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            {t('tools.versionFix.title')}
          </CardTitle>
          <CardDescription>{t('tools.versionFix.description')}</CardDescription>
        </CardHeader>
        <ProcessingStatus busy={processing} />
        <CardContent aria-busy={processing} className="space-y-6">
          <p id="version-note" className="text-sm text-muted-foreground">
            {t('tools.versionFix.note')}
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">
              {t('tools.versionFix.detailsTitle')}
            </summary>
            <p className="mt-2">{t('tools.versionFix.details')}</p>
          </details>
          <FileDropZone
            disabled={processing || documentBusy}
            onFiles={handleFile}
            hasFile={!!file}
            fileLabel={
              file ? `${file.name} (${formatFileSize(file.size)})` : undefined
            }
            sessionName={!file && session ? session.name : undefined}
            onUseSession={
              !file && session ? () => handleFile([session.file]) : undefined
            }
          />
          {file && (
            <>
              <Separator />
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    {t('tools.versionFix.currentVersion')}
                  </Label>
                  <div>
                    {detected ? (
                      <Badge variant="outline">PDF {detected}</Badge>
                    ) : (
                      <Badge variant="destructive">
                        {t('tools.versionFix.unknown')}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor="version-target"
                    className="text-xs text-muted-foreground"
                  >
                    {t('tools.versionFix.targetVersion')}
                  </Label>
                  <Select
                    disabled={processing || documentBusy}
                    value={targetVersion}
                    onValueChange={(v) => {
                      setTargetVersion(v as PdfVersion)
                      setDone(false)
                      setError(null)
                    }}
                  >
                    <SelectTrigger
                      id="version-target"
                      aria-describedby={
                        warning
                          ? 'version-note version-warning'
                          : 'version-note'
                      }
                      className="w-full sm:w-64"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PDF_VERSIONS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {t(`tools.versionFix.versions.${v}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}
          <p
            id="version-warning"
            role="status"
            hidden={!warning}
            className="text-sm text-muted-foreground"
          >
            {warning}
          </p>
          {error && (
            <div
              role="alert"
              id="versionfix-error"
              className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive-text"
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
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleProcess}
              disabled={!file || processing || documentBusy}
              className="flex-1"
            >
              {processing ? t('common.processing') : t('common.apply')}
            </Button>
            {file && !done && (
              <Button
                variant="outline"
                disabled={processing || documentBusy}
                onClick={handleReset}
              >
                {t('common.reset')}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
