import { test, expect, type Page } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import AxeBuilder from '@axe-core/playwright'
import { navigate } from './navigation'
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Working on' })
async function pdf(name = 'workspace.pdf') {
  const doc = await PDFDocument.create()
  for (const width of [100, 200, 300]) doc.addPage([width, 400])
  return {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  }
}
async function output(page: Page) {
  const promise = page.waitForEvent('download')
  await panel(page)
    .getByRole('button', { name: 'Download', exact: true })
    .click()
  const stream = await (await promise).createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  return PDFDocument.load(Buffer.concat(chunks))
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await panel(page)
    .locator('input[type=file]')
    .setInputFiles(await pdf())
  await expect(panel(page).getByText('3 pages', { exact: false })).toBeVisible()
})
test('page actions, actual PDF history, keyboard shortcuts and new edit invalidation', async ({
  page,
}) => {
  const p = panel(page)
  await p.getByRole('button', { name: 'Page 2', exact: true }).click()
  await p.getByRole('button', { name: 'Rotate selected', exact: true }).click()
  await expect(p.getByText('Unsaved changes', { exact: false })).toBeVisible()
  expect((await output(page)).getPage(1).getRotation().angle).toBe(90)
  await p.getByRole('button', { name: 'Move selected up', exact: true }).click()
  await expect
    .poll(async () => (await output(page)).getPage(0).getWidth())
    .toBe(200)
  await p.getByRole('button', { name: 'Remove selected', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Remove selected', exact: true })
    .click()
  await expect.poll(async () => (await output(page)).getPageCount()).toBe(2)
  await p.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect.poll(async () => (await output(page)).getPageCount()).toBe(3)
  await p.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await output(page)).getPage(1).getWidth()).toBe(200)
  await p.getByRole('button', { name: 'Undo', exact: true }).click()
  expect((await output(page)).getPage(1).getRotation().angle).toBe(0)
  await p.getByRole('heading', { name: 'Working on', exact: true }).click()
  await page.keyboard.press('Control+Shift+z')
  expect((await output(page)).getPage(1).getRotation().angle).toBe(90)
  await p.getByRole('button', { name: 'Rotate selected', exact: true }).click()
  await expect(
    p.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeDisabled()
  await p.getByLabel('Move group to page').fill('3')
  await p.getByRole('button', { name: 'Move', exact: true }).click()
  await expect
    .poll(async () => (await output(page)).getPage(2).getWidth())
    .toBe(200)
  await navigate(page, 'crop')
  await expect(page.locator('#tool-panel-crop')).toContainText('workspace.pdf')
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([])
})
test('replacement confirmation, rollback, save retains document and discard clears history', async ({
  page,
}) => {
  const p = panel(page)
  await p.getByRole('button', { name: 'Page 1', exact: true }).click()
  await p.getByRole('button', { name: 'Rotate selected', exact: true }).click()
  await expect(
    p.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeEnabled()
  await p
    .locator('input[type=file]')
    .setInputFiles(await pdf('replacement.pdf'))
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText('unsaved changes')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(p.locator('[data-document-name]')).toHaveText('workspace.pdf')
  await p
    .locator('input[type=file]')
    .setInputFiles(await pdf('replacement.pdf'))
  await dialog
    .getByRole('button', { name: 'Replace document', exact: true })
    .click()
  await expect(p.locator('[data-document-name]')).toHaveText('replacement.pdf')
  await p.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(p.locator('[data-document-name]')).toHaveText('workspace.pdf')
  await p.locator('input[type=file]').setInputFiles({
    name: 'bad.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('invalid'),
  })
  await dialog
    .getByRole('button', { name: 'Replace document', exact: true })
    .click()
  await expect(p.getByRole('alert')).toContainText('malformed')
  expect((await output(page)).getPage(0).getRotation().angle).toBe(90)
  const download = page.waitForEvent('download')
  await p.getByRole('button', { name: 'Save & Download' }).click()
  await download
  await expect(p.getByText('Saved', { exact: false })).toBeVisible()
  await expect(p.locator('[data-document-name]')).toHaveText('workspace.pdf')
  await p.getByRole('button', { name: 'Discard', exact: true }).click()
  await dialog.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(
    p.getByRole('button', { name: 'Undo', exact: true }),
  ).toBeDisabled()
  await expect(
    p.getByRole('button', { name: 'Redo', exact: true }),
  ).toBeDisabled()
  await expect(
    p.getByRole('button', { name: 'Open PDF', exact: true }),
  ).toBeFocused()
})
test('keyboard page reorder and shortcut does not steal text editing', async ({
  page,
}) => {
  const p = panel(page),
    handle = p.getByRole('button', { name: 'Reorder page 1', exact: true })
  const first = await handle.boundingBox(),
    second = await p
      .getByRole('button', { name: 'Reorder page 2', exact: true })
      .boundingBox()
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press(
    second!.y > first!.y + 20 ? 'ArrowDown' : 'ArrowRight',
  )
  await expect(p.getByRole('status').filter({ hasText: 'Page 2' })).toHaveCount(
    1,
  )
  await page.keyboard.press('Space')
  await expect
    .poll(async () => (await output(page)).getPage(0).getWidth())
    .toBe(200)
  await p.getByRole('button', { name: 'Page 1', exact: true }).click()
  const field = p.getByLabel('Move group to page')
  await field.fill('2')
  await page.keyboard.press('Control+z')
  expect((await output(page)).getPage(0).getWidth()).toBe(200)
})

test('obsolete preview URLs are released after repeated viewing, edits and discard', async ({
  page,
}) => {
  await page.evaluate(() => {
    const state = window as Window & {
      previewUrls: Set<string>
      previewCreates: number
    }
    state.previewUrls = new Set()
    state.previewCreates = 0
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = create(blob)
      state.previewUrls.add(url)
      state.previewCreates++
      return url
    }
    URL.revokeObjectURL = (url) => {
      state.previewUrls.delete(url)
      revoke(url)
    }
  })
  const p = panel(page)
  await p.getByRole('button', { name: 'Page 1', exact: true }).click()
  await p.getByRole('button', { name: 'Rotate selected', exact: true }).click()
  for (let n = 0; n < 3; n++) {
    await p
      .getByRole('button', { name: 'Preview document', exact: true })
      .click()
    await expect(page.locator('.document-viewer img')).toBeVisible()
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.document-viewer img')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(
    await page.evaluate(
      () => (window as Window & { previewCreates: number }).previewCreates,
    ),
  ).toBeGreaterThan(0)
  await p.getByRole('button', { name: 'Discard', exact: true }).click()
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: 'Discard', exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { previewUrls: Set<string> }).previewUrls.size,
      ),
    )
    .toBe(0)
  expect(await page.locator('canvas').count()).toBe(0)
})
