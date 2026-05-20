import { useRef, type DragEvent, type ChangeEvent } from 'react'
import { Upload, FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
interface FileDropZoneProps {
  multiple?: boolean; onFiles: (files: File[]) => void; className?: string
  hasFile?: boolean; fileLabel?: string; sessionName?: string; onUseSession?: () => void
}
export function FileDropZone({ multiple=false, onFiles, className, hasFile=false,
  fileLabel, sessionName, onUseSession }: FileDropZoneProps) {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    const files = Array.from(e.dataTransfer.files).filter(
      f => f.type==='application/pdf'||f.name.toLowerCase().endsWith('.pdf'))
    if (files.length>0) onFiles(files)
  }
  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files??[])
    if (files.length>0) onFiles(files)
    e.target.value=''
  }
  const showSession = !hasFile && !!sessionName && !!onUseSession
  return (
    <div className={cn('space-y-0',className)}>
      <div role="button" tabIndex={0}
        aria-label={multiple?t('common.dragDropMultiple'):t('common.dragDropHere')}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-muted/30 p-8 text-center transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          hasFile&&'border-primary/40 bg-primary/5',
          showSession&&'rounded-b-none border-b-0'
        )}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => e.key==='Enter'&&inputRef.current?.click()}
        onDrop={handleDrop} onDragOver={e=>e.preventDefault()}>
        <Upload className="mb-3 h-8 w-8 text-muted-foreground" />
        {hasFile&&fileLabel ? (
          <><p className="text-sm font-medium text-foreground">{fileLabel}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('common.dragDropHere')}</p></>
        ) : (
          <><p className="text-sm font-medium text-foreground">
              {multiple?t('common.dragDropMultiple'):t('common.dragDropHere')}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t('common.fileType')}</p></>
        )}
        <input ref={inputRef} type="file" accept=".pdf,application/pdf"
          multiple={multiple} className="hidden" onChange={handleChange} />
      </div>
      {showSession && (
        <button type="button"
          onClick={e=>{e.stopPropagation();onUseSession!()}}
          className="flex w-full items-center gap-2 rounded-b-lg border-2 border-t border-dashed border-primary/30 bg-primary/5 px-4 py-2.5 text-left transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <FileText className="h-4 w-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {t('session.useFile')}:{' '}
            <span className="font-medium text-foreground">{sessionName}</span>
          </span>
          <span className="shrink-0 text-xs font-medium text-primary">{t('session.use')} &rarr;</span>
        </button>
      )}
    </div>
  )
}