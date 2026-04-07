import { getEmail } from './helpers'
import { MIN_ARTICLE_WORD_COUNT } from './config'

const FONT_FAMILY = `ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif`

function createShadowHost(overlay: HTMLDivElement): ShadowRoot {
  const host = document.createElement('div')
  overlay.appendChild(host)
  return host.attachShadow({ mode: 'open' })
}

export function showLoadingOverlay(): HTMLDivElement {
  const overlay = document.createElement('div')
  overlay.id = 'booklike-loading'
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;'
  overlay.style.backgroundColor = window.matchMedia('(prefers-color-scheme:dark)').matches
    ? 'rgba(0,0,0,0.8)'
    : 'rgba(255,255,255,0.8)'
  const shadow = createShadowHost(overlay)
  shadow.innerHTML = `<svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg"><style>@keyframes bl-bar{0%,100%{fill:#facc15}50%{fill:#fff}}@keyframes bl-c1{0%,100%{transform:scale(1);fill:#fff}50%{transform:scale(.86);fill:#facc15}}@keyframes bl-c2{0%,100%{transform:scale(1);fill:#fff}50%{transform:scale(.79);fill:#facc15}}.bl-bar{animation:bl-bar 2s ease-in-out infinite}.bl-c1{transform-origin:44px 29px;animation:bl-c1 1.2s cubic-bezier(.4,0,.2,1) infinite}.bl-c2{transform-origin:46px 51px;animation:bl-c2 1.2s cubic-bezier(.4,0,.2,1) infinite .4s;animation-fill-mode:backwards}</style><rect width="80" height="80" rx="16" fill="#1a1a1a"/><rect x="24" y="16" width="6" height="48" rx="3" class="bl-bar"/><circle cx="44" cy="29" r="11" class="bl-c1"/><circle cx="46" cy="51" r="13" class="bl-c2"/></svg>`
  document.body.appendChild(overlay)
  return overlay
}

export function showExtractionError(existing: HTMLDivElement | null): void {
  const dark = window.matchMedia('(prefers-color-scheme:dark)').matches

  let overlay = existing
  if (!overlay) {
    overlay = document.createElement('div')
    overlay.id = 'booklike-loading'
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;'
    overlay.style.backgroundColor = dark ? 'rgba(0,0,0,0.8)' : 'rgba(255,255,255,0.8)'
    document.body.appendChild(overlay)
  }

  const cardBg = dark ? '#1c1c1e' : '#ffffff'
  const heading = dark ? '#f5f5f5' : '#111111'
  const body = dark ? '#999999' : '#666666'
  const btnBg = dark ? '#f5f5f5' : '#111111'
  const btnColor = dark ? '#111111' : '#ffffff'
  const shadow = dark ? '0 8px 40px rgba(0,0,0,0.5)' : '0 8px 40px rgba(0,0,0,0.12)'
  const iconShapes = dark ? '#4a4a4a' : '#ffffff'
  const reportUrl = `mailto:${getEmail()}?subject=Extraction%20failed&body=URL%3A%20${encodeURIComponent(location.href)}`

  overlay.innerHTML = ''
  const host = document.createElement('div')
  overlay.appendChild(host)
  const shadowRoot = host.attachShadow({ mode: 'open' })

  shadowRoot.innerHTML = `
    <style>
      :host { font-family: ${FONT_FAMILY}; font-style: normal; }
      * { box-sizing: border-box; }
    </style>
    <div style="background:${cardBg};border-radius:16px;padding:40px 36px;max-width:360px;width:calc(100% - 48px);text-align:center;font-family:${FONT_FAMILY};box-shadow:${shadow};">
      <svg width="64" height="64" viewBox="0 0 80 80" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-bottom:20px">
        <rect width="80" height="80" rx="16" fill="${dark ? '#000000' : '#1a1a1a'}"/>
        <rect x="24" y="16" width="6" height="48" rx="3" fill="${iconShapes}"/>
        <circle cx="44" cy="29" r="11" fill="${iconShapes}"/>
        <circle cx="46" cy="51" r="13" fill="${iconShapes}"/>
        <circle cx="41" cy="48" r="2" fill="#1a1a1a"/>
        <circle cx="51" cy="48" r="2" fill="#1a1a1a"/>
        <path d="M39 56 Q46 51 53 56" stroke="#1a1a1a" stroke-width="2.5" stroke-linecap="round" fill="none"/>
      </svg>
      <h2 style="margin:0 0 8px;font-size:18px;font-weight:600;color:${heading};letter-spacing:-0.01em;font-style:normal">Couldn't read this page</h2>
      <p style="margin:0 0 28px;font-size:14px;line-height:1.6;color:${body};font-style:normal">BookLike wasn't able to extract the article content from this page.</p>
      <button id="booklike-error-close" style="display:block;width:100%;padding:12px;margin-bottom:14px;background:${btnBg};color:${btnColor};border:none;border-radius:10px;font-size:15px;font-weight:500;cursor:pointer;font-family:${FONT_FAMILY};font-style:normal;">Close</button>
      <a href="${reportUrl}" style="display:block;font-size:13px;color:#888;text-decoration:none;font-style:normal;">Think this is a bug? <span style="text-decoration:underline">Report an issue</span></a>
    </div>
  `

  shadowRoot.getElementById('booklike-error-close')?.addEventListener('click', () => {
    overlay.remove()
    window.__BOOKLIKE_ACTIVE__ = false
    void chrome.runtime
      .sendMessage({ type: 'booklike-inactive' })
      .catch(() =>
        setTimeout(() => void chrome.runtime.sendMessage({ type: 'booklike-inactive' }).catch(() => {}), 300),
      )
  })
}

export function isBelowMinWordCount(html: string): boolean {
  const tmp = document.createElement('div')
  tmp.innerHTML = html
  const wordCount = (tmp.textContent ?? '').trim().split(/\s+/).filter(Boolean).length
  return wordCount < MIN_ARTICLE_WORD_COUNT
}
