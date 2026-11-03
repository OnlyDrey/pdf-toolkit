import { ProcessingStatus } from './ProcessingStatus'
import { useActiveTool } from '@/lib/active-tool-context'
import { loadPdf, PdfInputError } from '@/lib/pdf-document'
import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Scissors, AlertCircle, CheckCircle2 } from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
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
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { FileDropZone } from './FileDropZone'
import { PdfPageGrid } from './PdfPageGrid'
import {
  readFileAsArrayBuffer,
  formatFileSize,
  parsePageRange,
} from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

export function Extract() {
  const { t } = useTranslation()
  const active = useActiveTool()
  const lastOutput = useRef<Uint8Array | null>(null)
  const {
    session,
    busy: documentBusy,
    beginOperation,
    commitOperation,
    endOperation,
    selectedIds,
    selectPages,
  } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [ffs, setFfs] = useState(false)
  const [totalPages, setTotalPages] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [inputVal, setInputVal] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const loadGeneration = useRef(0)
  const bufRef = useRef<ArrayBuffer | Uint8Array | null>(null)

  const loadFile = async (f: File, fromSession = false) => {
    const generation = ++loadGeneration.current
    setTotalPages(null)
    setFile(f)
    setFfs(fromSession)
    setDone(false)
    setError(null)
    setSelected(new Set())
    setInputVal('')

    bufRef.current = null
    try {
      const buf =
        fromSession && session ? session.bytes : await readFileAsArrayBuffer(f)
      const doc = await loadPdf(buf)
      if (generation !== loadGeneration.current) return
      bufRef.current = buf
      setTotalPages(doc.getPageCount())
    } catch (e) {
      if (generation !== loadGeneration.current) return
      setTotalPages(null)
      setError(
        e instanceof PdfInputError
          ? t(`errors.${e.code}`)
          : t('errors.processing'),
      )
    }
  }

  useEffect(() => {
    if (!active) {
      if (ffs) {
        setFile(null)
        lastOutput.current = null
        bufRef.current = null
        loadGeneration.current++
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
      loadFile(session.file, true)
    } else if (!session && ffs) {
      lastOutput.current = null
      setFile(null)
      setFfs(false)
      setTotalPages(null)
      bufRef.current = null
    }
  }, [session?.revision, active])

  useEffect(() => {
    if (!ffs || !session || file !== session.file) return
    const indices = session.pageIds.flatMap((id, i) =>
      selectedIds.includes(id) ? [i] : [],
    )
    setSelected(new Set(indices))
    setInputVal(indices.map((i) => i + 1).join(','))
  }, [selectedIds, session?.revision, ffs, file])

  const handleFile = (files: File[]) => loadFile(files[0], false)

  const handleInputChange = (val: string) => {
    setInputVal(val)
    if (totalPages !== null && val.trim()) {
      try {
        const indices = parsePageRange(val, totalPages)
        setSelected(new Set(indices))
        if (ffs && session) selectPages(indices.map((i) => session.pageIds[i]))
      } catch {
        /* keep */
      }
    } else {
      setSelected(new Set())
      if (ffs) selectPages([])
    }
  }

  const togglePage = (i: number) => {
    const next = new Set(selected)
    if (next.has(i)) next.delete(i)
    else next.add(i)
    setSelected(next)
    setInputVal(
      Array.from(next)
        .sort((a, b) => a - b)
        .map((n) => n + 1)
        .join(','),
    )
    setDone(false)
  }

  const handleProcess = async () => {
    if (!file || totalPages === null) return
    const token = beginOperation('extract')
    if (!token) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      const indices = parsePageRange(inputVal, totalPages)
      if (!indices.length) throw new Error('No pages selected.')
      const buf = bufRef.current ?? (await readFileAsArrayBuffer(file))
      const src = await loadPdf(buf),
        dst = await PDFDocument.create()
      ;(await dst.copyPages(src, indices)).forEach((p) => dst.addPage(p))
      const pdfBytes = await dst.save()
      const name = `${file.name.replace(/\.pdf$/i, '')}_extracted.pdf`
      const committed = await commitOperation(pdfBytes, name, token, {
        replace: !ffs,
        pageIds:
          ffs && session ? indices.map((i) => session.pageIds[i]) : undefined,
        selectAll: true,
      })
      if (!committed) return
      lastOutput.current = pdfBytes
      setFile(committed.file)
      setFfs(true)
      bufRef.current = null
      setTotalPages(indices.length)
      setSelected(new Set(indices.map((_, index) => index)))
      setInputVal(indices.map((_, index) => index + 1).join(','))

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
    setSelected(new Set())
    setInputVal('')
    setDone(false)
    setError(null)

    if (session) {
      loadFile(session.file, true)
    } else {
      setFile(null)
      setFfs(false)
      setTotalPages(null)
      bufRef.current = null
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="tool-card">
        <CardHeader className="tool-heading">
          <CardTitle className="flex items-center gap-2">
            <Scissors className="h-5 w-5" />
            {t('tools.extract.title')}
          </CardTitle>
          <CardDescription>{t('tools.extract.description')}</CardDescription>
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
          {file && totalPages !== null && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-xs">
                  {t('tools.extract.totalPages', { count: totalPages })}
                </Badge>
                {selected.size > 0 && (
                  <span className="text-xs text-muted-foreground">
                    {t('common.selectedPages', { count: selected.size })}
                  </span>
                )}
              </div>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {t('tools.extract.previewHint')}
                </p>
                {ffs ? (
                  <p className="text-sm text-muted-foreground">
                    <a className="underline" href="#current-document-pages">
                      {t('document.selectInPanel')}
                    </a>
                  </p>
                ) : (
                  <PdfPageGrid
                    file={file}
                    count={totalPages}
                    selected={selected}
                    onSelect={togglePage}
                    disabled={processing || documentBusy}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="extract-range">
                  {t('tools.extract.selectPages')}
                </Label>
                <Input
                  aria-describedby={error ? 'extract-error' : undefined}
                  id="extract-range"
                  placeholder={t('common.pageRangePlaceholder')}
                  value={inputVal}
                  onChange={(e) => handleInputChange(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('tools.extract.hint')}
                </p>
              </div>
            </>
          )}
          {error && (
            <div
              role="alert"
              id="extract-error"
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
              disabled={
                !file || selected.size === 0 || processing || documentBusy
              }
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
