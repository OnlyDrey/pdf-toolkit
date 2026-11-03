import { createContext, useContext } from 'react'
import type {
  WorkingDocument,
  OperationToken,
  CommitOptions,
} from './document-store'
export type SessionFile = WorkingDocument
export interface SessionState {
  session: WorkingDocument | null
  busy: boolean
  operation: string | null
  selectedIds: string[]
  canUndo: boolean
  canRedo: boolean
  discarded: number
  historyBytes: number
  beginOperation: (kind: string) => OperationToken | null
  commitOperation: (
    bytes: Uint8Array,
    name: string,
    token: OperationToken,
    options?: CommitOptions,
  ) => Promise<WorkingDocument | null>
  endOperation: (token: OperationToken) => void
  clearSession: () => void
  selectPages: (ids: string[]) => void
  undo: () => void
  redo: () => void
  markSaved: () => void
}
export const SessionContext = createContext<SessionState | null>(null)
export function useSession() {
  const value = useContext(SessionContext)
  if (!value) throw new Error('Document session provider is missing')
  return value
}
export { DocumentOperationError } from './document-store'
