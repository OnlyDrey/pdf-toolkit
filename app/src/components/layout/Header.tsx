import { Sun, Moon, Monitor, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ChoiceMenu } from '@/components/ui/choice-menu'
import { useTheme, type Theme } from '@/lib/theme-context'

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
    <div className="flex items-center gap-1">
      <ChoiceMenu
        label={t('theme.label')}
        icon={THEME_ICONS[theme]}
        value={theme}
        onChange={(value) => setTheme(value as Theme)}
        choices={(['light', 'dark', 'system'] as Theme[]).map((th) => ({
          value: th,
          label: t(`theme.${th}`),
          icon: THEME_ICONS[th],
        }))}
      />
      <ChoiceMenu
        label={t('language.label')}
        icon={<Globe className="h-4 w-4" />}
        value={currentLang}
        onChange={(value) => void i18n.changeLanguage(value)}
        choices={[
          { value: 'nb', label: 'Norsk' },
          { value: 'en', label: 'English' },
        ]}
      />
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
      <span className="min-w-0 break-words font-semibold tracking-tight [overflow-wrap:anywhere]">
        {t('app.title')}
      </span>
    </div>
  )
}
