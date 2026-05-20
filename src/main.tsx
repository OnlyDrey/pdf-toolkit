import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import './i18n/index'
import './index.css'
import App from './App'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <App />
    </Suspense>
  </React.StrictMode>
)