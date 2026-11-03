import { ProcessingStatus } from './ProcessingStatus'
import { useActiveTool } from '@/lib/active-tool-context'
import { loadPdf, PdfInputError } from '@/lib/pdf-document'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCw, AlertCircle, CheckCircle2 } from 'lucide-react'
import { rotatePages } from '@/lib/pdf-operations'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileDropZone } from './FileDropZone'
import { PdfPagePreview } from './PdfPagePreview'
import {
  readFileAsArrayBuffer,
  formatFileSize,
  parsePageRange,
} from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

type RotationAngle = '90' | '180' | '270'
type PageSelection = 'all' | 'range'

export function Rotate() {
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
  const [angle, setAngle] = useState<RotationAngle>('90')
  const [pageSel, setPageSel] = useState<PageSelection>('all')
  const [rangeInput, setRangeInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

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
      setFile(session.file)
      setFfs(true)
      setDone(false)
      setError(null)
    } else if (!session && ffs) {
      lastOutput.current = null
      setFile(null)
      setFfs(false)
    }
  }, [session?.revision, active])

  const handleFile = (files: File[]) => {
    setFile(files[0])
    setFfs(false)
    setDone(false)
    setError(null)
  }

  const handleProcess = async () => {
    if (!file) return
    const token = beginOperation('rotate')
    if (!token) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      const doc = await loadPdf(
        ffs && session ? session.bytes : await readFileAsArrayBuffer(file),
      )
      const pages = doc.getPages()
      const indices =
        pageSel === 'all'
          ? pages.map((_, i) => i)
          : parsePageRange(rangeInput, doc.getPageCount())
      const rot = parseInt(angle, 10)
      rotatePages(doc, indices, rot)
      const pdfBytes = await doc.save()
      const name = `${file.name.replace(/\.pdf$/i, '')}_rotated.pdf`
      const committed = await commitOperation(pdfBytes, name, token, {
        replace: !ffs,
      })
      if (!committed) return
      lastOutput.current = pdfBytes
      setFile(committed.file)
      setFfs(true)

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
    setRangeInput('')

    if (session) {
      setFile(session.file)
      setFfs(true)
    } else {
      setFile(null)
      setFfs(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="tool-card">
        <CardHeader className="tool-heading">
          <CardTitle className="flex items-center gap-2">
            <RotateCw className="h-5 w-5" />
            {t('tools.rotate.title')}
          </CardTitle>
          <CardDescription>{t('tools.rotate.description')}</CardDescription>
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
          {file && (
            <>
              <Separator />
              <div className="flex flex-col items-center gap-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {t('tools.rotate.preview')}
                </p>
                <PdfPagePreview
                  file={file}
                  rotateDeg={parseInt(angle, 10)}
                  maxWidth={200}
                />
                <p className="text-xs font-medium">
                  {t('tools.rotate.previewLabel', { deg: parseInt(angle, 10) })}
                </p>
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="rotate-angle">
                    {t('tools.rotate.angle')}
                  </Label>
                  <Select
                    disabled={processing || documentBusy}
                    value={angle}
                    onValueChange={(v) => setAngle(v as RotationAngle)}
                  >
                    <SelectTrigger id="rotate-angle">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="90">
                        {t('tools.rotate.deg90')}
                      </SelectItem>
                      <SelectItem value="180">
                        {t('tools.rotate.deg180')}
                      </SelectItem>
                      <SelectItem value="270">
                        {t('tools.rotate.deg270')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="rotate-pages">
                    {t('tools.rotate.applyTo')}
                  </Label>
                  <Select
                    disabled={processing || documentBusy}
                    value={pageSel}
                    onValueChange={(v) => setPageSel(v as PageSelection)}
                  >
                    <SelectTrigger id="rotate-pages">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {t('common.allPages')}
                      </SelectItem>
                      <SelectItem value="range">
                        {t('common.pageRange')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {pageSel === 'range' && (
                <div className="space-y-2">
                  <Label htmlFor="rotate-range">{t('common.pageRange')}</Label>
                  <Input
                    aria-describedby={error ? 'rotate-error' : undefined}
                    id="rotate-range"
                    placeholder={t('common.pageRangePlaceholder')}
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          {error && (
            <div
              role="alert"
              id="rotate-error"
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
