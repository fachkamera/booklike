import type { DisplayCtx, ReaderSettings } from '../types'
import { getEmail } from '../helpers'
import {
  EPUB_IMAGE_QUOTA_MONTHLY,
  EPUB_IMAGE_QUOTA_WARN_AT,
  EPUB_MAX_ARTICLE_IMAGES,
  PRINT_SANDBOX_DETECT_MS,
  PRINT_TOAST_DURATION_MS,
  WHEEL_DELTA_BUFFER_SIZE,
  WHEEL_FRESH_GESTURE_GAP_MS,
} from '../config'
import { defaults, loadSettings, saveSettings, syncSettingsUI, bindSetting, bindToggle } from './settings'
import {
  applyAll,
  applyTheme,
  applyDisplayMode,
  applyFont,
  applyFontSize,
  applyLineHeight,
  applyLetterSpacing,
  applyTextAlign,
  applyMargin,
  applyHyphens,
  applyLinks,
  applyImages,
} from './apply'
import { createPagination } from './pagination'
import { createPanelManager } from './panels'
import { createDictionary } from './dictionary'
import { createLightbox } from './lightbox'
import { buildEpub, type EpubImage } from '../epub'
import { awaitFirstImage, setupImageMeasuring, setupHiResUpgrades } from './images'

interface ParsedFontFace {
  family: string
  filename: string
  weight?: string
  style?: string
  unicodeRange?: string
}

async function loadTemplate(): Promise<{
  html: string
  strippedCss: string
  parsedFaces: ParsedFontFace[]
}> {
  const [html, css] = await Promise.all([
    fetch(chrome.runtime.getURL('reader.html')).then((r) => r.text()),
    fetch(chrome.runtime.getURL('reader.css')).then((r) => r.text()),
  ])

  // Parse @font-face blocks to extract descriptors and filenames
  const parsedFaces: ParsedFontFace[] = []
  const atFontFaceRe = /@font-face\s*\{([^}]+)\}/g
  let m: RegExpExecArray | null
  while ((m = atFontFaceRe.exec(css)) !== null) {
    const block = m[1]
    const family = /font-family\s*:\s*['"]?([^;'"]+)['"]?/.exec(block)?.[1]?.trim()
    const filename = /url\(['"]?\.?\.?\/?fonts\/([^'")]+)['"]?\)/.exec(block)?.[1]
    if (!family || !filename) continue
    parsedFaces.push({
      family,
      filename,
      weight: /font-weight\s*:\s*([^;]+)/.exec(block)?.[1]?.trim(),
      style: /font-style\s*:\s*([^;]+)/.exec(block)?.[1]?.trim(),
      unicodeRange: /unicode-range\s*:\s*([^;]+)/.exec(block)?.[1]?.trim(),
    })
  }

  // Strip @font-face blocks — fonts are loaded via FontFace API, not CSS urls
  const strippedCss = css.replace(/@font-face\s*\{[^}]+\}/g, '')
  return { html, strippedCss, parsedFaces }
}

async function loadFontBuffers(
  parsedFaces: ParsedFontFace[],
): Promise<{ buffer: ArrayBuffer; descriptor: ParsedFontFace }[]> {
  const uniqueFiles = [...new Set(parsedFaces.map((d) => d.filename))]
  const bufferMap = new Map<string, ArrayBuffer>()
  await Promise.all(
    uniqueFiles.map((f) =>
      fetch(chrome.runtime.getURL('fonts/' + f))
        .then((r) => r.arrayBuffer())
        .then((buf) => bufferMap.set(f, buf))
        .catch(() => {}),
    ),
  )
  return parsedFaces
    .map((descriptor) => {
      const buffer = bufferMap.get(descriptor.filename)
      return buffer ? { buffer, descriptor } : null
    })
    .filter(Boolean) as { buffer: ArrayBuffer; descriptor: ParsedFontFace }[]
}

function clearPage(title: string, preserve?: Element): void {
  history.replaceState({ booklikeReader: true }, '', location.href)
  document.documentElement.removeAttribute('class')
  document.documentElement.removeAttribute('style')
  document.head.innerHTML = ''
  document.body.removeAttribute('class')
  document.body.removeAttribute('style')
  Array.from(document.body.children).forEach((el) => {
    if (el !== preserve) el.remove()
  })
  document.title = title
  void chrome.runtime.sendMessage({ type: 'booklike-freeze-title', title })
  Object.assign(document.documentElement.style, {
    margin: '0',
    overflow: 'hidden',
    height: '100vh',
  })
}

async function mountIframe(
  html: string,
  rewrittenCss: string,
): Promise<{ iframe: HTMLIFrameElement; doc: Document }> {
  const parsed = new DOMParser().parseFromString(html, 'text/html')

  const base = parsed.createElement('base')
  base.target = '_blank'
  parsed.head.appendChild(base)

  const style = parsed.createElement('style')
  style.textContent = rewrittenCss
  parsed.head.appendChild(style)

  await chrome.runtime.sendMessage({ type: 'booklike-create-iframe' })
  const iframe = document.getElementById('booklike-reader') as HTMLIFrameElement
  const doc = iframe.contentDocument
  if (!doc) throw new Error('iframe contentDocument unavailable')

  for (const node of Array.from(parsed.head.childNodes)) doc.head.appendChild(doc.adoptNode(node))
  doc.body.className = parsed.body.className
  for (const node of Array.from(parsed.body.childNodes)) doc.body.appendChild(doc.adoptNode(node))

  return { iframe, doc }
}

function populateContent(
  doc: Document,
  container: Element,
  title: string,
  subtitle: string | null,
  byline: string | null,
  content: string,
  lang: string,
): void {
  const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
  const zoomKey = doc.getElementById('zoomKey')
  if (zoomKey) zoomKey.textContent = isMac ? '⌘' : 'Ctrl'
  const activationShortcut = doc.getElementById('activationShortcut')
  if (activationShortcut) activationShortcut.textContent = isMac ? 'Option+Shift+B' : 'Alt+Shift+B'
  const feedbackEmail = doc.querySelector<HTMLAnchorElement>('#feedbackEmail')
  if (feedbackEmail) feedbackEmail.href = 'mailto:' + getEmail()
  const bookFrame = doc.getElementById('bookFrame')
  if (bookFrame) bookFrame.setAttribute('lang', lang)
  container.innerHTML = ''
  const h1 = doc.createElement('h1')
  h1.textContent = title
  container.appendChild(h1)
  if (subtitle) {
    const p = doc.createElement('p')
    p.setAttribute('data-booklike-subtitle', '')
    p.className = 'text-xl italic'
    p.textContent = subtitle
    container.appendChild(p)
  }
  if (byline) {
    const div = doc.createElement('div')
    div.setAttribute('data-booklike-byline', '')
    div.className = 'leading-normal text-[0.8em] flex justify-between gap-x-16 mb-10 [&>p]:my-0'
    div.innerHTML = byline
    container.appendChild(div)
  }
  container.insertAdjacentHTML('beforeend', content)
  container
    .querySelectorAll<HTMLElement>(
      'a, button, input, select, textarea, pre, details, summary, iframe, audio, video, [contenteditable], [tabindex]',
    )
    .forEach((el) => el.setAttribute('tabindex', '-1'))
  container.querySelectorAll('img').forEach((img) => img.classList.add('w-full'))
}

function bindSettingsControls(
  doc: Document,
  state: ReaderSettings,
  ctx: DisplayCtx,
  measure: () => void,
  dict: ReturnType<typeof createDictionary>,
  settingsPanel: HTMLElement,
  themePanel: HTMLElement,
): void {
  bindSetting(doc, 'theme', state, 'theme', () => applyTheme(ctx))
  bindSetting(doc, 'display-mode', state, 'displayMode', () => applyDisplayMode(ctx), measure)
  bindToggle(doc, 'contrast', (checked) => {
    state.highContrast = checked
    applyDisplayMode(ctx)
    saveSettings(state)
  })
  bindSetting(doc, 'font', state, 'font', () => applyFont(ctx), measure)
  bindSetting(doc, 'font-size', state, 'fontSize', () => applyFontSize(ctx), measure)
  bindSetting(doc, 'line-height', state, 'lineHeight', () => applyLineHeight(ctx), measure)
  bindSetting(doc, 'letter-spacing', state, 'letterSpacing', () => applyLetterSpacing(ctx), measure)
  bindSetting(doc, 'text-align', state, 'textAlign', () => applyTextAlign(ctx), measure)
  bindSetting(doc, 'margin', state, 'margin', () => applyMargin(ctx), measure)
  bindSetting(doc, 'hyphens', state, 'hyphens', () => applyHyphens(ctx), measure)
  bindToggle(doc, 'links', (checked) => {
    state.preserveLinks = checked
    applyLinks(ctx)
    saveSettings(state)
  })
  bindToggle(doc, 'images', (checked) => {
    state.showImages = checked
    applyImages(ctx)
    saveSettings(state)
    measure()
  })
  bindToggle(doc, 'dictionary', (checked) => {
    state.dictionary = checked
    dict.setEnabled(checked)
    saveSettings(state)
  })
  ;[settingsPanel, themePanel].forEach((panel) => {
    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.target as HTMLElement).matches('input[type="checkbox"]'))
        (e.target as HTMLInputElement).click()
    })
  })
  doc.getElementById('btnResetSettings')?.addEventListener('click', () => {
    Object.assign(state, defaults)
    saveSettings(state)
    syncSettingsUI(doc, state)
    applyAll(ctx)
    dict.setEnabled(state.dictionary)
  })
}

function bindWheelNavigation(
  doc: Document,
  pagination: ReturnType<typeof createPagination>,
  lightbox: ReturnType<typeof createLightbox>,
): void {
  const wheelDeltas: number[] = []
  let wheelLocked = false
  let lastWheelTime = 0
  doc.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      const now = Date.now()
      const gap = now - lastWheelTime
      lastWheelTime = now
      const px = Math.abs(e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY)
      wheelDeltas.push(px)
      if (wheelDeltas.length > WHEEL_DELTA_BUFFER_SIZE - 1) wheelDeltas.shift()
      if (wheelLocked) return
      const recent = wheelDeltas.slice(-10).reduce((a, b) => a + b, 0) / Math.min(wheelDeltas.length, 10)
      const overall = wheelDeltas.reduce((a, b) => a + b, 0) / wheelDeltas.length
      const isFreshGesture = gap > WHEEL_FRESH_GESTURE_GAP_MS && px > 3
      if (!isFreshGesture && recent < overall) return
      wheelLocked = true
      setTimeout(
        () => {
          wheelLocked = false
        },
        isFreshGesture ? 250 : 600,
      )
      if (lightbox.isVisible()) return
      if (e.deltaY > 0) pagination.goNext()
      else pagination.goPrev()
    },
    { passive: false },
  )
}

function bindKeyboardNavigation(
  doc: Document,
  pagination: ReturnType<typeof createPagination>,
  lightbox: ReturnType<typeof createLightbox>,
  panels: ReturnType<typeof createPanelManager>,
  dict: ReturnType<typeof createDictionary>,
): void {
  doc.addEventListener('keydown', (e) => {
    const activeType = (doc.activeElement as HTMLInputElement)?.type
    if (activeType === 'radio' || activeType === 'checkbox') return
    if (lightbox.isVisible() && e.key !== 'Escape') return
    if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowUp') {
      e.preventDefault()
      pagination.goTo(0)
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'ArrowDown') {
      e.preventDefault()
      pagination.goTo(pagination.getTotal() - 1)
    } else if (e.key === ' ' && e.shiftKey) {
      e.preventDefault()
      pagination.goPrev()
    } else if (e.metaKey || e.ctrlKey || e.altKey) {
      return
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') {
      e.preventDefault()
      pagination.goNext()
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'PageUp') {
      e.preventDefault()
      pagination.goPrev()
    } else if (e.key === 'Home') {
      e.preventDefault()
      pagination.goTo(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      pagination.goTo(pagination.getTotal() - 1)
    } else if (e.key === 'Escape') {
      if (lightbox.isVisible()) lightbox.close()
      else if (dict.isVisible()) dict.close()
      else if (panels.typography.isOpen()) panels.typography.close()
      else if (panels.settings.isOpen()) panels.settings.close()
      else if (panels.theme.isOpen()) panels.theme.close()
      else if (panels.exporter.isOpen()) panels.exporter.close()
    }
  })
}

function bindNavigationButtons(
  btnPagePrev: HTMLButtonElement,
  btnPageNext: HTMLButtonElement,
  pagination: ReturnType<typeof createPagination>,
  lightbox: ReturnType<typeof createLightbox>,
): void {
  btnPagePrev.addEventListener('click', () => {
    if (!lightbox.isVisible()) pagination.goPrev()
  })
  btnPageNext.addEventListener('click', () => {
    if (!lightbox.isVisible()) pagination.goNext()
  })
}

function bindOutsideClickDismissal(doc: Document, dict: ReturnType<typeof createDictionary>): void {
  doc.addEventListener(
    'mousedown',
    (e) => {
      if (dict.isVisible() && !dict.popover.contains(e.target as Node)) dict.close()
    },
    { capture: true },
  )
}

function setupResizeObserver(
  wrapper: Element,
  measure: () => void,
  dict: ReturnType<typeof createDictionary>,
): void {
  let resizeTimer: ReturnType<typeof setTimeout>
  new ResizeObserver(() => {
    dict.close()
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(measure, 100)
  }).observe(wrapper)
}

function prepareContentForExport(
  container: HTMLElement,
  exportSrcMap: Map<string, string>,
  includeImages = true,
  includeLinks = false,
): string {
  const tmp = container.cloneNode(true) as HTMLElement

  tmp.querySelector('h1')?.remove()
  tmp.querySelector('[data-booklike-subtitle]')?.remove()
  tmp.querySelector('[data-booklike-byline]')?.remove()

  tmp.querySelectorAll('table[data-booklike-overflow]').forEach((t) => t.remove())
  tmp.querySelectorAll('.booklike-table-placeholder').forEach((p) => p.remove())
  tmp.querySelectorAll('table').forEach((t) => t.removeAttribute('data-booklike-table-width'))

  if (!includeLinks) {
    tmp.querySelectorAll('a').forEach((a) => a.replaceWith(...Array.from(a.childNodes)))
  }

  if (!includeImages) {
    tmp.querySelectorAll('figure, picture, img').forEach((el) => el.remove())
  } else {
    tmp.querySelectorAll('picture').forEach((picture) => {
      const img = picture.querySelector('img')
      if (!img) {
        picture.remove()
        return
      }
      img.removeAttribute('srcset')
      picture.replaceWith(img)
    })

    tmp.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      const exportSrc = exportSrcMap.get(img.src)
      if (exportSrc) img.src = exportSrc
      img.removeAttribute('srcset')
      img.removeAttribute('class')
      img.removeAttribute('style')
    })
  }

  return tmp.innerHTML
}

export async function launchReader(
  title: string,
  subtitle: string | null,
  author: string | null,
  byline: string | null,
  date: string | null,
  sourceUrl: string,
  content: string,
  lang: string,
  upgradeMap: Map<string, string[]>,
  exportSrcMap: Map<string, string>,
): Promise<void> {
  const { html, strippedCss, parsedFaces } = await loadTemplate()
  const fontBuffersPromise = loadFontBuffers(parsedFaces)

  const { iframe, doc } = await mountIframe(html, strippedCss)
  let resolvedFontFaces: { buffer: ArrayBuffer; descriptor: ParsedFontFace }[] = []
  void fontBuffersPromise.then((faces) => {
    resolvedFontFaces = faces
    for (const { buffer, descriptor: d } of faces) {
      doc.fonts.add(
        new FontFace(d.family, buffer, { weight: d.weight, style: d.style, unicodeRange: d.unicodeRange }),
      )
    }
  })
  const { contentWindow } = iframe
  if (!contentWindow) throw new Error('iframe contentWindow unavailable')

  const container = doc.getElementById('contentContainer')!
  populateContent(doc, container, title, subtitle, byline, content, lang)
  doc.title = title

  const display = doc.getElementById('display')!
  const wrapper = doc.getElementById('contentWrapper')!
  const pageNum = doc.getElementById('pageNum')!
  const pageTitle = doc.getElementById('pageTitle')!
  pageTitle.textContent = title
  const menu = doc.getElementById('menu')!
  const collapseIcon = doc.getElementById('collapseIcon')!
  const collapsable = doc.getElementById('collapsable')!
  const menuBg = doc.getElementById('menuBg')!
  const btnPagePrev = doc.querySelector<HTMLButtonElement>('#btnPagePrev')!
  const btnPageNext = doc.querySelector<HTMLButtonElement>('#btnPageNext')!
  const bezel = doc.getElementById('bezel')!
  const pageIndicator = doc.getElementById('pageIndicator')!
  const typographyPanel = doc.getElementById('typographyPanel')!
  const settingsPanel = doc.getElementById('settingsPanel')!
  const themePanel = doc.getElementById('themePanel')!
  const btnTypography = doc.getElementById('btnTypography')!
  const btnSettings = doc.getElementById('btnSettings')!
  const btnThemeToggle = doc.getElementById('btnThemeToggle')!
  const btnExport = doc.getElementById('btnExport')!
  const exportPanel = doc.getElementById('exportPanel')!
  const btnCollapse = doc.getElementById('btnCollapse')!
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)')

  const state: ReaderSettings = { ...defaults }
  const pagination = createPagination({
    container,
    wrapper,
    iframe,
    pageNum,
    btnPagePrev,
    btnPageNext,
    onClosePopover: () => dict.close(),
  })
  const updatePrintHeight = () => {
    document.documentElement.style.setProperty(
      '--booklike-content-height',
      pagination.getPrintHeight() + 'px',
    )
  }
  const measurePreservingAnchor = () => {
    const anchor = pagination.getCachedAnchor()
    pagination.measure(() => {
      pagination.restoreAnchor(anchor)
      updatePrintHeight()
    })
  }
  const ctx: DisplayCtx = {
    doc,
    iframe,
    state,
    display,
    container,
    wrapper,
    bezel,
    pageIndicator,
    prefersDark,
    measure: measurePreservingAnchor,
  }
  const dict = createDictionary({ doc, iframe, lang })
  const lightbox = createLightbox({ doc, iframe, container })
  const panels = createPanelManager({
    doc,
    iframe,
    menu,
    collapsable,
    collapseIcon,
    menuBg,
    typographyPanel,
    settingsPanel,
    themePanel,
    exportPanel,
    btnTypography,
    btnSettings,
    btnThemeToggle,
    btnExport,
    btnCollapse,
    onClosePopover: () => dict.close(),
  })

  await loadSettings(state)
  syncSettingsUI(doc, state)
  bindSettingsControls(doc, state, ctx, measurePreservingAnchor, dict, settingsPanel, themePanel)

  bindWheelNavigation(doc, pagination, lightbox)
  bindKeyboardNavigation(doc, pagination, lightbox, panels, dict)
  bindNavigationButtons(btnPagePrev, btnPageNext, pagination, lightbox)
  bindOutsideClickDismissal(doc, dict)

  dict.setEnabled(state.dictionary)
  applyAll(ctx)
  await awaitFirstImage(container)
  const firstImg = container.querySelector<HTMLImageElement>('img')
  if (firstImg && firstImg.naturalWidth > 0 && firstImg.naturalHeight > 0) {
    firstImg.setAttribute('width', String(firstImg.naturalWidth))
    firstImg.setAttribute('height', String(firstImg.naturalHeight))
  }
  wrapper.style.visibility = 'hidden'
  iframe.style.visibility = ''
  clearPage(title, iframe)
  const printStyle = document.createElement('style')
  printStyle.textContent =
    '@media print{#booklike-reader{display:none!important;}#booklike-print-copy{display:block!important;}}'
  document.head.appendChild(printStyle)
  const iframePrintStyle = doc.createElement('style')
  iframePrintStyle.textContent = '@media print{#display *{color:black!important}}'
  doc.head.appendChild(iframePrintStyle)

  function buildPrintCopy(): void {
    document.getElementById('booklike-print-copy')?.remove()
    document.getElementById('booklike-print-css')?.remove()

    const cssEl = document.createElement('style')
    cssEl.id = 'booklike-print-css'
    cssEl.textContent =
      strippedCss +
      '#booklike-print-copy *{color:black!important}' +
      '#booklike-print-copy figure,#booklike-print-copy img,#booklike-print-copy pre,' +
      '#booklike-print-copy table,#booklike-print-copy blockquote{break-inside:avoid}' +
      '#booklike-print-copy h1,#booklike-print-copy h2,#booklike-print-copy h3,' +
      '#booklike-print-copy h4,#booklike-print-copy h5,#booklike-print-copy h6{break-after:avoid}' +
      '#booklike-print-copy p{widows:3;orphans:3}'
    document.head.appendChild(cssEl)

    for (const { buffer, descriptor: d } of resolvedFontFaces) {
      try {
        document.fonts.add(
          new FontFace(d.family, buffer, { weight: d.weight, style: d.style, unicodeRange: d.unicodeRange }),
        )
      } catch {}
    }

    const copy = document.createElement('div')
    copy.id = 'booklike-print-copy'
    copy.className = display.className
    copy.style.display = 'none'
    copy.innerHTML = container.innerHTML

    if (!state.showImages) {
      copy.querySelectorAll<HTMLElement>('figure, img').forEach((el) => el.classList.add('hidden'))
    }

    document.body.appendChild(copy)
  }

  function cleanupPrintCopy(): void {
    document.getElementById('booklike-print-copy')?.remove()
    document.getElementById('booklike-print-css')?.remove()
  }

  let isPrinting = false
  window.addEventListener('beforeprint', () => {
    isPrinting = true
    buildPrintCopy()
  })
  window.addEventListener('afterprint', () => {
    isPrinting = false
    cleanupPrintCopy()
  })

  pagination.measure(() => {
    pagination.goTo(0)
    wrapper.style.visibility = ''
    updatePrintHeight()
  })
  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => a.setAttribute('tabindex', '-1'))
  setupResizeObserver(wrapper, measurePreservingAnchor, dict)
  setupImageMeasuring(container, pagination.measure)
  setupHiResUpgrades(container, upgradeMap)

  function triggerPrint() {
    let printFired = false
    window.addEventListener(
      'beforeprint',
      () => {
        printFired = true
      },
      { once: true },
    )
    window.parent.postMessage({ type: 'booklike-print' }, window.location.origin)
    setTimeout(() => {
      if (printFired) return
      const isMac = /Mac|iPhone|iPad/.test(navigator.userAgent)
      const toast = doc.createElement('div')
      toast.className =
        'fixed bottom-6 left-1/2 -translate-x-1/2 rounded-xl bg-black/90 px-4 py-2.5 font-sans text-sm text-white shadow-xl z-[9999] pointer-events-none'
      toast.textContent = `Press ${isMac ? '⌘P' : 'Ctrl+P'} to print`
      doc.body.appendChild(toast)
      setTimeout(() => toast.remove(), PRINT_TOAST_DURATION_MS)
    }, PRINT_SANDBOX_DETECT_MS)
  }

  doc.getElementById('btnPrint')?.addEventListener('click', () => {
    panels.exporter.close()
    triggerPrint()
  })

  const btnDownloadEpub = doc.getElementById('btnDownloadEpub') as HTMLButtonElement | null
  const epubIcon = doc.getElementById('epubIcon')!
  const epubSpinner = doc.getElementById('epubSpinner')!
  const epubLabel = doc.getElementById('epubLabel')!
  const epubImagesRow = doc.getElementById('epubImagesRow')!
  const epubIncludeImages = doc.getElementById('epubIncludeImages') as HTMLInputElement
  const epubQuota = doc.getElementById('epubQuota')!
  const epubImagesTooMany = doc.getElementById('epubImagesTooMany')!
  const epubLinksRow = doc.getElementById('epubLinksRow')!
  const epubIncludeLinks = doc.getElementById('epubIncludeLinks') as HTMLInputElement

  interface EpubImageQuota {
    count: number
    month: string
  }
  const QUOTA_KEY = 'booklike-epub-image-quota'
  let imageQuota: EpubImageQuota = { count: 0, month: new Date().toISOString().slice(0, 7) }

  function getResetDate(): string {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() + 1, 1).toLocaleDateString('en', {
      month: 'long',
      day: 'numeric',
    })
  }

  function updateEpubImagesUI(): void {
    const currentMonth = new Date().toISOString().slice(0, 7)
    const count = imageQuota.month === currentMonth ? imageQuota.count : 0
    const remaining = EPUB_IMAGE_QUOTA_MONTHLY - count
    const limited = remaining <= 0
    epubIncludeImages.disabled = limited
    if (limited) epubIncludeImages.checked = false
    const unlimited = '<br>Text-only EPUBs are unlimited.'
    if (limited) {
      epubQuota.innerHTML = `Limit reached · Resets ${getResetDate()}.${unlimited}`
      epubQuota.classList.remove('hidden')
    } else if (count >= EPUB_IMAGE_QUOTA_WARN_AT) {
      epubQuota.innerHTML = `${remaining} remaining this month.${unlimited}`
      epubQuota.classList.remove('hidden')
    } else {
      epubQuota.classList.add('hidden')
    }
  }

  function setEpubImagesRowVisible(visible: boolean): void {
    epubImagesRow.classList.toggle('flex', visible)
    epubImagesRow.classList.toggle('hidden', !visible)
    if (!visible) {
      epubQuota.classList.add('hidden')
      epubImagesTooMany.classList.add('hidden')
    } else if (tooManyImagesForEpub) {
      epubIncludeImages.disabled = true
      epubIncludeImages.checked = false
      epubImagesTooMany.classList.remove('hidden')
      epubQuota.classList.add('hidden')
    } else {
      epubIncludeImages.disabled = false
      epubIncludeImages.checked = state.epubImages
      epubImagesTooMany.classList.add('hidden')
      updateEpubImagesUI()
    }
  }

  const articleImageCount = container.querySelectorAll('img').length
  const articleHasImages = articleImageCount > 0
  const tooManyImagesForEpub = articleImageCount > EPUB_MAX_ARTICLE_IMAGES
  bindToggle(doc, 'images', (checked) => {
    if (articleHasImages) setEpubImagesRowVisible(checked)
  })

  epubIncludeImages.checked = state.epubImages
  setEpubImagesRowVisible(articleHasImages && state.showImages)
  chrome.storage.local.get(QUOTA_KEY, (result) => {
    const stored = result[QUOTA_KEY] as EpubImageQuota | undefined
    if (stored) imageQuota = stored
    if (articleHasImages && !tooManyImagesForEpub && state.showImages) updateEpubImagesUI()
  })

  epubIncludeImages.addEventListener('change', () => {
    state.epubImages = epubIncludeImages.checked
    saveSettings(state)
  })

  const articleHasLinks = container.querySelector('a[href]') !== null

  function setEpubLinksRowVisible(linksEnabled: boolean): void {
    const visible = linksEnabled && articleHasLinks
    epubLinksRow.classList.toggle('flex', visible)
    epubLinksRow.classList.toggle('hidden', !visible)
  }

  epubIncludeLinks.checked = state.epubLinks
  setEpubLinksRowVisible(state.preserveLinks)
  bindToggle(doc, 'links', (checked) => setEpubLinksRowVisible(checked))

  epubIncludeLinks.addEventListener('change', () => {
    state.epubLinks = epubIncludeLinks.checked
    saveSettings(state)
  })

  function setEpubState(s: 'idle' | 'loading' | 'error'): void {
    const loading = s === 'loading'
    if (btnDownloadEpub) btnDownloadEpub.style.minWidth = loading ? btnDownloadEpub.offsetWidth + 'px' : ''
    if (btnDownloadEpub) btnDownloadEpub.disabled = loading
    epubIcon.classList.toggle('hidden', loading)
    epubSpinner.classList.toggle('hidden', !loading)
    epubLabel.textContent =
      s === 'loading' ? 'Generating…' : s === 'error' ? 'Something went wrong' : 'Download EPUB'
    if (s === 'error') setTimeout(() => setEpubState('idle'), 4000)
  }

  btnDownloadEpub?.addEventListener('click', () => {
    const includeImages = state.showImages && epubIncludeImages.checked && !tooManyImagesForEpub
    const includeLinks = state.preserveLinks && epubIncludeLinks.checked
    const exportContent = prepareContentForExport(container, exportSrcMap, includeImages, includeLinks)
    setEpubState('loading')
    const filename =
      title
        .replace(/[:/\\|?*"<>]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80) + '.epub'
    void (async () => {
      try {
        let imageMap: Map<string, EpubImage> | undefined
        if (includeImages) {
          const res = (await chrome.runtime.sendMessage({
            type: 'booklike-fetch-epub-images',
            content: exportContent,
          })) as { ok: true; images: Record<string, { data: number[]; mime: string }> } | { ok: false }
          if (!res.ok) {
            setEpubState('error')
            return
          }
          imageMap = new Map(
            Object.entries(res.images).map(([url, img]) => [
              url,
              { data: new Uint8Array(img.data), mime: img.mime },
            ]),
          )
        }
        const bytes = buildEpub({ title, author, date, sourceUrl, lang, content: exportContent }, imageMap)
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/epub+zip' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = filename
        a.click()
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
        if (includeImages) {
          const month = new Date().toISOString().slice(0, 7)
          imageQuota = { count: (imageQuota.month === month ? imageQuota.count : 0) + 1, month }
          void chrome.storage.local.set({ [QUOTA_KEY]: imageQuota })
          updateEpubImagesUI()
        }
        setEpubState('idle')
        panels.exporter.close()
      } catch {
        setEpubState('error')
      }
    })()
  })

  prefersDark.addEventListener('change', () => {
    if (state.theme === 'auto' && !isPrinting) applyTheme(ctx)
  })

  iframe.focus()
  contentWindow.focus()
}
