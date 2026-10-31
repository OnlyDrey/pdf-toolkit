import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Maximize2,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  Download,
} from 'lucide-react'
import { PDFDocument, degrees } from 'pdf-lib'
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
import { Separator } from '@/components/ui/separator'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { FileDropZone } from './FileDropZone'
import { PdfPagePreview, type PageDimensions } from './PdfPagePreview'
import {
  readFileAsArrayBuffer,
  formatFileSize,
  downloadBlob,
} from '@/lib/pdf-utils'
import {
  paperSizes,
  paperSizesByCategory,
  type PaperSize,
  type PaperSizeCategory,
} from '@/lib/paper-sizes'
import { useSession } from '@/lib/session-context'

type Orientation = 'portrait' | 'landscape'
function getPt(s: PaperSize, o: Orientation) {
  const mn = Math.min(s.widthPt, s.heightPt),
    mx = Math.max(s.widthPt, s.heightPt)
  return o === 'portrait'
    ? { width: mn, height: mx }
    : { width: mx, height: mn }
}
function getMm(s: PaperSize, o: Orientation) {
  const mn = Math.min(s.widthMm, s.heightMm),
    mx = Math.max(s.widthMm, s.heightMm)
  return o === 'portrait' ? { w: mn, h: mx } : { w: mx, h: mn }
}
const CAT_ORDER: PaperSizeCategory[] = ['ISO-A', 'ISO-B', 'ISO-C', 'US']
const MM2PT = 2.8346

export function Resize() {
  const { t } = useTranslation()
  const { session, setSession } = useSession()
  const [file, setFile] = useState<File | null>(null)
  const [ffs, setFfs] = useState(false)
  const [sizeId, setSizeId] = useState('a4')
  const [orient, setOrient] = useState<Orientation>('portrait')
  const [scale, setScale] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [dims, setDims] = useState<PageDimensions | null>(null)
  const [outBytes, setOutBytes] = useState<Uint8Array | null>(null)
  const [outName, setOutName] = useState('')
  const sz = paperSizes.find((s) => s.id === sizeId) ?? paperSizes[3]

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

  const handleProcess = async () => {
    if (!file) return
    setProcessing(true)
    setError(null)
    setDone(false)
    try {
      const doc = await PDFDocument.load(await readFileAsArrayBuffer(file))
      const { width: nW, height: nH } = getPt(sz, orient)
      for (const page of doc.getPages()) {
        if (scale) {
          const ang = page.getRotation().angle,
            rot = ang === 90 || ang === 270
          const { width: rW, height: rH } = page.getSize()
          const cW = rot ? rH : rW,
            cH = rot ? rW : rH,
            sc = Math.min(nW / cW, nH / cH)
          page.scaleContent(sc, sc)
          page.translateContent(
            (nW - cW * sc) / (2 * sc),
            (nH - cH * sc) / (2 * sc),
          )
        }
        page.setSize(nW, nH)
        page.setRotation(degrees(0))
      }
      const pdfBytes = await doc.save()
      const name = `${file.name.replace(/\.pdf$/i, '')}_${sz.id}.pdf`
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

  const srcMm = dims
    ? { w: Math.round(dims.ptW / MM2PT), h: Math.round(dims.ptH / MM2PT) }
    : null
  const dstMm = getMm(sz, orient)

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Maximize2 className="h-5 w-5" />
            {t('tools.resize.title')}
          </CardTitle>
          <CardDescription>{t('tools.resize.description')}</CardDescription>
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
          {file && (
            <>
              <Separator />
              <div className="flex items-end justify-center gap-6 py-2">
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground">
                    {t('tools.resize.previewOriginal')}
                  </p>
                  <PdfPagePreview
                    file={file}
                    maxWidth={130}
                    onDimensions={setDims}
                  />
                  {srcMm && (
                    <Badge variant="outline" className="text-xs">
                      {srcMm.w} x {srcMm.h} mm
                    </Badge>
                  )}
                </div>
                <ArrowRight className="mb-10 h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="flex flex-col items-center gap-1">
                  <p className="text-xs text-muted-foreground">
                    {t('tools.resize.previewTarget')}
                  </p>
                  <div
                    className="flex items-center justify-center rounded border-2 border-dashed border-primary/60 bg-primary/5"
                    style={{
                      width: 130,
                      height: Math.round(130 * (dstMm.h / dstMm.w)),
                    }}
                  >
                    <span className="text-xs font-semibold text-primary">
                      {sz.name}
                    </span>
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {dstMm.w} x {dstMm.h} mm
                  </Badge>
                </div>
              </div>
              <Separator />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ps">{t('tools.resize.paperSize')}</Label>
                  <Select value={sizeId} onValueChange={setSizeId}>
                    <SelectTrigger id="ps">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="max-h-72">
                      {CAT_ORDER.map((cat) => (
                        <SelectGroup key={cat}>
                          <SelectLabel>
                            {t(`tools.resize.categories.${cat}`)}
                          </SelectLabel>
                          {paperSizesByCategory[cat].map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name} - {s.widthMm}x{s.heightMm} mm
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ori">{t('tools.resize.orientation')}</Label>
                  <Select
                    value={orient}
                    onValueChange={(v) => setOrient(v as Orientation)}
                  >
                    <SelectTrigger id="ori">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="portrait">
                        {t('common.portrait')}
                      </SelectItem>
                      <SelectItem value="landscape">
                        {t('common.landscape')}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id="sc"
                  type="checkbox"
                  checked={scale}
                  onChange={(e) => setScale(e.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                <Label htmlFor="sc" className="cursor-pointer">
                  {t('tools.resize.scaleContent')}
                </Label>
              </div>
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
