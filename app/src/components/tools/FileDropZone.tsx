import {
  useRef,
  useState,
  useId,
  type DragEvent,
  type ChangeEvent,
} from 'react'
import { Upload, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
interface FileDropZoneProps {
  disabled?: boolean
  multiple?: boolean
  onFiles: (files: File[]) => void
  className?: string
  hasFile?: boolean
  fileLabel?: string
  sessionName?: string
  onUseSession?: () => void
}
export function FileDropZone({
  disabled = false,
  multiple = false,
  onFiles,
  className,
  hasFile = false,
  fileLabel,
  sessionName,
  onUseSession,
}: FileDropZoneProps) {
  const { t } = useTranslation()
  const [fileError, setFileError] = useState(false)
  const [dragging, setDragging] = useState(false)
  const errorId = useId()
  const acceptFiles = (files: File[]) => {
    if (disabled || !files.length) return
    if (
      files.some(
        (f) =>
          f.type !== 'application/pdf' &&
          !f.name.toLowerCase().endsWith('.pdf'),
      )
    ) {
      setFileError(true)
      return
    }
    setFileError(false)
    onFiles(multiple ? files : files.slice(0, 1))
  }
  const inputRef = useRef<HTMLInputElement>(null)
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    acceptFiles(Array.from(e.dataTransfer.files))
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    acceptFiles(Array.from(e.target.files ?? []))
    e.target.value = ''
  }

  const showSession = !hasFile && !!sessionName && !!onUseSession
  return (
    <div className={cn('space-y-0', className)}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        aria-disabled={disabled || undefined}
        aria-describedby={fileError ? errorId : undefined}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-input bg-muted/30 p-4 sm:p-8 text-center transition-colors hover:bg-muted/50 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring',
          hasFile && 'border-primary bg-primary/5',
          dragging && 'border-primary bg-primary/10',
          disabled && 'cursor-wait opacity-60',
          showSession && 'rounded-b-none border-b-0',
        )}
        onClick={() => {
          if (!disabled) inputRef.current?.click()
        }}
        onKeyDown={(e) => {
          if (!disabled && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            inputRef.current?.click()
          }
        }}
        onDrop={handleDrop}
        onDragOver={(e) => {
          e.preventDefault()
          if (!disabled) setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
      >
        <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
        {hasFile && fileLabel ? (
          <>
            <p className="max-w-full break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]">
              {fileLabel}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('common.dragDropHere')}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-medium text-foreground">
              {multiple
                ? t('common.dragDropMultiple')
                : t('common.dragDropHere')}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t('common.fileType')}
            </p>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          aria-label={
            multiple ? t('common.dragDropMultiple') : t('common.dragDropHere')
          }
          disabled={disabled}
          accept=".pdf,application/pdf"
          multiple={multiple}
          className="hidden"
          onChange={handleChange}
        />
      </div>
      {fileError && (
        <p
          id={errorId}
          role="alert"
          className="pt-2 text-sm text-destructive-text"
        >
          {t('errors.fileType')}
        </p>
      )}
      {showSession && (
        <button
          type="button"
          disabled={disabled}
          onClick={(e) => {
            e.stopPropagation()
            onUseSession!()
          }}
          className="flex w-full items-center gap-2 rounded-b-lg border-2 border-t border-dashed border-primary/30 bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t('session.useFile')}:{' '}
            <span className="font-medium text-foreground">{sessionName}</span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">
            {t('session.use')} &rarr;
          </span>
        </button>
      )}
    </div>
  )
}
