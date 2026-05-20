import { FileText, Sun, Moon, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTheme, type Theme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  light:  <Sun     className="h-4 w-4" />,
  dark:   <Moon    className="h-4 w-4" />,
  system: <Monitor className="h-4 w-4" />,
}

export function Header() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentLang = i18n.language.startsWith('nb') ? 'nb' : 'en'

  return (
    <header className="border-b bg-background">
      <div className="mx-auto max-w-5xl px-4 py-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h1 className="text-xl font-bold leading-none tracking-tight">{t('app.title')}</h1>
              <p className="mt-0.5 hidden text-xs text-muted-foreground sm:block">{t('app.tagline')}</p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {/* Theme toggle: Sun / Moon / Monitor */}
            <div className="flex items-center rounded-md border p-0.5">
              {(['light', 'dark', 'system'] as Theme[]).map((th) => (
                <button key={th} type="button" onClick={() => setTheme(th)} aria-label={th}
                  className={cn('flex items-center justify-center rounded p-1.5 transition-colors',
                    theme === th ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>
                  {THEME_ICONS[th]}
                </button>
              ))}
            </div>
            <Separator orientation="vertical" className="h-6" />
            {/* Language toggle */}
            <div className="flex items-center gap-1">
              <Button variant={currentLang === 'en' ? 'default' : 'ghost'} size="sm"
                onClick={() => i18n.changeLanguage('en')} aria-label={t('language.en')}>EN</Button>
              <Button variant={currentLang === 'nb' ? 'default' : 'ghost'} size="sm"
                onClick={() => i18n.changeLanguage('nb')} aria-label={t('language.nb')}>NO</Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}