import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { instruments, synthdefsOf } from '@ss/onboard'
import { SuperSonicProvider } from '@ss/react'
import { App } from './App.tsx'
import './index.css'

// Hoisted: a fresh array each render would be a changing dependency of the
// provider's boot callback.
const SYNTHDEFS = [...synthdefsOf(instruments)]

const root = document.getElementById('root')
if (!root) throw new Error('#root missing from index.html')

createRoot(root).render(
  <StrictMode>
    <SuperSonicProvider base={__SS_ENGINE_BASE__} synthdefs={SYNTHDEFS}>
      <App />
    </SuperSonicProvider>
  </StrictMode>,
)
