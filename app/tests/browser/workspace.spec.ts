import { PDFDocument } from 'pdf-lib'
import { test, expect } from '@playwright/test'
import { navigate, setLanguage, setTheme, showTools } from './navigation'
test('responsive sidebar preserves tool controls and offers a modal mobile drawer', async ({
  page,
}) => {
  await page.goto('/')
  await setLanguage(page, 'en')
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
    const bar = page.locator('.workspace-topbar')
    const before = await bar.boundingBox()
    await showTools(page)
    const nav = page.locator('#workspace-nav')
    await expect(nav).toBeVisible()
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    // The navbar is unchanged; only the toggle icon changes. No second logo.
    expect(await bar.boundingBox()).toEqual(before)
    await expect(page.locator('#workspace-menu')).toHaveAttribute(
      'aria-label',
      'Close tools',
    )
    await expect(nav.getByText('PDF Toolkit')).toHaveCount(0)
    const top = (await nav.boundingBox())!
    expect(top.y).toBeGreaterThanOrEqual(before!.y + before!.height - 1)
    expect(top.y + top.height).toBeGreaterThanOrEqual(
      page.viewportSize()!.height - 1,
    )
    await expect(page.locator('#tool-tab-rotate')).toHaveAttribute(
      'aria-current',
      'page',
    )
    await page.keyboard.press('Escape')
    await expect(page.locator('#workspace-menu')).toBeFocused()
    await expect(nav).not.toBeVisible()
    await showTools(page)
    await page.getByRole('button', { name: 'Close tools', exact: true }).click()
    await expect(nav).not.toBeVisible()
    await expect(page.locator('#workspace-menu')).toHaveAttribute(
      'aria-label',
      'Open tools',
    )
    await expect(rotation).toContainText('180 degrees')
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
      .getByRole('button', { name: 'Theme', exact: true })
      .boundingBox())!
    expect(theme.x).toBeLessThan(box.x)
  }
})

test('theme and language dropdowns show the selection and persist it', async ({
  page,
}) => {
  await page.goto('/')
  await setLanguage(page, 'en')
  await page.getByRole('button', { name: 'Theme', exact: true }).click()
  await expect(
    page.getByRole('menuitemradio', { name: 'System', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Theme', exact: true }),
  ).toBeFocused()
  await setTheme(page, 'dark')
  await expect(page.locator('html')).toHaveClass(/dark/)
  await page.reload()
  await expect(page.locator('html')).toHaveClass(/dark/)
  await setLanguage(page, 'nb')
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('lang', 'nb')
  await page.getByRole('button', { name: 'Språk', exact: true }).click()
  await expect(
    page.getByRole('menuitemradio', { name: 'Norsk', exact: true }),
  ).toHaveAttribute('aria-checked', 'true')
  await page.mouse.click(5, 300)
  await expect(page.getByRole('menu')).toHaveCount(0)
})
