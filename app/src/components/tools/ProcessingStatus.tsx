import { useTranslation } from 'react-i18next'
export function ProcessingStatus({ busy }: { busy: boolean }) {
  const { t } = useTranslation()
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {busy ? t('common.processing') : ''}
    </p>
  )
}
