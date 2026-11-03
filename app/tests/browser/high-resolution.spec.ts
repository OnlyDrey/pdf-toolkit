import { samplePreview } from './pixels'
import { navigate } from './navigation'
import { test, expect, type Page } from '@playwright/test'
import {
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  decodePDFRawStream,
} from 'pdf-lib'
import { generatedPng, pngChunk } from '../../src/lib/__tests__/png-fixtures'
const panel = (page: Page) => page.locator('#tool-panel-images')
const option = async (page: Page, label: string, value: string) => {
  await panel(page).getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: value, exact: true }).click()
}
async function pdf(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const stream = await (await pending).createReadStream()
  const parts: Buffer[] = []
  for await (const part of stream!) parts.push(Buffer.from(part))
  return PDFDocument.load(Buffer.concat(parts))
}
function images(doc: PDFDocument) {
  return doc.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) =>
      o instanceof PDFRawStream &&
      o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ? [o]
        : [],
    )
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await navigate(page, 'images')
})
test('10800 × 14400 RGBA PNG above 20 MiB and multiple large images keep all pixels and 300 DPI', async ({
  page,
}) => {
  test.setTimeout(240000)
  await page.route('**/images.worker-*.js', async (route) => {
    const response = await route.fetch(),
      source = await response.text()
    const guard = `const NativeCanvas=globalThis.OffscreenCanvas;globalThis.OffscreenCanvas=class extends NativeCanvas{constructor(w,h){if(w*h>25600)throw new Error('Full-size PNG canvas forbidden');super(w,h)}};globalThis.createImageBitmap=()=>Promise.reject(new Error('PNG bitmap decode forbidden'));`
    await route.fulfill({ response, body: guard + source })
  })
  const original = await generatedPng(10800, 14400)
  const padding = pngChunk(
    'tEXt',
    Buffer.concat([Buffer.from('Comment\0'), Buffer.alloc(21 * 1024 ** 2, 65)]),
  )
  const big = Buffer.concat([
    original.subarray(0, 33),
    padding,
    original.subarray(33),
  ])
  const second = await generatedPng(8000, 6000)
  await page.evaluate(() => {
    const state = window as Window & { heartbeats: number }
    state.heartbeats = 0
    setInterval(() => state.heartbeats++, 20)
  })
  const start = Date.now()
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles([
      { name: '155MP-300dpi.png', mimeType: 'image/png', buffer: big },
      { name: '48MP.png', mimeType: 'image/png', buffer: second },
    ])
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeEnabled({ timeout: 180000 })
  const elapsed = Date.now() - start
  console.info(
    `[high-resolution] PNG queue preparation including file transfer: ${elapsed} ms`,
  )
  test.info().annotations.push({
    type: 'preparation',
    description: `155.52+48 MP RGBA and >21 MiB source: ${elapsed}ms`,
  })
  expect(
    await page.evaluate(
      () => (window as Window & { heartbeats: number }).heartbeats,
    ),
  ).toBeGreaterThan(5)
  await expect(panel(page).getByText('10800 × 14400 px')).toBeVisible()
  expect(
    await panel(page)
      .locator('li img')
      .first()
      .evaluate((img: HTMLImageElement) =>
        Math.max(img.naturalWidth, img.naturalHeight),
      ),
  ).toBeLessThanOrEqual(160)
  await panel(page)
    .getByRole('button', {
      name: 'Preview image: 155MP-300dpi.png',
      exact: true,
    })
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Document preview',
    exact: true,
  })
  await expect(viewer.getByText(/lightweight thumbnail is shown/)).toBeVisible()
  await expect(viewer.locator('img')).toBeVisible()
  expect(
    await viewer
      .locator('img')
      .evaluate((image: HTMLImageElement) =>
        Math.max(image.naturalWidth, image.naturalHeight),
      ),
  ).toBeLessThanOrEqual(160)
  await page.keyboard.press('Escape')
  await option(page, 'Page size', 'Original image dimensions')
  await option(page, 'Margins', 'None')
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await expect(
    panel(page).getByText('PDF ready.', { exact: false }),
  ).toBeVisible({ timeout: 30000 })
  const doc = await pdf(page)
  expect(doc.getPageCount()).toBe(2)
  expect(doc.getPage(0).getWidth()).toBeCloseTo(2592, 1)
  expect(doc.getPage(0).getHeight()).toBeCloseTo(3456, 1)
  const streams = images(doc),
    main = streams.find(
      (s) =>
        s.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber() === 10800 &&
        s.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB'),
    )!
  expect(main.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber()).toBe(
    14400,
  )
  expect(main.dict.has(PDFName.of('SMask'))).toBe(true)
  // PDF decoder validates alpha data without retaining an RGBA image.
  const alpha = doc.context.lookup(
    main.dict.get(PDFName.of('SMask'))!,
    PDFRawStream,
  )
  const decoded = decodePDFRawStream(alpha).decode()
  expect(decoded.length).toBe((10800 + 1) * 14400)
  expect(decoded[0]).toBe(0)
  expect(decoded[1]).toBe(128)
  expect(decoded[decoded.length - 1]).toBe(128)
  await navigate(page, 'rotate')
  const active = page.locator('main > div:not(.hidden)')
  await expect(
    active.getByText(/Preview skipped to limit decoding memory/),
  ).toBeVisible({ timeout: 30000 })
  await active.getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(
    active.getByText('Applied - working file updated', { exact: true }),
  ).toBeVisible()
  const rotated = await pdf(page)
  expect(rotated.getPage(0).getRotation().angle).toBe(90)
  expect(
    images(rotated).some(
      (s) =>
        s.dict.lookup(PDFName.of('Height'), PDFNumber).asNumber() === 14400,
    ),
  ).toBe(true)
})
test('wide 50 MP JPEG embeds byte-for-byte; original page bounds never downscale the image', async ({
  page,
}) => {
  test.setTimeout(90000)
  const url = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 20000
    c.height = 2500
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#3278a0'
    ctx.fillRect(0, 0, c.width, c.height)
    const data = c.toDataURL('image/jpeg', 0.8)
    c.width = c.height = 0
    return data
  })
  const bytes = Buffer.from(url.split(',')[1], 'base64')
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles({ name: 'wide.jpg', mimeType: 'image/jpeg', buffer: bytes })
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeEnabled({ timeout: 30000 })
  await expect(panel(page).getByText('20000 × 2500 px')).toBeVisible()
  await option(page, 'Page size', 'Original image dimensions')
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await expect(panel(page).getByRole('alert')).toContainText('PDF page bound')
  await option(page, 'Page size', 'A4')
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await expect(
    panel(page).getByText('PDF ready.', { exact: false }),
  ).toBeVisible()
  const doc = await pdf(page),
    image = images(doc).find(
      (s) => s.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode'),
    )!
  expect(image.dict.lookup(PDFName.of('Width'), PDFNumber).asNumber()).toBe(
    20000,
  )
  expect(Buffer.from(image.getContents())).toEqual(bytes)
  expect(doc.getPage(0).getWidth()).toBe(841.89)
})
test('a genuine native decode memory budget fails with actionable guidance and retains the queue', async ({
  page,
}) => {
  await page.evaluate(() => {
    Object.defineProperty(window, 'Worker', {
      value: undefined,
      configurable: true,
    })
    Object.defineProperty(navigator, 'deviceMemory', {
      get: () => 0.25,
      configurable: true,
    })
  })
  const data = await page.evaluate(() => {
    const c = document.createElement('canvas')
    c.width = 1024
    c.height = 2048
    const ctx = c.getContext('2d')!
    ctx.fillStyle = 'red'
    ctx.fillRect(0, 0, c.width, c.height)
    const data = c.toDataURL('image/webp')
    c.width = c.height = 0
    return data
  })
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'budget.webp',
      mimeType: 'image/webp',
      buffer: Buffer.from(data.split(',')[1], 'base64'),
    })
  await expect(panel(page).getByRole('alert')).toContainText('decoding memory')
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeDisabled()
})

test('streamed 16-bit PNG preserves samples and renders transparency correctly', async ({
  page,
}) => {
  const bytes = await generatedPng(80, 40, { depth: 16 })
  await panel(page).locator('input[type=file]').setInputFiles({
    name: 'precision.png',
    mimeType: 'image/png',
    buffer: bytes,
  })
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeEnabled()
  await option(page, 'Page size', 'Original image dimensions')
  await option(page, 'Margins', 'None')
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await expect(
    panel(page).getByText('PDF ready.', { exact: false }),
  ).toBeVisible()
  const doc = await pdf(page),
    rgb = images(doc).find(
      (s) => s.dict.get(PDFName.of('ColorSpace')) === PDFName.of('DeviceRGB'),
    )!
  expect(
    rgb.dict.lookup(PDFName.of('BitsPerComponent'), PDFNumber).asNumber(),
  ).toBe(16)
  await navigate(page, 'rotate')
  const canvas = page.locator('main > div:not(.hidden) [data-pdf-preview]')
  await expect(canvas).toBeVisible()
  const pixel = (await samplePreview(canvas, [[0.5, 0.5]]))[0]
  expect(pixel[0]).toBeGreaterThan(135)
  expect(pixel[0]).toBeLessThan(160)
  expect(pixel[2]).toBeGreaterThan(195)
  expect(pixel[2]).toBeLessThan(220)
})
