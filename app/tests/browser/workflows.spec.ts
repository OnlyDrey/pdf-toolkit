import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'

async function pdf(name: string, pages = 2) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++)
    doc.addPage([200, 400]).drawText(`Page ${i + 1}`)
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  }
}
const visibleTool = (page: Page) => page.locator('main > div:not(.hidden)')
async function upload(
  page: Page,
  files: Awaited<ReturnType<typeof pdf>> | Awaited<ReturnType<typeof pdf>>[],
) {
  await visibleTool(page).locator('input[type=file]').setInputFiles(files)
}
async function apply(page: Page) {
  await visibleTool(page)
    .getByRole('button', { name: 'Apply', exact: true })
    .click()
  await expect(
    visibleTool(page)
      .getByRole('status')
      .filter({ hasText: 'working file updated' }),
  ).toBeVisible()
}
async function downloadBytes(page: Page) {
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download', exact: true }).click()
  const file = await download
  const stream = await file.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}
async function result(page: Page) {
  return PDFDocument.load(await downloadBytes(page))
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
})
test('merge, session switch, extract, rotate, resize, crop and download', async ({
  page,
}) => {
  const network: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') network.push(request.url())
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await upload(page, [await pdf('a.pdf'), await pdf('b.pdf', 1)])
  await visibleTool(page)
    .getByRole('button', { name: 'Merge into working file' })
    .click()
  await expect(
    page.getByText('merged.pdf', { exact: true }).first(),
  ).toBeVisible()
  expect((await result(page)).getPageCount()).toBe(3)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  await page.getByRole('tab', { name: 'Extract Pages', exact: true }).click()
  await expect(visibleTool(page).getByText('Total pages: 3')).toBeVisible()
  await expect(visibleTool(page).locator('canvas').first()).toBeVisible()
  await visibleTool(page).getByRole('textbox').fill('1,3')
  await apply(page)
  expect((await result(page)).getPageCount()).toBe(2)
  await page.getByRole('tab', { name: 'Rotate', exact: true }).click()
  await apply(page)
  expect((await result(page)).getPage(0).getRotation().angle).toBe(90)
  await page.getByRole('tab', { name: 'Resize', exact: true }).click()
  await apply(page)
  const resized = (await result(page)).getPage(0)
  expect(resized.getRotation().angle).toBe(90)
  expect(resized.getHeight()).toBeCloseTo(595.28, 0)
  await page.getByRole('tab', { name: 'Crop', exact: true }).click()
  await visibleTool(page).getByLabel('Top', { exact: true }).fill('10')
  await apply(page)
  const cropped = (await result(page)).getPage(0)
  expect(cropped.getCropBox().height).toBeCloseTo(cropped.getHeight() - 10, 2)
  expect(network).toEqual([])
  expect(errors).toEqual([])
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save & Download' }).click()
  await download
  await expect(page.getByText('Working on:', { exact: false })).toHaveCount(0)
})
test('invalid and encrypted PDFs give useful errors', async ({ page }) => {
  await page.getByRole('tab', { name: 'Compress', exact: true }).click()
  await upload(page, {
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('invalid'),
  })
  await visibleTool(page)
    .getByRole('button', { name: 'Apply', exact: true })
    .click()
  await expect(visibleTool(page).getByRole('alert')).toContainText('malformed')
  const doc = await PDFDocument.create()
  doc.addPage()
  doc.context.trailerInfo.Encrypt = doc.context.register(
    doc.context.obj({
      Filter: 'Standard',
      V: 1,
      R: 2,
      O: 'owner',
      U: 'user',
      P: -4,
    }),
  )
  await upload(page, {
    name: 'encrypted.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save({ useObjectStreams: false })),
  })
  await visibleTool(page)
    .getByRole('button', { name: 'Apply', exact: true })
    .click()
  await expect(visibleTool(page).getByRole('alert')).toContainText('Encrypted')
})
test('compression preserves a non-improving original and header edits explain limitations', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Compress', exact: true }).click()
  await upload(page, await pdf('optimized.pdf'))
  await apply(page)
  await expect(
    visibleTool(page).getByText('The rewrite did not reduce size.', {
      exact: false,
    }),
  ).toBeVisible()
  await page.getByRole('tab', { name: 'Version Fix', exact: true }).click()
  await expect(
    visibleTool(page).getByText('Edits only the three version characters', {
      exact: false,
    }),
  ).toBeVisible()
  await apply(page)
  expect((await result(page)).getPageCount()).toBe(2)
})
test('theme, language, keyboard upload and responsive layout', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Dark', exact: true }).click()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.getByRole('button', { name: 'NO Norwegian', exact: true }).click()
  await expect(
    page.getByRole('tab', { name: 'Slå sammen', exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'EN Engelsk', exact: true }).click()
  const drop = visibleTool(page).getByRole('button', {
    name: 'Drag & drop PDF files here, or click to browse',
  })
  await drop.focus()
  const chooser = page.waitForEvent('filechooser')
  await page.keyboard.press('Space')
  await (await chooser).setFiles([await pdf('keyboard.pdf')])
  await expect(
    visibleTool(page).getByText('keyboard.pdf', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('repeated operations use the current result and invalid ranges cannot use stale selections', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Rotate', exact: true }).click()
  await upload(page, await pdf('repeat.pdf'))
  await apply(page)
  await apply(page)
  expect((await result(page)).getPage(0).getRotation().angle).toBe(180)
  await page.getByRole('tab', { name: 'Extract Pages', exact: true }).click()
  await expect(visibleTool(page).getByText('Total pages: 2')).toBeVisible()
  await visibleTool(page)
    .getByRole('button', { name: 'Page 1', exact: true })
    .click()
  await visibleTool(page).getByRole('textbox').fill('1,invalid')
  await visibleTool(page)
    .getByRole('button', { name: 'Apply', exact: true })
    .click()
  await expect(visibleTool(page).getByRole('alert')).toContainText(
    'Check your page range',
  )
  expect((await result(page)).getPageCount()).toBe(2)
})

test('VersionFix allows lower and higher headers without rewriting document contents', async ({
  page,
}) => {
  await page.getByRole('tab', { name: 'Version Fix', exact: true }).click()
  const input = await pdf('header.pdf')
  await upload(page, input)
  const target = visibleTool(page).getByRole('combobox', {
    name: 'Target version',
  })
  await target.click()
  await page.getByRole('option', { name: 'PDF 1.4 -', exact: false }).click()
  await expect(
    visibleTool(page).getByText('An older header', { exact: false }),
  ).toBeVisible()
  await apply(page)
  const lower = await downloadBytes(page)
  expect(lower.subarray(0, 8).toString()).toBe('%PDF-1.4')
  expect(lower.subarray(8)).toEqual(input.buffer.subarray(8))
  await target.click()
  await page.getByRole('option', { name: 'PDF 2.0 -', exact: false }).click()
  await apply(page)
  expect((await downloadBytes(page)).subarray(0, 8).toString()).toBe('%PDF-2.0')
  await page.getByRole('button', { name: 'NO Norwegian', exact: true }).click()
  await expect(
    visibleTool(page).getByText('Endrer bare de tre versjonstegnene', {
      exact: false,
    }),
  ).toBeVisible()
})

test('canonical navbar branding and favicon assets are served as real images', async ({
  page,
  request,
}) => {
  await expect(page.locator('header .brand-mark')).toHaveCSS(
    'mask-image',
    /brand-mark\.svg/,
  )
  for (const name of ['brand-mark.svg', 'favicon.svg']) {
    const response = await request.get('/' + name)
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/svg+xml')
    expect(await response.text()).toContain('<svg')
  }
  for (const [name, size] of [
    ['favicon-16.png', 16],
    ['favicon-32.png', 32],
    ['apple-touch-icon.png', 180],
  ] as const) {
    const response = await request.get('/' + name)
    expect(response.headers()['content-type']).toContain('image/png')
    const bytes = await response.body()
    expect(bytes.subarray(1, 4).toString()).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBe(size)
    expect(bytes.readUInt32BE(20)).toBe(size)
  }
})

test('keyboard tabs, focus, document language and discard confirmation are predictable', async ({
  page,
}) => {
  const merge = page.getByRole('tab', { name: 'Merge', exact: true })
  await merge.focus()
  await page.keyboard.press('ArrowRight')
  const compress = page.getByRole('tab', { name: 'Compress', exact: true })
  await expect(compress).toBeFocused()
  await expect(compress).toHaveAttribute('aria-selected', 'true')
  await expect(compress).toHaveCSS('outline-style', 'solid')
  await expect(compress).toHaveCSS('border-left-width', '0px')
  const controls = await compress.getAttribute('aria-controls')
  await expect(page.locator('#' + controls)).toHaveAttribute('role', 'tabpanel')
  await page.keyboard.press('Tab')
  await expect(page.locator('#' + controls)).toBeFocused()
  await page.getByRole('button', { name: 'NO Norwegian', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await page.getByRole('button', { name: 'EN Engelsk', exact: true }).click()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await page.getByRole('tab', { name: 'Rotate', exact: true }).click()
  await upload(page, await pdf('confirm.pdf'))
  await apply(page)
  const discard = page.getByRole('button', { name: 'Discard', exact: true })
  await discard.click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).not.toBeVisible()
  await expect(discard).toBeFocused()
  await discard.click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByText('Working on:', { exact: false })).toHaveCount(0)
  await expect(
    page.getByRole('tab', { name: 'Rotate', exact: true }),
  ).toBeFocused()
})
