import { createContext, useContext } from 'react'
export interface SessionFile { bytes: Uint8Array; name: string }
export interface SessionState {
  session: SessionFile | null
  setSession: (bytes: Uint8Array, name: string) => void
  clearSession: () => void
}
export const SessionContext = createContext<SessionState>({
  session: null, setSession: () => {}, clearSession: () => {},
})
export const useSession = () => useContext(SessionContext)