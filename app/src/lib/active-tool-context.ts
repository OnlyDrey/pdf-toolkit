import { createContext, useContext } from 'react'
export const ActiveToolContext = createContext(true)
export const useActiveTool = () => useContext(ActiveToolContext)
