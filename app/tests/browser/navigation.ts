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
const LANGUAGES = { en: 'English', nb: 'Norsk' } as const
const THEMES = {
  en: { light: 'Light', dark: 'Dark', system: 'System' },
  nb: { light: 'Lyst', dark: 'Mørkt', system: 'System' },
} as const
async function choose(page: Page, label: RegExp, item: string) {
  await page.getByRole('button', { name: label, exact: false }).first().click()
  await page.getByRole('menuitemradio', { name: item, exact: true }).click()
}
export const setLanguage = (page: Page, language: keyof typeof LANGUAGES) =>
  choose(page, /^(Language|Språk)$/, LANGUAGES[language])
export async function setTheme(page: Page, theme: 'light' | 'dark' | 'system') {
  const lang = (await page.locator('html').getAttribute('lang')) === 'nb'
  await choose(page, /^(Theme|Tema)$/, THEMES[lang ? 'nb' : 'en'][theme])
}
export async function hideTools(page: Page) {
  const menu = page.locator('#workspace-menu')
  if (
    (await menu.isVisible()) &&
    (await menu.getAttribute('aria-expanded')) === 'true'
  )
    await menu.click()
}
