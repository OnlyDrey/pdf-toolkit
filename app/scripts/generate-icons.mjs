// Render deterministic source geometry with the existing Playwright/Chromium toolchain.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import process from 'node:process'
import { chromium } from '@playwright/test'
const directory = fileURLToPath(new URL('../public/', import.meta.url))
const mark = readFileSync(directory + 'brand-mark.svg', 'utf8')
const paths = mark.match(/<path\b[^>]*\/>/g)?.join('')
if (!paths || (paths.match(/<path/g) || []).length !== 5)
  throw new Error('Unexpected canonical FileText geometry')
const notice = mark.match(/<!--[\s\S]*?-->/)[0]
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">${notice}<style>:root{--bg:#0f172a;--fg:#f8fafc}@media(prefers-color-scheme:dark){:root{--bg:#f8fafc;--fg:#0f172a}}</style><rect width="36" height="36" rx="8" fill="var(--bg)"/><svg x="8" y="8" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--fg)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg></svg>`
writeFileSync(directory + 'favicon.svg', svg + '\n')
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
})
try {
  for (const [size, name] of [
    [16, 'favicon-16.png'],
    [32, 'favicon-32.png'],
    [180, 'apple-touch-icon.png'],
  ]) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
      colorScheme: 'light',
    })
    await page.setContent(
      `<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{width:100%;height:100%}</style>${svg}`,
    )
    await page.screenshot({ path: directory + name, omitBackground: true })
    await page.close()
  }
} finally {
  await browser.close()
}
