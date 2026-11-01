import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './en.json'
import nb from './nb.json'

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, nb: { translation: nb } },
    fallbackLng: 'en',
    supportedLngs: ['en', 'nb'],
    interpolation: { escapeValue: false },
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
    },
    react: { useSuspense: true },
    debug: false,
  })

export default i18n

const updateDocumentLanguage = (language: string) => {
  if (typeof document !== 'undefined')
    document.documentElement.lang = language.startsWith('nb') ? 'nb' : 'en'
}
i18n.on('languageChanged', updateDocumentLanguage)
updateDocumentLanguage(i18n.resolvedLanguage || i18n.language || 'en')
