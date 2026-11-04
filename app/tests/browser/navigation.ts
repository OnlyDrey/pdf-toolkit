import type { Page } from '@playwright/test'
export async function showTools(page: Page) {
  const menu = page.locator('#workspace-menu')
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute('aria-expanded')) !== 'true'
  )
    await menu.click()
}
export async function navigate(page: Page, id: string) {
  await showTools(page)
  await page.locator('#tool-tab-' + id).click()
}
export async function docAction(page: Page, name: string) {
  const trigger = page.getByRole('button', { name: 'More document actions' })
  if ((await trigger.getAttribute('aria-expanded')) !== 'true')
    await trigger.click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}
