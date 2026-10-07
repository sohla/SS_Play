import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SuperSonicProvider } from '@ss/react'
import { App } from './App.tsx'
import './index.css'

// Both: the voice and the fx tail it plays into.
const SYNTHDEFS = ['ssp_dulcimer', 'ssp_dulcimer_fx']

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <SuperSonicProvider base={__SS_ENGINE_BASE__} synthdefs={SYNTHDEFS}>
      <App />
    </SuperSonicProvider>
  </StrictMode>,
)
