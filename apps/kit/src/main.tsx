import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperSonicProvider } from '@ss/react'
import { App } from './App.tsx'
import './index.css'

const SYNTHDEFS = ['ssp_kit']

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <SuperSonicProvider base={__SS_ENGINE_BASE__} synthdefs={SYNTHDEFS}>
      <App />
    </SuperSonicProvider>
  </StrictMode>,
)
