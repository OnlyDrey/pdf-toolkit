import { ProcessingStatus } from './ProcessingStatus'
import { useActiveTool } from '@/lib/active-tool-context'
import { PdfInputError } from '@/lib/pdf-document'
import {
  COMPRESSION_MODES,
  DEFAULT_COMPRESSION_MODE,
  type CompressionMode,
  type CompressOutcome,
  type CompressProgress,
} from '@/lib/pdf-compress'
import { cn } from '@/lib/utils'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Minimize2, AlertCircle, CheckCircle2, Info } from 'lucide-react'
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
import { readFileAsArrayBuffer, formatFileSize } from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

export function Compress() {
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
  const [ffs, setFfs] = useState(false) // fileFromSession
  const [origSize, setOrigSize] = useState<number | null>(null)
  const [compSize, setCompSize] = useState<number | null>(null)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [mode, setMode] = useState<CompressionMode>(() => {
    try {
      const saved = localStorage.getItem('pdf-toolkit-compress-mode')
      return COMPRESSION_MODES.includes(saved as CompressionMode)
        ? (saved as CompressionMode)
        : DEFAULT_COMPRESSION_MODE
    } catch {
      return DEFAULT_COMPRESSION_MODE
    }
  })
  const [progress, setProgress] = useState<CompressProgress | null>(null)
  const [outcome, setOutcome] = useState<CompressOutcome | null>(null)
  const cancel = useRef<AbortController | null>(null)
  const chooseMode = (next: CompressionMode) => {
    setMode(next)
    setOutcome(null)
    try {
      localStorage.setItem('pdf-toolkit-compress-mode', next)
    } catch {
      /* Preference storage is optional. */
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
      setOrigSize(session.bytes.byteLength)
      setFfs(true)
      setCompSize(null)
      setOutcome(null)
      setDone(false)
      setError(null)
    } else if (!session && ffs) {
      lastOutput.current = null
      setFile(null)
      setFfs(false)
      setOrigSize(null)
    }
  }, [session?.revision, active])

  const handleFile = (files: File[]) => {
    const f = files[0]
    setOutcome(null)
    setFile(f)
    setOrigSize(f.size)
    setFfs(false)
    setCompSize(null)
    setDone(false)
    setError(null)
  }

  const handleProcess = async () => {
    if (!file) return
    const token = beginOperation('compress')
    if (!token) return
    const controller = new AbortController()
    cancel.current = controller
    setProcessing(true)
    setError(null)
    setDone(false)
    setOutcome(null)
    setCompSize(null)
    try {
      setOrigSize(file.size)
      const original =
        ffs && session
          ? session.bytes
          : new Uint8Array(await readFileAsArrayBuffer(file))
      // Engine and codec load on demand so other tools never pay for them.
      const [{ compressPdf }, { browserCodec }] = await Promise.all([
        import('@/lib/pdf-compress'),
        import('@/lib/pdf-compress-codec'),
      ])
      const result = await compressPdf(original, mode, browserCodec, {
        signal: controller.signal,
        onProgress: setProgress,
      })
      setOutcome(result)
      setCompSize(result.stats.outputBytes)
      if (result.kind !== 'reduced') return // the original stays untouched
      const name = `${file.name.replace(/\.pdf$/i, '')}_compressed.pdf`
      const committed = await commitOperation(result.bytes, name, token, {
        replace: !ffs,
      })
      if (!committed) return
      lastOutput.current = result.bytes
      setFile(committed.file)
      setFfs(true)
      setDone(true)
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError'))
        setError(
          e instanceof PdfInputError
            ? t(`errors.${e.code}`)
            : t('tools.compress.failed'),
        )
    } finally {
      cancel.current = null
      endOperation(token)
      setProcessing(false)
      setProgress(null)
    }
  }

  const handleReset = () => {
    setOutcome(null)
    setCompSize(null)
    setDone(false)
    setError(null)

    if (session) {
      const f = session.file
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
      <Card className="tool-card">
        <CardHeader className="tool-heading">
          <CardTitle className="flex items-center gap-2">
            <Minimize2 className="h-5 w-5" />
            {t('tools.compress.title')}
          </CardTitle>
          <CardDescription>{t('tools.compress.description')}</CardDescription>
        </CardHeader>
        <ProcessingStatus busy={processing} />
        <CardContent aria-busy={processing} className="space-y-6">
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
          <fieldset
            className="min-w-0 space-y-2"
            disabled={processing || documentBusy}
          >
            <legend className="mb-1 text-sm font-medium">
              {t('tools.compress.mode')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('tools.compress.mode')}
              className="grid gap-2 sm:grid-cols-3"
            >
              {COMPRESSION_MODES.map((value) => (
                <label
                  key={value}
                  className={cn(
                    'flex min-h-11 min-w-0 cursor-pointer flex-col gap-0.5 rounded-md border p-3 text-sm [overflow-wrap:anywhere] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring',
                    mode === value
                      ? 'border-primary bg-primary/5'
                      : 'hover:bg-muted/50',
                  )}
                >
                  <span className="flex flex-wrap items-center gap-x-2 font-medium">
                    <input
                      type="radio"
                      name="compress-mode"
                      className="accent-primary"
                      value={value}
                      checked={mode === value}
                      onChange={() => chooseMode(value)}
                    />
                    {t(`tools.compress.modes.${value}.name`)}
                    {value === DEFAULT_COMPRESSION_MODE && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {t('tools.compress.default')}
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`tools.compress.modes.${value}.description`)}
                  </span>
                </label>
              ))}
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t(`tools.compress.modes.${mode}.note`)}
            </p>
          </fieldset>
          {outcome && origSize && compSize && (
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
                  <p className="mt-1 font-medium">
                    {outcome.kind === 'reduced' && reduction !== null
                      ? `-${reduction}%`
                      : '0%'}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">
                    {t('tools.compress.compressedSize')}
                  </p>
                  <p className="mt-1 font-medium">{formatFileSize(compSize)}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t(`tools.compress.modes.${outcome.stats.mode}.name`)}
                {outcome.kind === 'reduced' &&
                  ` · ${t('tools.compress.imageSummary', {
                    optimized: outcome.stats.images.optimized,
                    found: outcome.stats.images.found,
                  })}`}
              </p>
              {outcome.kind === 'unchanged' && (
                <p role="status" className="text-sm">
                  {t('tools.compress.noReduction')}
                </p>
              )}
              {outcome.kind === 'signed' && (
                <p role="status" className="text-sm">
                  {t('tools.compress.signed')}
                </p>
              )}
            </>
          )}
          {error && (
            <div
              role="alert"
              id="compress-error"
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
              {t('tools.compress.applied')}
            </div>
          )}
          {processing && progress && (
            <p role="status" className="text-sm text-muted-foreground">
              {t(`tools.compress.phase.${progress.phase}`, {
                done: progress.done + 1,
                total: progress.total,
              })}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={handleProcess}
              disabled={!file || processing || documentBusy}
              className="flex-1"
            >
              {processing ? t('common.processing') : t('tools.compress.action')}
            </Button>
            {processing && (
              <Button variant="outline" onClick={() => cancel.current?.abort()}>
                {t('common.cancel')}
              </Button>
            )}
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
