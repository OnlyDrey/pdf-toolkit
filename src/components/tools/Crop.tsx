import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Crop as CropIcon,
  AlertCircle,
  CheckCircle2,
  Info,
  Download,
} from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
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
import { PdfPagePreview, type PageDimensions } from './PdfPagePreview'
import {
  readFileAsArrayBuffer,
  formatFileSize,
  downloadBlob,
  parsePageRange,
} from '@/lib/pdf-utils'
import { useSession } from '@/lib/session-context'

type PageSelection = 'all' | 'range'
interface Margins {
  top: number
  right: number
  bottom: number
  left: number
}

export function Crop() {
  const { t } = useTranslation()
  const { session, setSession } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [ffs, setFfs] = useState(false)
  const [margins, setMargins] = useState<Margins>({
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  })
  const [pageSel, setPageSel] = useState<PageSelection>('all')
  const [rangeInput, setRangeInput] = useState('')
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [dims, setDims] = useState<PageDimensions | null>(null)
  const [outBytes, setOutBytes] = useState<Uint8Array | null>(null)
  const [outName, setOutName] = useState('')

  useEffect(() => {
    if (session && (!file || ffs)) {
      setFile(
        new File([new Uint8Array(session.bytes)], session.name, {
          type: 'application/pdf',
        }),
      )
      setFfs(true)
      setDims(null)
      setDone(false)
      setError(null)
      setOutBytes(null)
      setOutName('')
    } else if (!session && ffs) {
      setFile(null)
      setFfs(false)
      setDims(null)
    }
  }, [session])

  const handleFile = (files: File[]) => {
    setFile(files[0])
    setFfs(false)
    setDims(null)
    setDone(false)
    setError(null)
    setOutBytes(null)
    setOutName('')
  }
  const setMargin = (side: keyof Margins, val: string) =>
    setMargins((p) => ({ ...p, [side]: Math.max(0, parseInt(val, 10) || 0) }))
  const handleDimensions = useCallback((d: PageDimensions) => setDims(d), [])

  const handleProcess = async () => {
    if (!file) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      const doc = await PDFDocument.load(await readFileAsArrayBuffer(file))
      const pages = doc.getPages()
      const indices =
        pageSel === 'all'
          ? pages.map((_, i) => i)
          : parsePageRange(rangeInput, doc.getPageCount())
      for (const idx of indices) {
        const p = pages[idx]
        const { width: w, height: h } = p.getSize()
        p.setCropBox(
          margins.left,
          margins.bottom,
          Math.max(1, w - margins.left - margins.right),
          Math.max(1, h - margins.top - margins.bottom),
        )
      }
      const pdfBytes = await doc.save()
      const name = `${file.name.replace(/\.pdf$/i, '')}_cropped.pdf`
      setSession(pdfBytes, name)
      setOutBytes(pdfBytes)
      setOutName(name)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error')
    } finally {
      setProcessing(false)
    }
  }

  const handleReset = () => {
    setMargins({ top: 0, right: 0, bottom: 0, left: 0 })
    setRangeInput('')
    setDone(false)
    setError(null)
    setDims(null)
    setOutBytes(null)
    setOutName('')
    if (session) {
      setFile(
        new File([new Uint8Array(session.bytes)], session.name, {
          type: 'application/pdf',
        }),
      )
      setFfs(true)
    } else {
      setFile(null)
      setFfs(false)
    }
  }

  const ov = dims
    ? {
        top: `${(margins.top / dims.ptH) * 100}%`,
        right: `${(margins.right / dims.ptW) * 100}%`,
        bottom: `${(margins.bottom / dims.ptH) * 100}%`,
        left: `${(margins.left / dims.ptW) * 100}%`,
      }
    : null

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CropIcon className="h-5 w-5" />
            {t('tools.crop.title')}
          </CardTitle>
          <CardDescription>{t('tools.crop.description')}</CardDescription>
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
            {t('tools.crop.note')}
          </div>
          {file && (
            <>
              <Separator />
              <div className="flex flex-col items-center gap-2 py-1">
                <p className="text-xs text-muted-foreground">
                  {t('tools.crop.preview')}
                </p>
                <PdfPagePreview
                  file={file}
                  maxWidth={240}
                  onDimensions={handleDimensions}
                >
                  {ov && (
                    <>
                      <div
                        className="absolute left-0 right-0 top-0 rounded-t bg-black/50"
                        style={{ height: ov.top }}
                      />
                      <div
                        className="absolute left-0 right-0 bottom-0 rounded-b bg-black/50"
                        style={{ height: ov.bottom }}
                      />
                      <div
                        className="absolute left-0 bg-black/50"
                        style={{
                          top: ov.top,
                          bottom: ov.bottom,
                          width: ov.left,
                        }}
                      />
                      <div
                        className="absolute right-0 bg-black/50"
                        style={{
                          top: ov.top,
                          bottom: ov.bottom,
                          width: ov.right,
                        }}
                      />
                      <div
                        className="pointer-events-none absolute border-2 border-primary/80"
                        style={{
                          top: ov.top,
                          right: ov.right,
                          bottom: ov.bottom,
                          left: ov.left,
                        }}
                      />
                    </>
                  )}
                </PdfPagePreview>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label className="text-sm">{t('tools.crop.margins')}</Label>
                <div className="flex flex-col items-center gap-2">
                  <div className="w-28">
                    <Label
                      htmlFor="mt"
                      className="mb-1 block text-center text-xs text-muted-foreground"
                    >
                      {t('tools.crop.top')}
                    </Label>
                    <Input
                      id="mt"
                      type="number"
                      min={0}
                      value={margins.top}
                      onChange={(e) => setMargin('top', e.target.value)}
                      className="text-center"
                    />
                  </div>
                  <div className="flex w-full max-w-xs items-center justify-between gap-2">
                    <div className="w-28">
                      <Label
                        htmlFor="ml"
                        className="mb-1 block text-center text-xs text-muted-foreground"
                      >
                        {t('tools.crop.left')}
                      </Label>
                      <Input
                        id="ml"
                        type="number"
                        min={0}
                        value={margins.left}
                        onChange={(e) => setMargin('left', e.target.value)}
                        className="text-center"
                      />
                    </div>
                    <div className="flex h-14 w-16 items-center justify-center rounded-md border border-dashed border-border bg-muted/30 text-xs text-muted-foreground">
                      PDF
                    </div>
                    <div className="w-28">
                      <Label
                        htmlFor="mr"
                        className="mb-1 block text-center text-xs text-muted-foreground"
                      >
                        {t('tools.crop.right')}
                      </Label>
                      <Input
                        id="mr"
                        type="number"
                        min={0}
                        value={margins.right}
                        onChange={(e) => setMargin('right', e.target.value)}
                        className="text-center"
                      />
                    </div>
                  </div>
                  <div className="w-28">
                    <Label
                      htmlFor="mb"
                      className="mb-1 block text-center text-xs text-muted-foreground"
                    >
                      {t('tools.crop.bottom')}
                    </Label>
                    <Input
                      id="mb"
                      type="number"
                      min={0}
                      value={margins.bottom}
                      onChange={(e) => setMargin('bottom', e.target.value)}
                      className="text-center"
                    />
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="cp">{t('tools.crop.applyTo')}</Label>
                <Select
                  value={pageSel}
                  onValueChange={(v) => setPageSel(v as PageSelection)}
                >
                  <SelectTrigger id="cp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('common.allPages')}</SelectItem>
                    <SelectItem value="range">
                      {t('common.pageRange')}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {pageSel === 'range' && (
                <div className="space-y-2">
                  <Label htmlFor="cr">{t('common.pageRange')}</Label>
                  <Input
                    id="cr"
                    placeholder={t('common.pageRangePlaceholder')}
                    value={rangeInput}
                    onChange={(e) => setRangeInput(e.target.value)}
                  />
                </div>
              )}
            </>
          )}
          {error && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}
          {done && (
            <div className="flex items-center gap-2 rounded-md bg-green-500/10 px-3 py-2 text-sm text-green-700 dark:text-green-400">
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
