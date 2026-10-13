export const CONTENT_BLOCKS = new Set(['P', 'FIGURE', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE'])

export const READ_TIME =
  /^\s*(?:\w+(?:\s+\w+){0,3}[:\s]+)?\d+\s*[-–]?\s*min\w*(?:\s+\w+(?:\s+\w+)?)?\s*\.?\s*$/i

export const getEmail = () => 'hello' + '@' + 'booklike.app'
export const SECTION_STAMP = 'data-booklike-section'

export function stampContentWrappers(node: Element): void {
  node.querySelectorAll('div, section').forEach((el) => {
    const children = Array.from(el.children)
    const hasHeading = children.some((c) => /^H[1-6]$/.test(c.tagName))
    const hasContent = children.some((c) => CONTENT_BLOCKS.has(c.tagName))
    if (hasHeading && hasContent) el.setAttribute(SECTION_STAMP, '')
  })
}

export function getArticleRoot(doc: Document): Element | null {
  return (
    doc.querySelector('article') ??
    doc.querySelector('#article') ??
    doc.querySelector('main .article-content') ??
    doc.querySelector('.article-content') ??
    doc.querySelector('main') ??
    doc.querySelector('[role="main"]') ??
    doc.querySelector('.main')
  )
}

export const READER_IFRAME_CSS =
  'position:fixed;inset:0;width:100%;height:100%;border:none;z-index:2147483647;'

export const READER_IFRAME_GUARD_CSS = `#booklike-reader{${READER_IFRAME_CSS.split(';')
  .filter(Boolean)
  .map((declaration) => declaration + '!important')
  .join(';')}}`

export function guardIframeStyle(iframe: HTMLIFrameElement): void {
  const style = document.createElement('style')
  style.textContent = READER_IFRAME_GUARD_CSS
  document.head.appendChild(style)
  const baseline = iframe.style.cssText
  new MutationObserver(() => {
    if (iframe.style.cssText === baseline) return
    iframe.style.cssText = baseline
  }).observe(iframe, { attributeFilter: ['style'] })
}
