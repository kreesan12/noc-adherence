import 'leaflet/dist/leaflet.css';
import './styles.css'

import React from 'react';
import ReactDOM from 'react-dom/client';

const rootElement = document.getElementById('root')

function renderBootstrapError(errorLike) {
  if (!rootElement) return

  const message = errorLike?.message || errorLike || 'Unknown frontend startup error'
  const detail = errorLike?.stack || String(errorLike || '')

  rootElement.innerHTML = `
    <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:
      radial-gradient(circle at top left, rgba(15,118,110,0.12) 0%, transparent 26%),
      linear-gradient(180deg, #f2f7f6 0%, #f7f8fc 28%, #f8fafc 100%);font-family:Manrope,system-ui,sans-serif;color:#0f172a;">
      <div style="width:min(760px,100%);background:rgba(255,255,255,0.96);border:1px solid rgba(15,23,42,0.08);border-radius:20px;padding:24px;box-shadow:0 26px 64px rgba(15,23,42,0.12);">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;background:rgba(220,38,38,0.1);color:#991b1b;font-size:12px;font-weight:800;">Frontend Startup Issue</div>
        <h1 style="margin:14px 0 8px;font-size:28px;line-height:1.05;">Frogfoot Ops Hub could not start</h1>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#475569;">
          The frontend bundle hit an error during startup. Refresh once, and if it persists, share the message below so we can fix it quickly.
        </p>
        <div style="padding:12px 14px;border-radius:14px;background:#fff7ed;border:1px solid #fed7aa;color:#9a3412;font-size:13px;font-weight:700;word-break:break-word;">
          ${escapeHtml(message)}
        </div>
        <pre style="margin:14px 0 0;padding:14px;border-radius:14px;background:#0f172a;color:#e2e8f0;font-size:12px;line-height:1.5;overflow:auto;white-space:pre-wrap;">${escapeHtml(detail)}</pre>
      </div>
    </div>
  `
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

window.addEventListener('error', (event) => {
  console.error('Global frontend error', event.error || event.message)
  if (rootElement && rootElement.childElementCount === 0) {
    renderBootstrapError(event.error || event.message)
  }
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Global frontend rejection', event.reason)
  if (rootElement && rootElement.childElementCount === 0) {
    renderBootstrapError(event.reason)
  }
})

async function bootstrap() {
  try {
    const { default: App } = await import('./App.jsx')
    const root = ReactDOM.createRoot(rootElement)
    root.render(<App />)
  } catch (error) {
    console.error('Frontend bootstrap failed', error)
    renderBootstrapError(error)
  }
}

bootstrap()
