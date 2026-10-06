import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './index.css'

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

// No SuperSonicProvider: this page boots no engine. It is the one page on the
// site that would work without the isolation headers.
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
