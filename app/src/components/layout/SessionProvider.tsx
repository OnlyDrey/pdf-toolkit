import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { SessionContext } from '@/lib/session-context'
import {
  DocumentStore,
  DocumentOperationError,
  type CommitOptions,
  type OperationToken,
} from '@/lib/document-store'
import { invalidatePreviews } from '@/lib/preview-service'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
export function SessionProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation(),
    [store] = useState(() => new DocumentStore()),
    state = useSyncExternalStore(store.subscribe, store.getState)
  const [prompt, setPrompt] = useState(false),
    resolver = useRef<((answer: boolean) => void) | null>(null),
    [error, setError] = useState('')
  const confirm = () =>
    new Promise<boolean>((resolve) => {
      resolver.current = resolve
      setPrompt(true)
    })
  const answer = (value: boolean) => {
    resolver.current?.(value)
    resolver.current = null
    setPrompt(false)
  }
  const commit = async (
    bytes: Uint8Array,
    name: string,
    token: OperationToken,
    options: CommitOptions = {},
  ) => {
    if (
      options.replace &&
      store.getState().session?.dirty &&
      !(await confirm())
    )
      return null
    try {
      return await store.commit(token, bytes, name, options)
    } catch (reason) {
      if (reason instanceof DocumentOperationError)
        setError(t('document.errors.' + reason.code))
      throw reason
    }
  }
  const attempt = (action: () => unknown) => {
    try {
      action()
      setError('')
    } catch {
      setError(t('document.errors.resource'))
    }
  }
  useEffect(() => {
    const file = state.session?.file
    return () => {
      if (file) invalidatePreviews(file)
    }
  }, [state.session?.file])
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (
        event.altKey ||
        (!event.ctrlKey && !event.metaKey) ||
        target.closest(
          'input,textarea,select,[contenteditable="true"],[role="textbox"]',
        ) ||
        document.querySelector('dialog[open]')
      )
        return
      const key = event.key.toLowerCase(),
        current = store.getState()
      if (current.busy) return
      if (key === 'z' && !event.shiftKey && current.past.length) {
        event.preventDefault()
        attempt(store.undo)
      } else if (
        ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey)) &&
        current.future.length
      ) {
        event.preventDefault()
        attempt(store.redo)
      }
    }
    window.addEventListener('keydown', keyboard)
    return () => window.removeEventListener('keydown', keyboard)
  }, [store])
  useEffect(
    () => () => {
      resolver.current?.(false)
      store.dispose()
      invalidatePreviews()
    },
    [store],
  )
  return (
    <SessionContext.Provider
      value={{
        session: state.session,
        busy: !!state.busy,
        operation: state.busy?.kind ?? null,
        selectedIds: state.snapshot?.selectedIds ?? [],
        canUndo: !!state.past.length,
        canRedo: !!state.future.length,
        discarded: state.discarded,
        historyBytes: store.historyBytes(),
        beginOperation: store.begin,
        endOperation: store.end,
        commitOperation: commit,
        clearSession: () => {
          store.clear()
          setError('')
        },
        selectPages: store.select,
        undo: () => attempt(store.undo),
        redo: () => attempt(store.redo),
        markSaved: store.save,
      }}
    >
      {error && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive-text">
          {error}
        </p>
      )}
      {children}
      <ConfirmationDialog
        open={prompt}
        title={t('document.replaceTitle')}
        description={t('document.replaceDescription')}
        confirmLabel={t('document.replace')}
        onCancel={() => answer(false)}
        onConfirm={() => answer(true)}
      />
    </SessionContext.Provider>
  )
}
