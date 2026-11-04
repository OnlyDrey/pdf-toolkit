import { expect, type Page } from '@playwright/test'
/** Wait for actual palette application and font readiness, never a fixed delay. */
export async function settleAppearance(page: Page) {
  await expect(page.locator('html')).not.toHaveAttribute(
    'data-theme-changing',
    'true',
  )
  await page.evaluate(() => document.fonts.ready)
}
