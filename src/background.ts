import './types'
import { loadPrefs, PREFS_KEY, type BooklikePrefs } from './prefs'
import { type EpubImage } from './epub'
import { READER_ACTIVATION_GRACE_MS } from './config'

const PROXY_IMAGE_API = __PROXY_IMAGE_API__
const IMG_SRC = /<img\b[^>]*?\ssrc="([^"]+)"/gi

type IconPaths = Record<number, string>

type BooklikeMessage =
  | { type: 'booklike-inactive' }
  | { type: 'booklike-kill-js' }
  | { type: 'booklike-print' }
  | { type: 'booklike-freeze-title'; title: string }
  | { type: 'booklike-fetch-url'; url: string }
  | { type: 'booklike-dict-lookup'; word: string }
  | { type: 'booklike-fetch-epub-images'; content: string }
  | { type: 'booklike-create-iframe' }

async function getInstallId(): Promise<string> {
  const result = await chrome.storage.local.get('booklike-user-id')
  const existing = result['booklike-user-id'] as string | undefined
  if (existing) return existing
  const id = crypto.randomUUID()
  await chrome.storage.local.set({ 'booklike-user-id': id })
  return id
}

async function fetchImageMap(content: string, installId: string): Promise<Map<string, EpubImage>> {
  const urls = [
    ...new Set(
      [...content.matchAll(IMG_SRC)]
        .map((m) => m[1].replaceAll('&amp;', '&'))
        .filter((u) => u.startsWith('https://')),
    ),
  ]
  const imageMap = new Map<string, EpubImage>()
  if (urls.length === 0 || !PROXY_IMAGE_API) return imageMap
  await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(PROXY_IMAGE_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Booklike-Install-Id': installId },
        body: JSON.stringify({ url }),
      })
      if (!res.ok) return
      const rawMime = (res.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
      const mime = rawMime === 'image/png' ? 'image/png' : 'image/jpeg'
      imageMap.set(url, { data: new Uint8Array(await res.arrayBuffer()), mime })
    }),
  )
  return imageMap
}

function killPageJS() {
  const maxId = window.setTimeout(() => {}, 0)
  for (let i = 0; i <= Math.min(maxId, 100_000); i++) {
    window.clearTimeout(i)
    window.clearInterval(i)
  }
  window.setTimeout = ((..._args: Parameters<typeof setTimeout>): number => {
    return 0
  }) as typeof setTimeout
  window.setInterval = ((..._args: Parameters<typeof setInterval>): number => {
    return 0
  }) as typeof setInterval
  window.requestAnimationFrame = ((..._args: Parameters<typeof requestAnimationFrame>): number => {
    return 0
  }) as typeof requestAnimationFrame
  MessagePort.prototype.postMessage = () => {}
  Object.defineProperty(window, 'MessageChannel', {
    value: class {
      port1 = { onmessage: null, postMessage() {}, start() {}, close() {} }
      port2 = { onmessage: null, postMessage() {}, start() {}, close() {} }
    },
  })
}

chrome.runtime.onMessage.addListener((msg: BooklikeMessage, sender, sendResponse) => {
  if (msg.type === 'booklike-kill-js' && sender.tab?.id) {
    void chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: killPageJS })
      .catch(() => {})
    sendResponse()
    return
  }

  if (msg.type === 'booklike-inactive' && sender.tab?.id) {
    activeReaderTabs.delete(sender.tab.id)
    void chrome.action.setIcon({ tabId: sender.tab.id, path: ICON_DEFAULT })
    updateMenuVisibility(false)
    return
  }

  if (msg.type === 'booklike-freeze-title' && sender.tab?.id) {
    const frozenTitle: string = msg.title
    void chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: ((t: string) => {
          Object.defineProperty(document, 'title', {
            get: () => t,
            set: () => {},
            configurable: true,
          })
        }) as () => void,
        args: [frozenTitle],
      })
      .catch(() => {})
    return
  }

  if (msg.type === 'booklike-fetch-epub-images') {
    void (async () => {
      try {
        const installId = await getInstallId()
        const imageMap = await fetchImageMap(msg.content, installId)
        const images: Record<string, { data: number[]; mime: string }> = {}
        for (const [url, img] of imageMap) {
          images[url] = { data: Array.from(img.data), mime: img.mime }
        }
        sendResponse({ ok: true, images })
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[epub] error:', e)
        sendResponse({ ok: false })
      }
    })()
    return true
  }

  if (msg.type === 'booklike-dict-lookup' && msg.word) {
    fetch('https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(msg.word))
      .then((r) => (r.ok ? (r.json() as Promise<unknown>) : null))
      .then((data) => sendResponse({ data }))
      .catch(() => sendResponse({ data: null }))
    return true
  }

  if (msg.type === 'booklike-fetch-url' && msg.url) {
    fetch(msg.url)
      .then((r) => r.arrayBuffer())
      .then((buf) => {
        const bytes = new Uint8Array(buf)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const b64 = btoa(binary)
        const mime = msg.url.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg'
        sendResponse({ dataUrl: `data:${mime};base64,${b64}` })
      })
      .catch(() => sendResponse({ dataUrl: null }))
    return true
  }

  if (msg.type === 'booklike-print' && sender.tab?.id) {
    void chrome.scripting
      .executeScript({ target: { tabId: sender.tab.id }, world: 'MAIN', func: () => window.print() })
      .catch(() => {})
    sendResponse()
    return
  }

  if (msg.type === 'booklike-create-iframe' && sender.tab?.id) {
    void chrome.scripting
      .executeScript({
        target: { tabId: sender.tab.id },
        world: 'MAIN',
        func: () => {
          const iframe = document.createElement('iframe')
          iframe.id = 'booklike-reader'
          iframe.style.cssText =
            'position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:2147483647;visibility:hidden;'
          document.body.appendChild(iframe)
        },
      })
      .then(() => sendResponse(null))
      .catch(() => sendResponse(null))
    return true
  }

  return false
})

const ICON_DEFAULT: IconPaths = {
  16: 'icons/toolbar-icon-16.png',
  24: 'icons/toolbar-icon-24.png',
  32: 'icons/toolbar-icon-32.png',
}
const ICON_ACTIVE: IconPaths = {
  16: 'icons/toolbar-icon-active-16.png',
  24: 'icons/toolbar-icon-active-24.png',
  32: 'icons/toolbar-icon-active-32.png',
}

const activeReaderTabs = new Set<number>()
const recentlyActivated = new Set<number>()

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' && activeReaderTabs.has(tabId)) {
    if (recentlyActivated.has(tabId)) return
    activeReaderTabs.delete(tabId)
    void chrome.action.setIcon({ tabId, path: ICON_DEFAULT })
  }
  if (tab.active && changeInfo.status === 'complete') {
    updateMenuVisibility(activeReaderTabs.has(tabId))
  }
})

chrome.tabs.onRemoved.addListener((tabId) => {
  activeReaderTabs.delete(tabId)
  recentlyActivated.delete(tabId)
})

chrome.tabs.onActivated.addListener(({ tabId }) => {
  updateMenuVisibility(activeReaderTabs.has(tabId))
})

async function activateReader(tabId: number) {
  const result = await chrome.scripting
    .executeScript({
      target: { tabId },
      func: () => window.__BOOKLIKE_ACTIVE__ ?? false,
    })
    .catch(() => null)

  const isReaderActive: boolean = (result?.[0]?.result as boolean | undefined) ?? false

  if (isReaderActive) {
    activeReaderTabs.delete(tabId)
    void chrome.tabs.reload(tabId)
    void chrome.action.setIcon({ tabId, path: ICON_DEFAULT })
    updateMenuVisibility(false)
  } else {
    recentlyActivated.add(tabId)

    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] })
    } catch {
      recentlyActivated.delete(tabId)
      return
    }
    activeReaderTabs.add(tabId)
    void chrome.action.setIcon({ tabId, path: ICON_ACTIVE })
    updateMenuVisibility(true)
    setTimeout(() => recentlyActivated.delete(tabId), READER_ACTIVATION_GRACE_MS)
  }
}

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) void activateReader(tab.id)
})

const MENU_ID = 'booklike-read'

function createContextMenu() {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: 'Read in BookLike',
    contexts: ['page'],
    documentUrlPatterns: ['http://*/*', 'https://*/*'],
  })
}

function updateMenuVisibility(readerActive: boolean) {
  void chrome.contextMenus.update(MENU_ID, { visible: !readerActive })
}

chrome.runtime.onInstalled.addListener(() => {
  void loadPrefs().then((prefs) => {
    if (prefs.contextMenu) createContextMenu()
  })
})

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes[PREFS_KEY]) return
  const prefs = changes[PREFS_KEY].newValue as BooklikePrefs
  if (prefs.contextMenu) {
    createContextMenu()
  } else {
    void chrome.contextMenus.remove(MENU_ID)
  }
})

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === MENU_ID && tab?.id) {
    void activateReader(tab.id)
  }
})
