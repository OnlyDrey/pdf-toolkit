import { PDFDocument } from 'pdf-lib'
import { test, expect } from '@playwright/test'
import { navigate, showTools } from './navigation'
test('responsive sidebar preserves tool controls and offers a modal mobile drawer', async ({
  page,
}) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await navigate(page, 'rotate')
  const pdf = await PDFDocument.create()
  pdf.addPage([200, 400])
  await page.locator('#tool-panel-rotate input[type=file]').setInputFiles({
    name: 'settings.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  })
  await expect(
    page.locator('#tool-panel-rotate [data-pdf-preview]'),
  ).toBeVisible()
  const rotation = page
    .locator('#tool-panel-rotate')
    .getByRole('combobox', { name: 'Rotation angle', exact: true })
  await rotation.click()
  await page.getByRole('option', { name: '180 degrees', exact: true }).click()
  await navigate(page, 'versionFix')
  await navigate(page, 'rotate')
  await expect(rotation).toContainText('180 degrees')
  if ((await page.viewportSize())!.width >= 768) {
    await page
      .getByRole('button', { name: 'Collapse sidebar', exact: true })
      .click()
    await expect(page.locator('#tool-tab-images')).toHaveAttribute(
      'title',
      'Images to PDF',
    )
    await page.reload()
    await expect(
      page.getByRole('button', { name: 'Expand sidebar', exact: true }),
    ).toBeVisible()
    await page
      .getByRole('button', { name: 'Expand sidebar', exact: true })
      .click()
  } else {
    await showTools(page)
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    await page.keyboard.press('Shift+Tab')
    await expect(page.locator('#tool-tab-versionFix')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(
      page.getByRole('button', { name: 'Close tools', exact: true }),
    ).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page.locator('#workspace-menu')).toBeFocused()
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await showTools(page)
    await page.mouse.click(2, 300)
    await expect(page.getByRole('dialog')).not.toBeVisible()
    await showTools(page)
    await page.getByRole('button', { name: 'Close tools', exact: true }).click()
    await expect(page.locator('#workspace-menu')).toBeFocused()
  }
  await page.setViewportSize({ width: 320, height: 800 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('topbar stays sticky and the hamburger is the rightmost control', async ({
  page,
}) => {
  await page.goto('/')
  await page.evaluate(() => {
    document.getElementById('main-content')!.style.minHeight = '4000px'
    window.scrollTo(0, 1500)
  })
  const bar = page.locator('.workspace-topbar')
  expect((await bar.boundingBox())!.y).toBe(0)
  const menu = page.locator('#workspace-menu')
  if (await menu.isVisible()) {
    const box = (await menu.boundingBox())!
    const width = page.viewportSize()!.width
    expect(box.x + box.width).toBeGreaterThan(width - 24)
    const theme = (await page
      .getByRole('button', { name: 'Light', exact: true })
      .boundingBox())!
    expect(theme.x).toBeLessThan(box.x)
  }
})
