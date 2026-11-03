import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFArray,
  decodePDFRawStream,
} from 'pdf-lib'

const panel = (page: Page) => page.locator('#tool-panel-images')
async function image(
  page: Page,
  name: string,
  type = 'image/png',
  width = 80,
  height = 40,
  transparent = false,
) {
  const data = await page.evaluate(
    ({ type, width, height, transparent }) => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = transparent ? 'rgba(255,0,0,.5)' : 'red'
      ctx.fillRect(0, 0, width / 2, height)
      ctx.fillStyle = 'blue'
      ctx.fillRect(width / 2, 0, width / 2, height)
      return canvas.toDataURL(type)
    },
    { type, width, height, transparent },
  )
  return {
    name,
    mimeType: type,
    buffer: Buffer.from(data.split(',')[1], 'base64'),
  }
}
async function select(page: Page, label: string, option: string) {
  await panel(page).getByRole('combobox', { name: label, exact: true }).click()
  await page.getByRole('option', { name: option, exact: true }).click()
}
async function upload(page: Page, files: Awaited<ReturnType<typeof image>>[]) {
  await panel(page).locator('input[type=file]').setInputFiles(files)
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeEnabled()
}
async function create(page: Page) {
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await expect(
    panel(page).getByText('PDF ready.', { exact: false }),
  ).toBeVisible()
}
async function download(page: Page) {
  const pending = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const stream = await (await pending).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
const imageStreams = (doc: PDFDocument) =>
  doc.context
    .enumerateIndirectObjects()
    .flatMap(([, o]) =>
      o instanceof PDFRawStream &&
      o.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')
        ? [o]
        : [],
    )
function operations(doc: PDFDocument) {
  return new TextDecoder().decode(
    decodePDFRawStream(
      doc
        .getPage(0)
        .node.lookup(PDFName.of('Contents'), PDFArray)
        .lookup(0, PDFRawStream),
    ).decode(),
  )
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await page.locator('#tool-tab-images').click()
})
test('JPEG keeps original data, uses centered A4 and continues through the shared editing session', async ({
  page,
}) => {
  const sent: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') sent.push(request.url())
  })
  const jpg = await image(page, 'photo.jpg', 'image/jpeg')
  await upload(page, [jpg])
  await expect(panel(page).getByText('80 × 40 px')).toBeVisible()
  await create(page)
  const doc = await PDFDocument.load(await download(page))
  expect(doc.getPageCount()).toBe(1)
  expect(doc.getPage(0).getSize()).toEqual({ width: 841.89, height: 595.28 })
  const raw = imageStreams(doc).find(
    (s) => s.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode'),
  )!
  expect(Buffer.from(raw.getContents())).toEqual(jpg.buffer)
  expect(operations(doc)).toContain('24 24 793.89 547.28 re')
  await page.locator('#tool-tab-rotate').click()
  await page
    .locator('main > div:not(.hidden)')
    .getByRole('button', { name: 'Apply', exact: true })
    .click()
  await expect(
    page
      .locator('main > div:not(.hidden)')
      .getByText('Applied - working file updated', { exact: true }),
  ).toBeVisible()
  expect(
    (await PDFDocument.load(await download(page))).getPage(0).getRotation()
      .angle,
  ).toBe(90)
  await page.locator('#tool-tab-merge').click()
  const merge = page.locator('main > div:not(.hidden)')
  await merge
    .getByRole('button', { name: /Session: images_rotated.pdf/ })
    .click()
  const extra = await PDFDocument.create()
  extra.addPage([100, 100])
  await merge.locator('input[type=file]').setInputFiles({
    name: 'extra.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await extra.save()),
  })
  await merge
    .getByRole('button', { name: 'Merge into working file', exact: true })
    .click()
  await expect(
    merge.getByText('Applied - working file updated', { exact: true }),
  ).toBeVisible()
  const combined = await PDFDocument.load(await download(page))
  expect(combined.getPageCount()).toBe(2)
  expect(combined.getPage(0).getRotation().angle).toBe(90)
  expect(sent).toEqual([])
})
test('PNG/JPEG/WebP reorder and removal preserve page order, transparency and resource cleanup', async ({
  page,
}) => {
  const files = [
    await image(page, 'alpha.png', 'image/png', 80, 40, true),
    await image(page, 'portrait.jpg', 'image/jpeg', 40, 80),
    await image(page, 'wide.webp', 'image/webp', 60, 30, true),
  ]
  await upload(page, files)
  await expect(panel(page).getByText('3 images', { exact: true })).toBeVisible()
  expect(files[2].buffer.subarray(8, 12).toString()).toBe('WEBP')
  const removed = await panel(page)
    .getByRole('listitem')
    .nth(1)
    .locator('img')
    .getAttribute('src')
  const handle = panel(page).getByRole('button', {
    name: 'Drag to reorder: wide.webp',
    exact: true,
  })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText('Position 2 of 3.', { exact: true })).toHaveCount(
    1,
  )
  await page.keyboard.press('ArrowUp')
  await expect(page.getByText('Position 1 of 3.', { exact: true })).toHaveCount(
    1,
  )
  await page.keyboard.press('Space')
  await panel(page)
    .getByRole('button', { name: 'Remove: portrait.jpg', exact: true })
    .click()
  await expect(panel(page).getByRole('listitem').first()).toContainText(
    'wide.webp',
  )
  expect(
    await page.evaluate(async (url) => {
      try {
        await fetch(url!)
        return false
      } catch {
        return true
      }
    }, removed),
  ).toBe(true)
  await select(page, 'Page size', 'Original image dimensions (96 DPI)')
  await select(page, 'Margins', 'None')
  await create(page)
  const pdf = await PDFDocument.load(await download(page))
  expect(pdf.getPageCount()).toBe(2)
  expect(pdf.getPages().map((p) => p.getSize())).toEqual([
    { width: 45, height: 22.5 },
    { width: 60, height: 30 },
  ])
  expect(
    imageStreams(pdf).filter((s) => s.dict.has(PDFName.of('SMask'))).length,
  ).toBe(2)
  const urls = await panel(page)
    .locator('li img')
    .evaluateAll((nodes) => nodes.map((n) => (n as HTMLImageElement).src))
  await panel(page)
    .getByRole('button', { name: 'Clear images', exact: true })
    .click()
  expect(
    await page.evaluate(
      async (urls) =>
        Promise.all(
          urls.map(async (url) => {
            try {
              await fetch(url)
              return false
            } catch {
              return true
            }
          }),
        ),
      urls,
    ),
  ).toEqual([true, true])
  await expect(
    panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
  ).toBeDisabled()
})
test('EXIF quarter-turn and mirrored JPEGs render correctly without recompression', async ({
  page,
}) => {
  const original = await image(page, 'camera.jpg', 'image/jpeg', 80, 40)
  const addExif = (orientation: number) => {
    const app = Buffer.from([
      255,
      225,
      0,
      34,
      69,
      120,
      105,
      102,
      0,
      0,
      73,
      73,
      42,
      0,
      8,
      0,
      0,
      0,
      1,
      0,
      18,
      1,
      3,
      0,
      1,
      0,
      0,
      0,
      orientation,
      0,
      0,
      0,
      0,
      0,
      0,
      0,
    ])
    return {
      ...original,
      name: 'camera-' + orientation + '.jpg',
      buffer: Buffer.concat([
        original.buffer.subarray(0, 2),
        app,
        original.buffer.subarray(2),
      ]),
    }
  }
  const rotated = addExif(6),
    mirrored = addExif(2)
  await upload(page, [rotated, mirrored])
  await expect(panel(page).getByText('40 × 80 px')).toBeVisible()
  await select(page, 'Page size', 'Original image dimensions (96 DPI)')
  await select(page, 'Margins', 'None')
  await create(page)
  const doc = await PDFDocument.load(await download(page))
  expect(doc.getPages().map((p) => p.getSize())).toEqual([
    { width: 30, height: 60 },
    { width: 60, height: 30 },
  ])
  expect(operations(doc)).toContain('0 -60 30 0 0 60 cm')
  for (const bytes of [rotated.buffer, mirrored.buffer])
    expect(
      imageStreams(doc).some((stream) =>
        Buffer.from(stream.getContents()).equals(bytes),
      ),
    ).toBe(true)
  await page.locator('#tool-tab-rotate').click()
  const canvas = page.locator('main > div:not(.hidden) canvas')
  await expect(canvas).toBeVisible()
  const colors = await canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d')!
    return [0.25, 0.75].map((y) =>
      Array.from(
        ctx.getImageData(
          Math.floor(c.width * 0.5),
          Math.floor(c.height * y),
          1,
          1,
        ).data,
      ),
    )
  })
  expect(colors[0][0]).toBeGreaterThan(200)
  expect(colors[0][2]).toBeLessThan(60)
  expect(colors[1][2]).toBeGreaterThan(200)
  await page.locator('#tool-tab-extract').click()
  const mirroredCanvas = page.locator('main > div:not(.hidden) canvas').nth(1)
  await expect(mirroredCanvas).toBeVisible()
  const reflected = await mirroredCanvas.evaluate((c: HTMLCanvasElement) =>
    [0.25, 0.75].map((x) =>
      Array.from(
        c
          .getContext('2d')!
          .getImageData(
            Math.floor(c.width * x),
            Math.floor(c.height * 0.5),
            1,
            1,
          ).data,
      ),
    ),
  )
  expect(reflected[0][2]).toBeGreaterThan(200)
  expect(reflected[0][0]).toBeLessThan(60)
  expect(reflected[1][0]).toBeGreaterThan(200)
})
test('GIF first frame and BMP are explicit; corrupt, unsupported and oversized batches fail safely', async ({
  page,
}) => {
  const gif = Buffer.from([
    71,
    73,
    70,
    56,
    57,
    97,
    1,
    0,
    1,
    0,
    128,
    0,
    0,
    255,
    0,
    0,
    0,
    0,
    255,
    ...[0, 1].flatMap((i) => [
      33,
      249,
      4,
      0,
      1,
      0,
      0,
      0,
      44,
      0,
      0,
      0,
      0,
      1,
      0,
      1,
      0,
      0,
      2,
      2,
      i ? 76 : 68,
      1,
      0,
    ]),
    59,
  ])
  const bmp = Buffer.alloc(58)
  bmp.write('BM')
  bmp.writeUInt32LE(58, 2)
  bmp.writeUInt32LE(54, 10)
  bmp.writeUInt32LE(40, 14)
  bmp.writeInt32LE(1, 18)
  bmp.writeInt32LE(1, 22)
  bmp.writeUInt16LE(1, 26)
  bmp.writeUInt16LE(24, 28)
  bmp.writeUInt32LE(4, 34)
  bmp[56] = 255
  await upload(page, [
    { name: 'animated.gif', mimeType: 'image/gif', buffer: gif },
    { name: 'bitmap.bmp', mimeType: 'image/bmp', buffer: bmp },
  ])
  await expect(
    panel(page).getByText(/GIF and animated WebP use the first frame only/),
  ).toBeVisible()
  await create(page)
  expect((await PDFDocument.load(await download(page))).getPageCount()).toBe(2)
  await page.locator('#tool-tab-rotate').click()
  const canvas = page.locator('main > div:not(.hidden) canvas')
  await expect(canvas).toBeVisible()
  const pixel = await canvas.evaluate((c: HTMLCanvasElement) =>
    Array.from(
      c
        .getContext('2d')!
        .getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1)
        .data,
    ),
  )
  expect(pixel[0]).toBeGreaterThan(200)
  expect(pixel[2]).toBeLessThan(60)
  await page.locator('#tool-tab-images').click()
  await panel(page)
    .getByRole('button', { name: 'Clear images', exact: true })
    .click()
  const invalid = [
    {
      name: 'document.tif',
      mimeType: 'image/tiff',
      buffer: Buffer.from([73, 73, 42, 0, 0, 0, 0, 0]),
      message: 'TIFF is not supported',
    },
    {
      name: 'wrong.jpg',
      mimeType: 'image/jpeg',
      buffer: Buffer.from('<svg></svg>'),
      message: 'Choose a supported image',
    },
    {
      name: 'broken.gif',
      mimeType: 'image/gif',
      buffer: gif.subarray(0, 19),
      message: 'could not be decoded',
    },
    {
      name: 'large.png',
      mimeType: 'image/png',
      buffer: Buffer.alloc(20 * 1024 * 1024 + 1),
      message: 'Image limit',
    },
  ]
  for (const f of invalid) {
    await panel(page)
      .locator('input[type=file]')
      .setInputFiles({ name: f.name, mimeType: f.mimeType, buffer: f.buffer })
    await expect(panel(page).getByRole('alert')).toContainText(f.message)
    await expect(
      panel(page).getByRole('button', { name: 'Create PDF', exact: true }),
    ).toBeDisabled()
  }
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles(
      Array.from({ length: 101 }, (_, i) => ({
        name: i + '.gif',
        mimeType: 'image/gif',
        buffer: gif,
      })),
    )
  await expect(panel(page).getByRole('alert')).toContainText('Batch limit')
})
test('session replacement is confirmed, cancellation retains the PDF, and duplicate requests are blocked', async ({
  page,
}) => {
  await upload(page, [await image(page, 'first.png')])
  await create(page)
  const before = await download(page)
  await panel(page)
    .getByRole('button', { name: 'Clear images', exact: true })
    .click()
  await upload(page, [
    await image(page, 'replacement.webp', 'image/webp', 40, 80),
  ])
  const button = panel(page).getByRole('button', {
    name: 'Create PDF',
    exact: true,
  })
  await button.click()
  const dialog = page.getByRole('alertdialog')
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(button).toBeFocused()
  expect(await download(page)).toEqual(before)
  await page.evaluate(() => {
    const original = window.createImageBitmap
    const state = window as Window & { imageDecodes: number }
    state.imageDecodes = 0
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      state.imageDecodes++
      await new Promise((resolve) => setTimeout(resolve, 400))
      return original(...args)
    }) as typeof createImageBitmap
  })
  await select(page, 'Page size', 'Letter')
  await select(page, 'Orientation', 'Portrait')
  await select(page, 'Image fitting', 'Fill / crop')
  await select(page, 'Margins', 'Small')
  await button.click()
  await dialog
    .getByRole('button', { name: 'Replace and create PDF', exact: true })
    .evaluate((b: HTMLButtonElement) => {
      b.click()
      b.click()
    })
  await expect(panel(page).locator('input[type=file]')).toBeDisabled()
  await expect(
    panel(page).getByRole('status').filter({ hasText: 'Converting image' }),
  ).toContainText('Converting image')
  await expect(
    panel(page).getByText('PDF ready.', { exact: false }),
  ).toBeVisible()
  await expect(button).toBeFocused()
  const doc = await PDFDocument.load(await download(page))
  expect(doc.getPageCount()).toBe(1)
  expect(doc.getPage(0).getSize()).toEqual({ width: 612, height: 792 })
  expect(operations(doc)).toContain('12 12 588 768 re')
  expect(
    await page.evaluate(
      () => (window as Window & { imageDecodes: number }).imageDecodes,
    ),
  ).toBe(1)
})
test('image upload, queue and configuration remain accessible in both languages/themes and narrow layouts', async ({
  page,
}) => {
  const chooser = page.waitForEvent('filechooser')
  const drop = panel(page).getByRole('button', { name: /Drag & drop images/ })
  await drop.focus()
  await page.keyboard.press('Enter')
  await (await chooser).setFiles(await image(page, 'keyboard.png'))
  await expect(panel(page).getByRole('listitem')).toHaveCount(1)
  const dropped = await image(page, 'dropped.jpg', 'image/jpeg')
  const transfer = await page.evaluateHandle(
    ({ bytes, name, type }) => {
      const data = new DataTransfer()
      data.items.add(new File([new Uint8Array(bytes)], name, { type }))
      return data
    },
    {
      bytes: Array.from(dropped.buffer),
      name: dropped.name,
      type: dropped.mimeType,
    },
  )
  await drop.dispatchEvent('drop', { dataTransfer: transfer })
  await expect(panel(page).getByRole('listitem')).toHaveCount(2)

  for (const language of ['en', 'nb']) {
    await page
      .getByRole('button', {
        name: language === 'en' ? /English|Engelsk/ : /Norwegian|Norsk/,
      })
      .click()
    for (const theme of ['light', 'dark']) {
      await page
        .getByRole('button', {
          name: theme === 'light' ? /Light|Lyst/ : /Dark|Mørkt/,
        })
        .click()
      const result = await new AxeBuilder({ page })
        .withTags([
          'wcag2a',
          'wcag2aa',
          'wcag21a',
          'wcag21aa',
          'wcag22aa',
          'best-practice',
        ])
        .analyze()
      expect(
        result.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.failureSummary),
        })),
      ).toEqual([])
    }
  }
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('body *')]
        .filter((e) => {
          const r = e.getBoundingClientRect()
          return r.width && (r.right > window.innerWidth + 1 || r.left < -1)
        })
        .map((e) => ({
          tag: e.tagName,
          classes: e.className,
          text: e.textContent?.slice(0, 60),
        })),
    ),
  ).toEqual([])
})

test('conversion failure and a concurrent session change never discard existing work', async ({
  page,
}) => {
  await upload(page, [await image(page, 'existing.jpg', 'image/jpeg')])
  await create(page)
  const before = await download(page)
  await panel(page)
    .getByRole('button', { name: 'Clear images', exact: true })
    .click()
  await upload(page, [await image(page, 'new.webp', 'image/webp')])
  await page.evaluate(() => {
    const original = window.createImageBitmap
    window.createImageBitmap = (() => {
      window.createImageBitmap = original
      return Promise.reject(new Error('simulated decode failure'))
    }) as typeof createImageBitmap
  })
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Replace and create PDF', exact: true })
    .click()
  await expect(panel(page).getByRole('alert')).toContainText(
    'could not be decoded',
  )
  expect(await download(page)).toEqual(before)
  await page.evaluate(() => {
    const original = window.createImageBitmap
    window.createImageBitmap = (async (
      ...args: Parameters<typeof createImageBitmap>
    ) => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return original(...args)
    }) as typeof createImageBitmap
  })
  await panel(page)
    .getByRole('button', { name: 'Create PDF', exact: true })
    .click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Replace and create PDF', exact: true })
    .click()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Discard', exact: true })
    .click()
  await expect(panel(page).getByRole('alert')).toContainText(
    'working PDF changed during conversion',
  )
  await expect(
    page.getByRole('button', { name: 'Download', exact: true }),
  ).toHaveCount(0)
})
