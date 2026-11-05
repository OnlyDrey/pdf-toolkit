import AxeBuilder from '@axe-core/playwright'
import { test, expect } from '@playwright/test'
import { PDFDocument } from 'pdf-lib'
import { navigate, setLanguage } from './navigation'
async function fixture(pages: number) {
  const doc = await PDFDocument.create()
  for (let n = 0; n < pages; n++)
    doc.addPage([200, 400]).drawText('Page ' + (n + 1))
  return {
    name: 'pages.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await doc.save()),
  }
}
test('hundreds of pages use a bounded virtual grid and reusable zoom viewer', async ({
  page,
}) => {
  test.setTimeout(90000)
  await page.goto('/')
  await setLanguage(page, 'en')
  await navigate(page, 'extract')
  await page
    .locator('#tool-panel-extract input[type=file]')
    .setInputFiles(await fixture(300))
  await expect(
    page.getByText('Total pages: 300', { exact: true }),
  ).toBeVisible()
  const grid = page.locator('[data-preview-scroll]')
  expect(Number(await grid.getAttribute('data-rendered-pages'))).toBeLessThan(
    50,
  )
  await expect(grid.locator('[data-pdf-preview="1"]')).toBeVisible()
  await grid.evaluate((node) => {
    node.scrollTop = node.scrollHeight
  })
  await expect(
    grid.getByRole('button', { name: 'Page 300', exact: true }),
  ).toBeVisible()
  expect(Number(await grid.getAttribute('data-rendered-pages'))).toBeLessThan(
    50,
  )
  await grid
    .getByRole('button', { name: 'Preview page 300', exact: true })
    .click()
  const viewer = page.getByRole('dialog', {
    name: 'Document preview',
    exact: true,
  })
  await expect(
    viewer.getByText('Page 300 of 300', { exact: true }),
  ).toBeVisible()
  await expect(viewer.locator('img')).toBeVisible()
  expect(
    (
      await new AxeBuilder({ page })
        .include('.document-viewer')
        .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
        .analyze()
    ).violations,
  ).toEqual([])
  await page.keyboard.press('ArrowLeft')
  await expect(
    viewer.getByText('Page 299 of 300', { exact: true }),
  ).toBeVisible()
  await expect(viewer.locator('img')).toBeVisible()
  const initial = await viewer.locator('img').getAttribute('src')
  await viewer.getByRole('button', { name: 'Zoom in', exact: true }).click()
  await expect(viewer.getByRole('button', { name: /125%/ })).toBeVisible()
  await viewer.getByRole('button', { name: 'Fit width', exact: true }).click()
  await viewer.getByRole('button', { name: 'Fit page', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(viewer).not.toBeVisible()
  for (let n = 0; n < 2; n++) {
    await grid
      .getByRole('button', { name: 'Preview page 300', exact: true })
      .click()
    await expect(viewer.locator('img')).toBeVisible()
    await page.keyboard.press('Escape')
  }
  expect(initial).toMatch(/^blob:/)
})
test('document replacement cancels obsolete previews and fixed loading frames keep controls reachable', async ({
  page,
}) => {
  await page.goto('/')
  await setLanguage(page, 'en')
  await navigate(page, 'extract')
  const input = page.locator('#tool-panel-extract input[type=file]')
  await input.setInputFiles(await fixture(200))
  await input.setInputFiles({ ...(await fixture(1)), name: 'replacement.pdf' })
  await expect(page.getByText('Total pages: 1', { exact: true })).toBeVisible()
  await expect(page.locator('[data-pdf-preview="1"]')).toBeVisible()
  await navigate(page, 'rotate')
  await page
    .locator('#tool-panel-rotate input[type=file]')
    .setInputFiles(await fixture(1))
  await page.locator('#rotate-angle').click()
  await page.getByRole('option', { name: '180 degrees', exact: true }).click()
  await expect(page.locator('#rotate-angle')).toContainText('180 degrees')
})
