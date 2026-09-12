import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ToastProvider } from './components/ui/Toast'
import PwaInstallPrompt from './components/ui/PwaInstallPrompt'
import { applyPlatformTag } from './lib/platform'
import './index.css'

// PWA: register the service worker (installability + offline app shell).
// Production-only (services workers are a no-op on file:// and can interfere
// with the Vite dev server), and always best-effort — never blocks the app.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // SW registration is best-effort — never block the app on it.
    })
  })
}

// Tag <html data-platform> for CSS/UI hooks (desktop-web / mobile-web / pwa / windows-desktop).
applyPlatformTag()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <App />
      <PwaInstallPrompt />
    </ToastProvider>
  </React.StrictMode>,
)