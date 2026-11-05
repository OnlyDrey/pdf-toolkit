import { test, expect, type Page } from '@playwright/test'
import { PDFDict, PDFDocument, PDFName, PDFRawStream } from 'pdf-lib'
import { deflateSync } from 'node:zlib'
import { navigate, setLanguage } from './navigation'

// Deterministic photo-like raster: smooth gradients plus noise (large, poorly Flate-compressible).
function raster(width: number, height: number) {
  const out = Buffer.alloc(width * height * 3)
  let seed = 7
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const n = (seed >>> 24) & 31
      const at = (y * width + x) * 3
      out[at] = ((x * 255) / width + n) & 255
      out[at + 1] = ((y * 255) / height + n) & 255
      out[at + 2] = (((x + y) * 128) / (width + height) + n * 3) & 255
    }
  return out
}
async function scan(withImage = true) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont('Helvetica')
  for (let n = 0; n < 2; n++) {
    const page = doc.addPage([595, 842])
    page.drawText(`Searchable page ${n + 1}`, { x: 50, y: 780, font, size: 18 })
    if (withImage && n === 0) {
      const packed = deflateSync(raster(1800, 2400))
      const ref = doc.context.register(
        PDFRawStream.of(
          doc.context.obj({
            Type: 'XObject',
            Subtype: 'Image',
            Width: 1800,
            Height: 2400,
            ColorSpace: 'DeviceRGB',
            BitsPerComponent: 8,
            Filter: 'FlateDecode',
            Length: packed.length,
          }),
          packed,
        ),
      )
      page.node.setXObject(PDFName.of('Scan'), ref)
    }
  }
  return {
    name: 'scan.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save({ useObjectStreams: false })),
  }
}
const active = (page: Page) => page.locator('main > div:not(.hidden)')
async function run(page: Page, mode: string) {
  await active(page)
    .getByRole('radio', { name: new RegExp(mode) })
    .check()
  await active(page)
    .getByRole('button', { name: 'Compress PDF', exact: true })
    .click()
}
async function sizes(page: Page) {
  const text = await active(page).locator('.grid-cols-3').innerText()
  return text
}

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await setLanguage(page, 'en')
  await page.evaluate(() =>
    localStorage.removeItem('pdf-toolkit-compress-mode'),
  )
  await page.reload()
  await navigate(page, 'compress')
})

test('Balanced is the default and the chosen mode is remembered', async ({
  page,
}) => {
  await expect(
    active(page).getByRole('radio', { name: /Balanced/ }),
  ).toBeChecked()
  await active(page)
    .getByRole('radio', { name: /Maximum/ })
    .check()
  await page.reload()
  await navigate(page, 'compress')
  await expect(
    active(page).getByRole('radio', { name: /Maximum/ }),
  ).toBeChecked()
  // The mode selector sits above the primary action.
  const radio = await active(page).getByRole('radiogroup').boundingBox()
  const button = await active(page)
    .getByRole('button', { name: 'Compress PDF', exact: true })
    .boundingBox()
  expect(radio!.y).toBeLessThan(button!.y)
})

test('real recompression reduces an image-heavy PDF and keeps text and pages', async ({
  page,
}) => {
  const input = await scan()
  const results: Record<string, number> = {}
  for (const mode of ['Lossless', 'Balanced', 'Maximum']) {
    await page.reload()
    await navigate(page, 'compress')
    await active(page).locator('input[type=file]').setInputFiles(input)
    await run(page, mode)
    await expect(active(page).getByText('Original size')).toBeVisible({
      timeout: 60000,
    })
    const text = await sizes(page)
    results[mode] = text.length
    const download = page.waitForEvent('download')
    await page
      .getByRole('complementary', { name: 'Working on' })
      .getByRole('button', { name: 'Download', exact: true })
      .click()
    const stream = await (await download).createReadStream()
    const chunks: Buffer[] = []
    for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
    const bytes = Buffer.concat(chunks)
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBe(2)
    expect(doc.getPage(0).getSize()).toEqual({ width: 595, height: 842 })
    // Text stays real text, not a raster.
    const fonts = doc
      .getPage(0)
      .node.Resources()!
      .lookup(PDFName.of('Font'), PDFDict)
    expect(
      fonts
        .values()
        .map((font) =>
          doc.context
            .lookup(font, PDFDict)
            .get(PDFName.of('BaseFont'))
            ?.toString(),
        ),
    ).toContain('/Helvetica')
    test.info().annotations.push({
      type: mode,
      description: `${input.buffer.length} -> ${bytes.length} bytes`,
    })
    if (mode === 'Lossless')
      expect(bytes.length).toBeLessThan(input.buffer.length)
    else expect(bytes.length).toBeLessThan(input.buffer.length / 3)
    results[mode] = bytes.length
  }
  expect(results.Maximum).toBeLessThan(results.Balanced)
  expect(results.Balanced).toBeLessThan(results.Lossless)
})

test('a PDF that cannot shrink is left unchanged and says so', async ({
  page,
}) => {
  const doc = await PDFDocument.create()
  doc.addPage([200, 200])
  await active(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'tiny.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from(await doc.save()),
    })
  await run(page, 'Balanced')
  await expect(
    active(page).getByText('No smaller file could be produced'),
  ).toBeVisible()
  await expect(
    page.getByRole('complementary', { name: 'Working on' }),
  ).not.toContainText('tiny_compressed.pdf')
  // Retry with another mode stays possible.
  await expect(
    active(page).getByRole('button', { name: 'Compress PDF', exact: true }),
  ).toBeEnabled()
})

test('JPEG scans are downsampled; links, outline and form fields survive', async ({
  page,
}) => {
  const jpegBase64 = await page.evaluate(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = 2480
    canvas.height = 3508
    const context = canvas.getContext('2d')!
    let seed = 99
    for (let y = 0; y < canvas.height; y += 8)
      for (let x = 0; x < canvas.width; x += 8) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        context.fillStyle = `rgb(${(seed >>> 24) & 255},${(seed >>> 16) & 255},${(seed >>> 8) & 255})`
        context.fillRect(x, y, 8, 8)
      }
    const blob: Blob = await new Promise((resolve) =>
      canvas.toBlob((b) => resolve(b!), 'image/jpeg', 0.95),
    )
    const bytes = new Uint8Array(await blob.arrayBuffer())
    let text = ''
    for (let i = 0; i < bytes.length; i += 0x8000)
      text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    return btoa(text)
  })
  const doc = await PDFDocument.create()
  const jpeg = await doc.embedJpg(Buffer.from(jpegBase64, 'base64'))
  const first = doc.addPage([595, 842])
  first.drawImage(jpeg, { x: 0, y: 0, width: 595, height: 842 })
  doc.addPage([595, 842])
  const form = doc.getForm()
  form
    .createTextField('name')
    .addToPage(first, { x: 20, y: 20, width: 100, height: 20 })
  const link = doc.context.obj({
    Type: 'Annot',
    Subtype: 'Link',
    Rect: [10, 10, 100, 40],
    Border: [0, 0, 0],
    Dest: [doc.getPage(1).ref, 'Fit'],
  })
  first.node.addAnnot(doc.context.register(link))
  const outlines = doc.context.obj({ Type: 'Outlines' })
  const outlinesRef = doc.context.register(outlines)
  const item = doc.context.register(
    doc.context.obj({
      Title: 'Chapter',
      Parent: outlinesRef,
      Dest: [doc.getPage(1).ref, 'Fit'],
    }),
  )
  outlines.set(PDFName.of('First'), item)
  outlines.set(PDFName.of('Last'), item)
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  const input = Buffer.from(await doc.save({ useObjectStreams: false }))
  await active(page).locator('input[type=file]').setInputFiles({
    name: 'jpeg.pdf',
    mimeType: 'application/pdf',
    buffer: input,
  })
  await run(page, 'Balanced')
  await expect(active(page).getByText('Original size')).toBeVisible({
    timeout: 60000,
  })
  const download = page.waitForEvent('download')
  await page
    .getByRole('complementary', { name: 'Working on' })
    .getByRole('button', { name: 'Download', exact: true })
    .click()
  const chunks: Buffer[] = []
  for await (const chunk of (await (await download).createReadStream())!)
    chunks.push(Buffer.from(chunk))
  const bytes = Buffer.concat(chunks)
  test.info().annotations.push({
    type: 'jpeg-balanced',
    description: `${input.length} -> ${bytes.length} bytes`,
  })
  expect(bytes.length).toBeLessThan(input.length * 0.6)
  const out = await PDFDocument.load(bytes)
  expect(out.getPageCount()).toBe(2)
  expect(
    out
      .getForm()
      .getFields()
      .map((f) => f.getName()),
  ).toEqual(['name'])
  expect(out.getPage(0).node.Annots()!.size()).toBeGreaterThanOrEqual(2)
  expect(out.catalog.has(PDFName.of('Outlines'))).toBe(true)
  const widths = out.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) =>
      o instanceof PDFRawStream &&
      o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ? [o.dict.get(PDFName.of('Width'))!.toString()]
        : [],
    )
  expect(widths).toEqual(['1240'])
})
