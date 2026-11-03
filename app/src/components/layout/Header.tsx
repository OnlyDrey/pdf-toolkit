import { Sun, Moon, Monitor } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { useTheme, type Theme } from '@/lib/theme-context'
import { cn } from '@/lib/utils'

const THEME_ICONS: Record<Theme, React.ReactNode> = {
  light: <Sun className="h-4 w-4" />,
  dark: <Moon className="h-4 w-4" />,
  system: <Monitor className="h-4 w-4" />,
}

export function AppearanceControls() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const currentLang = i18n.language.startsWith('nb') ? 'nb' : 'en'
  return (
    <div className="flex max-w-full flex-wrap items-center gap-2">
      {/* Theme toggle: Sun / Moon / Monitor */}
      <div className="flex items-center rounded-md border p-0.5">
        {(['light', 'dark', 'system'] as Theme[]).map((th) => (
          <button
            key={th}
            type="button"
            onClick={() => setTheme(th)}
            aria-label={t(`theme.${th}`)}
            aria-pressed={theme === th}
            className={cn(
              'flex items-center justify-center min-h-8 min-w-8 rounded p-1.5 transition-colors',
              theme === th
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {THEME_ICONS[th]}
          </button>
        ))}
      </div>
      <Separator orientation="vertical" className="h-6" />
      {/* Language toggle */}
      <div className="flex items-center gap-1">
        <Button
          variant={currentLang === 'en' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => i18n.changeLanguage('en')}
        >
          EN<span className="sr-only"> {t('language.en')}</span>
        </Button>
        <Button
          variant={currentLang === 'nb' ? 'default' : 'ghost'}
          size="sm"
          onClick={() => i18n.changeLanguage('nb')}
        >
          NO<span className="sr-only"> {t('language.nb')}</span>
        </Button>
      </div>
    </div>
  )
}
export function Brand() {
  const { t } = useTranslation()
  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <span aria-hidden="true" className="brand-mark h-5 w-5" />
      </span>
      <span className="font-semibold tracking-tight">{t('app.title')}</span>
    </div>
  )
}
