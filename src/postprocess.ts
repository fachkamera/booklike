import { stampContentWrappers, SECTION_STAMP } from './helpers'
import {
  REDUNDANT_HEADING_OVERLAP_THRESHOLD,
  VARIANT_HEADING_OVERLAP_THRESHOLD,
  EDGE_COMPARISON_CHARS,
  LEADING_PARA_CHECK_LIMIT,
  OVERLAP_WORD_LENGTH_THRESHOLD,
  META_TEXT_MAX_CHARS,
  SINGLE_LINK_PARA_MAX_NONLINK_CHARS,
  DEDUP_ATTRIBUTION_MAX_CHARS,
} from './config'

export function postprocess(node: Element): void {
  stampContentWrappers(node)
  replaceBITags(node)
  upgradeTypographicStamps(node)
  unwrapSingleBlockLiChildren(node)
  removeEmptyParagraphs(node)
  removeEmptyLists(node)
  removeDateOnlyBlocks(node)
  removeSingleLinkParagraphs(node)
  removeNamedAnchors(node)
  unwrapUnderlineInLinks(node)
  unwrapFigureSpans(node)
  flattenFigcaptions(node)
  removeImageTitles(node)
  removeHeadingOnlySections(node)
  promoteHeadings(node)
  flattenBlocksInHeadings(node)
  unwrapStrongInHeadings(node)
  unwrapBareSpans(node)
  unwrapGratuitousDivs(node)
  wrapOrphanedFigureCaptions(node)
  removeImagelessFigures(node)
  stripArbitraryAttributes(node)
  stripJavascriptHrefs(node)
  unwrapContainers(node)
  removeConsecutiveDuplicates(node)
  removeEmptyParagraphs(node)
  stampSmallOnlyParagraphs(node)
}

export function removeRedundantHeading(
  node: Element,
  title: string,
  subtitle?: string | null,
  author?: string | null,
): void {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim()
  const shareEdge = (a: string, b: string) => {
    const na = normalize(a),
      nb = normalize(b)
    if (na.length < EDGE_COMPARISON_CHARS || nb.length < EDGE_COMPARISON_CHARS) return false
    return (
      na.slice(0, EDGE_COMPARISON_CHARS) === nb.slice(0, EDGE_COMPARISON_CHARS) ||
      na.slice(-EDGE_COMPARISON_CHARS) === nb.slice(-EDGE_COMPARISON_CHARS)
    )
  }

  const firstPara = node.querySelector('p')
  const leadingHeadings = Array.from(node.querySelectorAll('h1, h2, h3')).filter(
    (h) => !firstPara || !!(firstPara.compareDocumentPosition(h) & Node.DOCUMENT_POSITION_PRECEDING),
  )
  const removed: Element[] = []
  for (const h of leadingHeadings) {
    const text = h.textContent ?? ''
    if (wordOverlap(text, title) >= REDUNDANT_HEADING_OVERLAP_THRESHOLD || shareEdge(text, title)) {
      h.remove()
      removed.push(h)
      continue
    }
    if (author && normalize(text) === normalize(author)) {
      h.remove()
      removed.push(h)
      continue
    }
    if (
      removed.some(
        (r) =>
          wordOverlap(text, r.textContent ?? '') >= VARIANT_HEADING_OVERLAP_THRESHOLD ||
          shareEdge(text, r.textContent ?? ''),
      )
    ) {
      h.remove()
      removed.push(h)
    }
  }

  if (author) {
    const na = normalize(author)
    node.querySelectorAll('p').forEach((p) => {
      if (p.querySelector('img, figure, a')) return
      const text = normalize(p.textContent ?? '').replace(/^by\s+/, '')
      if (text === na) p.remove()
    })
  }

  const leadingParas = Array.from(node.querySelectorAll('p')).slice(0, LEADING_PARA_CHECK_LIMIT)
  for (const p of leadingParas) {
    if (p.querySelector('img, figure, a')) break
    const text = p.textContent?.trim() ?? ''
    if (!text) continue
    if (wordOverlap(text, title) >= REDUNDANT_HEADING_OVERLAP_THRESHOLD || shareEdge(text, title)) {
      p.remove()
      continue
    }
    if (
      subtitle &&
      (wordOverlap(text, subtitle) >= REDUNDANT_HEADING_OVERLAP_THRESHOLD || shareEdge(text, subtitle))
    ) {
      p.remove()
      continue
    }
    break
  }
}

function wordOverlap(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length > OVERLAP_WORD_LENGTH_THRESHOLD),
    )
  const wa = words(a)
  const wb = words(b)
  if (wa.size === 0 || wb.size === 0) return 0
  const [smaller, larger] = wa.size <= wb.size ? [wa, wb] : [wb, wa]
  let matches = 0
  for (const w of smaller) if (larger.has(w)) matches++
  return matches / smaller.size
}

function replaceBITags(node: Element): void {
  node.querySelectorAll('b').forEach((b) => {
    const strong = b.ownerDocument.createElement('strong')
    strong.append(...Array.from(b.childNodes))
    b.replaceWith(strong)
  })
  node.querySelectorAll('i').forEach((i) => {
    const em = i.ownerDocument.createElement('em')
    em.append(...Array.from(i.childNodes))
    i.replaceWith(em)
  })
}

function upgradeTypographicStamps(node: Element): void {
  node.querySelectorAll<Element>('[data-booklike-bold], [data-booklike-italic]').forEach((el) => {
    const bold = el.hasAttribute('data-booklike-bold')
    const italic = el.hasAttribute('data-booklike-italic')
    el.removeAttribute('data-booklike-bold')
    el.removeAttribute('data-booklike-italic')
    const doc = el.ownerDocument
    const children = Array.from(el.childNodes)
    let wrapper: Element
    if (bold && italic) {
      const em = doc.createElement('em')
      em.append(...children)
      wrapper = doc.createElement('strong')
      wrapper.append(em)
    } else if (bold) {
      wrapper = doc.createElement('strong')
      wrapper.append(...children)
    } else {
      wrapper = doc.createElement('em')
      wrapper.append(...children)
    }
    el.append(wrapper)
  })
}

function stripJavascriptHrefs(node: Element): void {
  node.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((a) => {
    if (/^\s*javascript:/i.test(a.getAttribute('href') ?? '')) a.removeAttribute('href')
  })
}

const ALLOWED_ATTRS: Partial<Record<string, string[]>> = {
  a: ['href'],
  img: ['src', 'alt', 'width', 'height'],
  time: ['datetime'],
  ol: ['start', 'reversed', 'type'],
  ul: ['value'],
  td: ['colspan', 'rowspan'],
  th: ['colspan', 'rowspan', 'scope'],
}
const ALLOWED_GLOBAL = new Set(['lang', 'dir'])

function stripArbitraryAttributes(node: Element): void {
  node.querySelectorAll('*').forEach((el) => {
    const allowed = ALLOWED_ATTRS[el.tagName.toLowerCase()]
    Array.from(el.attributes).forEach((attr) => {
      if (!ALLOWED_GLOBAL.has(attr.name) && !allowed?.includes(attr.name)) {
        el.removeAttribute(attr.name)
      }
    })
  })
}

const MEANINGFUL_ATTRS = ['href', 'src', 'alt', 'lang', 'dir', SECTION_STAMP]

function isBareWrapper(el: Element): boolean {
  return !MEANINGFUL_ATTRS.some((a) => el.hasAttribute(a))
}

function promoteHeadings(node: Element): void {
  if (node.querySelector('h2')) return
  if (!node.querySelector('h3')) return
  node.querySelectorAll('h3, h4, h5, h6').forEach((h) => {
    const level = parseInt(h.tagName[1])
    const promoted = node.ownerDocument.createElement(`h${level - 1}`)
    promoted.append(...Array.from(h.childNodes))
    h.replaceWith(promoted)
  })
}

function flattenBlocksInHeadings(node: Element): void {
  node.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    if (!h.querySelector('p, div')) return
    const text = (h.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (!text) return
    h.textContent = text
  })
}

function unwrapStrongInHeadings(node: Element): void {
  node.querySelectorAll('h1 strong, h2 strong, h3 strong, h4 strong, h5 strong, h6 strong').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes))
  })
}

function unwrapBareSpans(node: Element): void {
  let found: NodeListOf<Element>
  while ((found = node.querySelectorAll('span')).length > 0) {
    let changed = false
    found.forEach((el) => {
      if (!isBareWrapper(el)) return
      const nodes = Array.from(el.childNodes)
      const prev = el.previousSibling
      if (prev && nodes.length > 0) {
        const prevTail = (prev.textContent ?? '').slice(-1)
        const spanHead = (nodes[0].textContent ?? '').charAt(0)
        if (
          prevTail &&
          !/\s/.test(prevTail) &&
          spanHead &&
          !/\s/.test(spanHead) &&
          !/^[.,;:!?)\]'"»›]/.test(spanHead)
        ) {
          nodes.unshift(el.ownerDocument.createTextNode(' '))
        }
      }
      el.replaceWith(...nodes)
      changed = true
    })
    if (!changed) break
  }
}

function unwrapGratuitousDivs(node: Element): void {
  let found: NodeListOf<Element>
  while ((found = node.querySelectorAll('div, main, section')).length > 0) {
    let changed = false
    found.forEach((el) => {
      if (!isBareWrapper(el)) return
      el.replaceWith(...Array.from(el.childNodes))
      changed = true
    })
    if (!changed) break
  }
}

function removeHeadingOnlySections(node: Element): void {
  node.querySelectorAll(`div[${SECTION_STAMP}], section[${SECTION_STAMP}]`).forEach((el) => {
    const children = Array.from(el.children)
    const hasHeading = children.some((c) => /^H[1-6]$/.test(c.tagName))
    if (!hasHeading) {
      el.removeAttribute(SECTION_STAMP)
      return
    }
    const hasNonHeadingContent = Array.from(el.childNodes).some((childNode) => {
      if (childNode.nodeType === Node.TEXT_NODE) return !!childNode.textContent?.trim()
      if (childNode instanceof Element) return !/^H[1-6]$/.test(childNode.tagName)
      return false
    })
    if (!hasNonHeadingContent) {
      el.removeAttribute(SECTION_STAMP)
      el.remove()
    }
  })
}

function unwrapSingleBlockLiChildren(node: Element): void {
  node.querySelectorAll('li').forEach((li) => {
    const elements = Array.from(li.children)
    if (elements.length !== 1) return
    if (!['P', 'DIV'].includes(elements[0].tagName)) return
    elements[0].replaceWith(...Array.from(elements[0].childNodes))
  })
}
function removeNamedAnchors(node: Element): void {
  node.querySelectorAll('a[name]:not([href])').forEach((a) => {
    if (!a.textContent?.trim()) a.remove()
    else a.replaceWith(...Array.from(a.childNodes))
  })
}

const FIGCAPTION_INLINE_TAGS = new Set([
  'A',
  'ABBR',
  'B',
  'CITE',
  'CODE',
  'EM',
  'I',
  'S',
  'SMALL',
  'SPAN',
  'STRONG',
  'SUB',
  'SUP',
  'TIME',
  'U',
])

function flattenFigcaptions(node: Element): void {
  node.querySelectorAll('figcaption').forEach((fc) => {
    const children = Array.from(fc.querySelectorAll(':scope > *'))
    children.forEach((block, i) => {
      const isBlock = !FIGCAPTION_INLINE_TAGS.has(block.tagName) || block.hasAttribute('data-booklike-block')
      block.removeAttribute('data-booklike-block')
      if (i > 0 && isBlock && children[i - 1].textContent?.trim())
        block.before(node.ownerDocument.createElement('br'))
    })
  })
  node.querySelectorAll('figcaption p, figcaption div, figcaption span, figcaption small').forEach((el) => {
    el.replaceWith(...Array.from(el.childNodes))
  })
  node.querySelectorAll('figcaption').forEach((fc) => {
    fc.childNodes.forEach((n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        n.textContent = (n.textContent ?? '').replace(/\s+/g, ' ')
      }
    })
    fc.querySelectorAll('br').forEach((br) => {
      const prev = br.previousSibling
      const next = br.nextSibling
      if (prev?.nodeType === Node.TEXT_NODE) prev.textContent = (prev.textContent ?? '').trimEnd()
      if (next?.nodeType === Node.TEXT_NODE) next.textContent = (next.textContent ?? '').trimStart()
    })
    const first = fc.firstChild
    const last = fc.lastChild
    if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent?.trimStart() ?? ''
    if (last?.nodeType === Node.TEXT_NODE) last.textContent = last.textContent?.trimEnd() ?? ''

    const isMeaningless = (text: string) => /^[|/\\·•\-–—,;:!?()[\]{}"'`~@#$%^&*+=<>]+$/.test(text.trim())
    fc.querySelectorAll('br').forEach((br) => {
      const prev = br.previousSibling
      const next = br.nextSibling
      const prevText = prev?.nodeType === Node.TEXT_NODE ? (prev.textContent ?? '') : ''
      const nextText = next?.nodeType === Node.TEXT_NODE ? (next.textContent ?? '') : ''
      if (isMeaningless(prevText)) {
        prev!.remove()
        br.remove()
      } else if (isMeaningless(nextText)) {
        next!.remove()
        br.remove()
      }
    })
  })
}

function wrapOrphanedFigureCaptions(node: Element): void {
  node.querySelectorAll('figure').forEach((fig) => {
    const searchRoot = fig.querySelector(':scope > a') ?? fig
    const textNodes = Array.from(searchRoot.childNodes).filter(
      (n): n is Text => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim(),
    )
    if (!textNodes.length) return
    const text = textNodes
      .map((n) => n.textContent ?? '')
      .join('')
      .replace(/\s+/g, ' ')
      .trim()
    textNodes.forEach((n) => n.remove())
    const fc = fig.querySelector('figcaption')
    if (fc) {
      fc.appendChild(node.ownerDocument.createElement('br'))
      fc.appendChild(node.ownerDocument.createTextNode(text))
    } else {
      const newFc = node.ownerDocument.createElement('figcaption')
      newFc.textContent = text
      fig.appendChild(newFc)
    }
  })
}
function removeImagelessFigures(node: Element): void {
  node.querySelectorAll('figure').forEach((fig) => {
    if (!fig.querySelector('img, picture')) fig.remove()
  })
}

function removeImageTitles(node: Element): void {
  node.querySelectorAll('img').forEach((img) => img.removeAttribute('title'))
}

const DATE_ONLY =
  /^\s*(?:updated?\s*:?\s+|published\s+(?:on\s+)?|modified\s*:?\s+|last\s+updated?\s*:?\s+)?(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}|\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2},?\s+\d{2,4}|\d{1,2}\.?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{2,4})(?:(?:\s*,\s*|\s+at\s+|\s+)\d{1,2}:\d{2}(?:\s*[ap]\.?m\.?)?\s*[a-z]*)?\s*$/i
const READ_TIME = /^\s*(?:\w+(?:\s+\w+){0,3}[:\s]+)?\d+\s*[-–]?\s*min\w*(?:\s+\w+(?:\s+\w+)?)?\s*\.?\s*$/i
const DATE_LOOSE = /\b\d{1,2}[./]\d{1,2}[./]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/

function isMetaText(text: string): boolean {
  if (text.length === 0) return false
  if (DATE_ONLY.test(text)) return true
  if (READ_TIME.test(text)) return true
  if (text.length < META_TEXT_MAX_CHARS && DATE_LOOSE.test(text)) return true
  return false
}

function removeDateOnlyBlocks(node: Element): void {
  node.querySelectorAll('p, div, span').forEach((el) => {
    if (el.children.length > 0) return
    const text = el.textContent?.replace(/\u00A0/g, ' ').trim() ?? ''
    if (isMetaText(text)) el.remove()
  })
  node.querySelectorAll('p, div').forEach((el) => {
    if (el.children.length === 0 && (el.textContent ?? '').trim() === '') el.remove()
  })
  node.querySelectorAll('p > time:only-child').forEach((time) => time.parentElement?.remove())
}

function unwrapUnderlineInLinks(node: Element): void {
  node.querySelectorAll('a u').forEach((u) => u.replaceWith(...Array.from(u.childNodes)))
}

function unwrapFigureSpans(node: Element): void {
  let found: NodeListOf<Element>
  while ((found = node.querySelectorAll('figure span, picture span')).length > 0) {
    let changed = false
    found.forEach((el) => {
      if (el.closest('figcaption')) return
      el.replaceWith(...Array.from(el.childNodes))
      changed = true
    })
    if (!changed) break
  }
}

function removeSingleLinkParagraphs(node: Element): void {
  node.querySelectorAll('p').forEach((p) => {
    const links = p.querySelectorAll('a')
    if (links.length !== 1) return
    const nonLinkLength = (p.textContent?.length ?? 0) - (links[0].textContent?.length ?? 0)
    if (nonLinkLength <= SINGLE_LINK_PARA_MAX_NONLINK_CHARS) p.remove()
  })
}

function unwrapContainers(node: Element): void {
  node.querySelectorAll('section, article, aside, header, footer').forEach((el) => {
    Array.from(el.childNodes).forEach((child) => {
      if (child.nodeType === Node.TEXT_NODE && child.textContent?.trim()) {
        const p = el.ownerDocument.createElement('p')
        p.textContent = child.textContent
        el.replaceChild(p, child)
      }
    })
    el.replaceWith(...Array.from(el.childNodes))
  })
}

const normalizeWS = (s: string) => s.replace(/[\u00A0\s]+/g, ' ').trim()

function removeConsecutiveDuplicates(node: Element): void {
  node.querySelectorAll('p, h1, h2, h3, h4, h5, h6').forEach((el) => {
    const text = normalizeWS(el.textContent ?? '')
    if (!text) return
    const next = el.nextElementSibling
    if (next?.tagName === el.tagName && normalizeWS(next.textContent ?? '') === text) next.remove()
  })

  const seen = new Set<string>()
  node.querySelectorAll('p').forEach((p) => {
    if (!p.parentElement) return
    const text = normalizeWS(p.textContent ?? '')
    if (!text || text.length > DEDUP_ATTRIBUTION_MAX_CHARS) return
    if (seen.has(text)) p.remove()
    else seen.add(text)
  })
}

const STUB_TEXT = /^(\[edit\]|updated?|and|by|on|[-–—|]+)$/i
function removeEmptyParagraphs(node: Element): void {
  node.querySelectorAll('p').forEach((p) => {
    if (p.querySelector('img, picture')) return
    const text = p.textContent?.replace(/\u00A0/g, ' ').trim() ?? ''
    if (text === '' || STUB_TEXT.test(text) || !/\p{L}/u.test(text)) {
      p.remove()
      return
    }
    if (p === node.querySelector('p') && !/\s/.test(text)) p.remove()
  })
  node.querySelectorAll('h1, h2, h3, h4, h5, h6').forEach((h) => {
    const text = h.textContent?.replace(/\u00A0/g, ' ').trim() ?? ''
    if (text === '' || STUB_TEXT.test(text)) h.remove()
  })
  node.querySelectorAll('li').forEach((li) => {
    if (!li.textContent?.replace(/\u00A0/g, ' ').trim()) li.remove()
  })
}
function stampSmallOnlyParagraphs(node: Element): void {
  node.querySelectorAll('p').forEach((p) => {
    const elements = Array.from(p.children)
    if (elements.length !== 1 || elements[0].tagName !== 'SMALL') return
    const hasTextOutside = Array.from(p.childNodes).some(
      (n) => n.nodeType === Node.TEXT_NODE && !!n.textContent?.trim(),
    )
    if (!hasTextOutside) p.setAttribute('data-booklike-small', '')
  })
}

function removeEmptyLists(node: Element): void {
  node.querySelectorAll('ul, ol').forEach((list) => {
    const hasContent = Array.from(list.querySelectorAll('li')).some((li) =>
      li.textContent?.replace(/\u00A0/g, ' ').trim(),
    )
    if (!hasContent) list.remove()
  })
}
