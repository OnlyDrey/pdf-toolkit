import { useLayoutEffect, useState, type ReactNode } from 'react'
import { ThemeContext, type Theme } from '@/lib/theme-context'

const STORAGE_KEY = 'pdf-toolkit-theme'

function getInitialTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark' || stored === 'system')
      return stored
  } catch {
    /* SSR / private-mode guard */
  }
  return 'system'
}

// Change the palette atomically: interpolating two accessible palettes can
// produce unreadable intermediate foreground/background combinations.
function applyTheme(theme: Theme) {
  const root = document.documentElement
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches)
  root.dataset.themeChanging = 'true'
  root.classList.toggle('dark', dark)
  root.dataset.theme = dark ? 'dark' : 'light'
  // Resolve the new palette while transitions are suppressed, before paint.
  void root.offsetHeight
  let second = 0
  const first = requestAnimationFrame(() => {
    second = requestAnimationFrame(() => {
      delete root.dataset.themeChanging
    })
  })
  return () => {
    cancelAnimationFrame(first)
    cancelAnimationFrame(second)
    delete root.dataset.themeChanging
  }
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme)

  const setTheme = (t: Theme) => {
    try {
      localStorage.setItem(STORAGE_KEY, t)
    } catch {
      /* ignore */
    }
    setThemeState(t)
  }

  useLayoutEffect(() => {
    let cleanup = applyTheme(theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const handler = () => {
      cleanup()
      cleanup = applyTheme('system')
    }
    if (theme === 'system') mq.addEventListener('change', handler)
    return () => {
      cleanup()
      mq.removeEventListener('change', handler)
    }
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
