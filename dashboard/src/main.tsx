import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/ui/Toast'
import PwaInstallPrompt from './components/ui/PwaInstallPrompt'
import './index.css'

// PWA: register the service worker (installability + offline app shell).
// Runs only in production-like contexts — service workers require HTTPS
// (or localhost) and are a no-op elsewhere.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration is best-effort — never block the app on it.
    })
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <PwaInstallPrompt />
    </ToastProvider>
  </React.StrictMode>,
)