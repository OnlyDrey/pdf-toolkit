import { test, expect, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { PDFDocument } from 'pdf-lib'

const tools = [
  'merge',
  'compress',
  'extract',
  'rotate',
  'resize',
  'crop',
  'versionFix',
]
const active = (page: Page) => page.locator('main > div:not(.hidden)')
async function fixture(page: Page) {
  const pdf = await PDFDocument.create()
  pdf.addPage([200, 400]).drawText('Accessible workflow fixture')
  const input = {
    name: 'fixture.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from(await pdf.save()),
  }
  await page.goto('/')
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await page.locator('#tool-tab-rotate').click()
  await active(page).locator('input[type=file]').setInputFiles(input)
  await active(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(
    active(page)
      .getByRole('status')
      .filter({ hasText: 'working file updated' }),
  ).toBeVisible()
  return input
}
async function scan(page: Page, state: string, selector?: string) {
  const builder = new AxeBuilder({ page }).withTags([
    'wcag2a',
    'wcag2aa',
    'wcag21a',
    'wcag21aa',
    'wcag22aa',
    'best-practice',
  ])
  if (selector) builder.include(selector)
  const results = await builder.analyze()
  if (results.violations.length)
    await test.info().attach(state, {
      body: JSON.stringify(results, null, 2),
      contentType: 'application/json',
    })
  expect(
    results.violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => ({
        target: n.target,
        failure: n.failureSummary,
      })),
    })),
    state,
  ).toEqual([])
}
test('all tools pass axe in both themes and languages with a working PDF', async ({
  page,
}) => {
  test.setTimeout(180000)
  const input = await fixture(page)
  await page.locator('#tool-tab-merge').click()
  await active(page)
    .locator('input[type=file]')
    .setInputFiles([input, { ...input, name: 'second.pdf' }])
  for (const language of ['en', 'nb']) {
    await page
      .getByRole('button', {
        name: language === 'en' ? /English|Engelsk/ : /Norwegian|Norsk/,
        exact: true,
      })
      .click()
    await expect(page.locator('html')).toHaveAttribute('lang', language)
    for (const theme of ['light', 'dark']) {
      await page
        .getByRole('button', {
          name: theme === 'light' ? /Light|Lyst/ : /Dark|Mørkt/,
          exact: true,
        })
        .click()
      for (const tool of tools) {
        await page.locator('#tool-tab-' + tool).click()
        const canvas = active(page).locator('canvas').first()
        if (await canvas.count()) await expect(canvas).toBeVisible()
        await scan(page, `${language}-${theme}-${tool}`)
      }
    }
  }
})
test('axe covers validation feedback, processing, dropdowns and discard dialog', async ({
  page,
}) => {
  test.setTimeout(90000)
  const input = await fixture(page)
  await page.locator('#tool-tab-crop').click()
  await active(page).getByLabel('Top', { exact: true }).fill('99999')
  await active(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(active(page).getByRole('alert')).toBeVisible()
  await scan(page, 'crop-error')
  await page.locator('#tool-tab-resize').click()
  await active(page).getByRole('combobox', { name: 'Paper size' }).click()
  await page.getByRole('option').first().waitFor()
  await expect(page.locator('#root')).toHaveJSProperty('inert', true)
  await scan(page, 'paper-menu', '[role=listbox]')
  await page.keyboard.press('Escape')
  await expect(page.locator('#root')).toHaveJSProperty('inert', false)
  await expect(
    active(page).getByRole('combobox', { name: 'Paper size' }),
  ).toBeFocused()
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  await expect(page.getByRole('alertdialog')).toHaveJSProperty('open', true)
  await scan(page, 'discard-confirmation', '[role=alertdialog]')
  await page.keyboard.press('Escape')
  await page.locator('#tool-tab-compress').click()
  await active(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'invalid.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('invalid'),
    })
  await active(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(active(page).getByRole('alert')).toBeVisible()
  await scan(page, 'invalid-pdf')
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsArrayBuffer
    FileReader.prototype.readAsArrayBuffer = function (...args) {
      setTimeout(() => read.apply(this, args), 1500)
    }
  })
  await page.reload()
  await page.getByRole('button', { name: 'EN English', exact: true }).click()
  await page.locator('#tool-tab-compress').click()
  await active(page).locator('input[type=file]').setInputFiles(input)
  await active(page).getByRole('button', { name: 'Apply', exact: true }).click()
  await expect(
    active(page).getByText('Processing...', { exact: true }).first(),
  ).toBeVisible()
  await scan(page, 'processing')
})
test('reflow at 320/640 CSS pixels and 200% text sizing keeps every tool reachable', async ({
  page,
}) => {
  test.setTimeout(90000)
  await fixture(page)
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 800 })
    for (const tool of tools) {
      await page.locator('#tool-tab-' + tool).click()
      await expect(page.locator('#tool-tab-' + tool)).toBeVisible()
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        tool + ' reflow ' + width,
      ).toBe(true)
    }
  }
  await page.setViewportSize({ width: 320, height: 800 })
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%'
  })
  await expect(page.locator('html')).toHaveCSS('font-size', '32px')
  for (const tool of tools) {
    await page.locator('#tool-tab-' + tool).click()
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      tool + ' enlarged text',
    ).toBe(true)
  }
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(page.locator('#tool-tab-versionFix')).toHaveCSS(
    'transition-duration',
    '1e-05s',
  )
})

test('keyboard reordering, invalid drops and confirmation focus stay accessible', async ({
  page,
}) => {
  const input = await fixture(page)
  await page.locator('#tool-tab-merge').click()
  await active(page)
    .locator('input[type=file]')
    .setInputFiles([input, { ...input, name: 'second.pdf' }])
  const handle = active(page).getByRole('button', {
    name: 'Drag to reorder: fixture.pdf',
    exact: true,
  })
  await handle.focus()
  await page.keyboard.press('Space')
  await expect(handle).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByText('Position 2 of 2.', { exact: true })).toHaveCount(
    1,
  )
  await page.keyboard.press('Space')
  await expect(
    active(page).locator('button[aria-label^="Remove:"]').first(),
  ).toHaveAttribute('aria-label', 'Remove: second.pdf')
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer()
    data.items.add(new File(['wrong'], 'wrong.txt', { type: 'text/plain' }))
    return data
  })
  await active(page)
    .getByRole('button', { name: /Drag & drop PDF files/ })
    .dispatchEvent('drop', { dataTransfer: transfer })
  await expect(active(page).getByRole('alert')).toContainText(
    'Choose PDF files',
  )
  await page.getByRole('button', { name: 'Discard', exact: true }).click()
  const dialog = page.getByRole('alertdialog')
  await page.keyboard.press('Shift+Tab')
  await expect(
    dialog.getByRole('button', { name: 'Discard', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    dialog.getByRole('button', { name: 'Cancel', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: 'Discard', exact: true }),
  ).toBeFocused()
})
