export const CONTENT_BLOCKS = new Set(['P', 'FIGURE', 'UL', 'OL', 'BLOCKQUOTE', 'TABLE'])

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
