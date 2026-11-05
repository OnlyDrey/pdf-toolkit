import { test, expect } from '@playwright/test'
import { setLanguage, setTheme, showTools } from './navigation'
import { settleAppearance } from './appearance'
test('navigation and palette changes retain AA contrast during every rendered frame', async ({
  page,
}) => {
  await page.goto('/')
  await setLanguage(page, 'en')
  await settleAppearance(page)
  // Sample real computed colors, including intermediate frames rather than only endpoints.
  await page.evaluate(() => {
    const state = window as Window & {
      contrastFailures: string[]
      stopContrast: () => void
    }
    state.contrastFailures = []
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 1
    const context = canvas.getContext('2d', { willReadFrequently: true })!
    const rgb = (text: string) => {
      context.clearRect(0, 0, 1, 1)
      context.fillStyle = text
      context.fillRect(0, 0, 1, 1)
      return Array.from(context.getImageData(0, 0, 1, 1).data)
    }
    const luminance = (color: number[]) =>
      color
        .slice(0, 3)
        .map((v) => {
          v /= 255
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
        })
        .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
    let running = true
    const sample = () => {
      for (const node of document.querySelectorAll<HTMLElement>(
        '[data-tool]',
      )) {
        if (!node.getClientRects().length) continue
        const style = getComputedStyle(node)
        let surface: HTMLElement | null = node,
          transparency = 1
        const bg = [0, 0, 0]
        while (surface && transparency > 0) {
          const color = rgb(getComputedStyle(surface).backgroundColor),
            alpha = color[3] / 255
          for (let i = 0; i < 3; i++) bg[i] += color[i] * alpha * transparency
          transparency *= 1 - alpha
          surface = surface.parentElement
        }
        for (let i = 0; i < 3; i++) bg[i] += 255 * transparency
        const a = luminance(rgb(style.color)),
          b = luminance(bg),
          ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
        if (ratio < 4.5)
          state.contrastFailures.push(
            `${node.dataset.tool}: ${ratio.toFixed(2)} (${style.color})`,
          )
      }
      if (running) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    state.stopContrast = () => {
      running = false
    }
  })
  for (const theme of ['dark', 'light', 'dark', 'light']) {
    await setTheme(page, theme as 'light' | 'dark')
    await settleAppearance(page)
    await showTools(page)
    const tool = page.locator('#tool-tab-rotate')
    await tool.hover()
    await tool.focus()
    await tool.click()
    if (await page.locator('#workspace-menu').isVisible()) await showTools(page)
    await page.locator('#tool-tab-images').click()
  }
  const failures = await page.evaluate(() => {
    const state = window as Window & {
      contrastFailures: string[]
      stopContrast: () => void
    }
    state.stopContrast()
    return state.contrastFailures
  })
  expect(failures).toEqual([])
})
