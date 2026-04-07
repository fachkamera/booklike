import type { SiteRule } from './siteRules'
import { getArticleRoot } from './helpers'

function parseSrcsetEntries(srcset: string): Array<{ url: string; w: number }> {
  if (!srcset.trim()) return []
  return srcset
    .split(/,\s+/)
    .map((part) => {
      const tokens = part.trim().split(/\s+/)
      return { url: tokens[0] ?? '', w: parseFloat(tokens[1]) || 0 }
    })
    .filter((e) => e.url)
}

export function replacePicturesWithImgs(doc: Document): Map<string, string[]> {
  const upgradeMap = new Map<string, string[]>()

  doc.querySelectorAll('picture').forEach((picture) => {
    const img = picture.querySelector<HTMLImageElement>('img')
    if (!img) {
      picture.remove()
      return
    }

    const currentSrc = img.dataset.booklikeSrc ?? img.getAttribute('src') ?? ''
    const sources = Array.from(picture.querySelectorAll<HTMLSourceElement>('source'))

    if (sources.length > 0) {
      const containingSource = sources.find((s) =>
        parseSrcsetEntries(s.getAttribute('srcset') ?? '').some((e) => e.url === currentSrc),
      )
      if (containingSource) {
        const upgrades = parseSrcsetEntries(containingSource.getAttribute('srcset') ?? '')
          .filter((e) => e.url !== currentSrc && e.w > 0)
          .sort((a, b) => b.w - a.w)
          .map((e) => e.url)
        if (upgrades.length) upgradeMap.set(currentSrc, upgrades)
      }
    }

    const newImg = doc.createElement('img')
    newImg.src = (currentSrc || img.getAttribute('src')) ?? ''
    if (img.alt) newImg.alt = img.alt
    const width = img.getAttribute('width')
    const height = img.getAttribute('height')
    if (width) newImg.setAttribute('width', width)
    if (height) newImg.setAttribute('height', height)
    if (img.dataset.booklikeW) newImg.dataset.booklikeW = img.dataset.booklikeW
    if (img.dataset.booklikeH) newImg.dataset.booklikeH = img.dataset.booklikeH
    if (img.dataset.booklikeSrc) newImg.dataset.booklikeSrc = img.dataset.booklikeSrc
    picture.replaceWith(newImg)
  })

  doc.querySelectorAll<HTMLImageElement>('img[srcset]').forEach((img) => {
    const currentSrc = (img.dataset.booklikeSrc ?? img.src) || ''
    const upgrades = parseSrcsetEntries(img.srcset)
      .filter((e) => e.url !== currentSrc)
      .sort((a, b) => b.w - a.w)
      .map((e) => e.url)
    if (upgrades.length) upgradeMap.set(currentSrc, upgrades)
    if (img.dataset.booklikeSrc) img.src = img.dataset.booklikeSrc
    img.removeAttribute('srcset')
    img.removeAttribute('sizes')
  })

  return upgradeMap
}

export function resolveImgSrc(img: HTMLImageElement): string {
  if (img.dataset?.booklikeSrc) return img.dataset.booklikeSrc
  if (img.currentSrc) return img.currentSrc
  if (img.src) return img.src
  const srcset = img.getAttribute('srcset')
  if (!srcset) return ''
  let best = ''
  let bestW = 0
  srcset.split(/,\s+/).forEach((entry) => {
    const parts = entry.trim().split(/\s+/)
    const w = parseInt(parts[1], 10) || 0
    if (w > bestW || !best) {
      bestW = w
      best = parts[0]
    }
  })
  return best
}

export function addSrcToSrcsetOnlyImages(doc: Document): void {
  doc.querySelectorAll<HTMLImageElement>('img[srcset]:not([src]), img[srcset][src=""]').forEach((img) => {
    img.src = resolveImgSrc(img)
  })
}

export function neutralizeArticleHeaders(doc: Document): void {
  doc.querySelectorAll('article header').forEach((h) => {
    const div = doc.createElement('div')
    while (h.firstChild) div.appendChild(h.firstChild)
    h.replaceWith(div)
  })
}

export function unwrapFigureImageButtons(doc: Document): void {
  doc.querySelectorAll('figure button').forEach((btn) => {
    if (!btn.querySelector('img, picture')) return
    btn.replaceWith(...Array.from(btn.childNodes))
  })
}

export function stripNextJsFillImages(doc: Document): void {
  doc.querySelectorAll<HTMLImageElement>('img[data-nimg]').forEach((img) => {
    ;['position', 'inset', 'left', 'top', 'right', 'bottom', 'height', 'width'].forEach((p) =>
      img.style.removeProperty(p),
    )
  })
}

export function trimEdgeBrs(doc: Document): void {
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, blockquote, td, th, figcaption').forEach((el) => {
    while (el.firstChild?.nodeName === 'BR') el.firstChild.remove()
    while (el.lastChild?.nodeName === 'BR') el.lastChild.remove()
  })
}

export function mergeDatelines(doc: Document): void {
  doc.querySelectorAll('p').forEach((p) => {
    const prev = p.previousElementSibling
    if (!prev || prev.tagName === 'P') return
    if (prev.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, figure, blockquote')) return
    const text = prev.textContent?.replace(/\u00A0/g, ' ').trim() ?? ''
    if (text.length === 0 || text.length > 60 || !/[—–]$/.test(text)) return
    p.insertAdjacentText('afterbegin', text + ' ')
    prev.remove()
  })
}

export function flattedSingleChildDivs(doc: Document): void {
  doc.querySelectorAll('article div > div').forEach((inner) => {
    const outer = inner.parentElement
    if (outer?.hasAttributes()) return
    if (!outer?.parentNode) return
    if (outer.children.length !== 1) return
    if (inner.children.length === 0) return
    const hasBlocks = inner.querySelector('p, h1, h2, h3, h4, h5, h6, figure, blockquote')
    if (!hasBlocks) return
    outer.replaceWith(...Array.from(inner.childNodes))
  })
}

const PROMOTE_NOISE_TAGS = new Set(['BUTTON', 'SVG', 'SCRIPT', 'STYLE', 'NOSCRIPT'])

export function promoteImageBlocks(doc: Document): void {
  doc.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if (!img.isConnected) return
    if (img.closest('figure')) return

    let branch: Element = img.closest('picture') ?? img

    while (branch.parentElement && branch.parentElement.tagName !== 'BODY') {
      const parent = branch.parentElement
      if ((parent.textContent ?? '').trim().length > 600) break

      const children = Array.from(parent.children).filter((c) => !PROMOTE_NOISE_TAGS.has(c.tagName))

      if (children.length === 2) {
        const imgChild = children.find((c) => c === branch || c.contains(branch))
        const captionEl = children.find((c) => c !== imgChild)

        if (
          imgChild &&
          captionEl &&
          !captionEl.querySelector('img') &&
          imgChild.compareDocumentPosition(captionEl) & Node.DOCUMENT_POSITION_FOLLOWING
        ) {
          const captionText = (captionEl.textContent ?? '').replace(/\s+/g, ' ').trim()
          if (captionText.length > 5 && captionText.length < 500) {
            const fig = doc.createElement('figure')
            img.removeAttribute('class')
            img.removeAttribute('id')
            img.removeAttribute('style')
            fig.appendChild(img.closest('picture') ?? img)
            const fc = doc.createElement('figcaption')
            fc.textContent = captionText
            fig.appendChild(fc)
            parent.replaceWith(fig)
            return
          }
        }
      }

      branch = parent
    }
  })
}

export function extractFigureCaptionBlocks(doc: Document): void {
  doc.querySelectorAll('figure').forEach((fig) => {
    if (fig.querySelector('figcaption')) return
    if (!fig.querySelector('img')) return

    for (const child of Array.from(fig.children)) {
      if (child.tagName !== 'DIV' && child.tagName !== 'P') continue
      if (child.querySelector('img')) continue

      const clone = child.cloneNode(true) as HTMLElement
      clone.querySelectorAll('svg, button, [role="button"]').forEach((el) => el.remove())
      clone.querySelectorAll<HTMLElement>('[style]').forEach((el) => {
        const s = el.getAttribute('style') ?? ''
        if (/inset\(50%\)|clip:\s*rect\(0/.test(s)) el.remove()
      })
      clone.querySelectorAll('a').forEach((a) => a.remove())
      const text = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
      if (text.length < 5 || text.length > 500) continue

      const fc = doc.createElement('figcaption')
      fc.textContent = text
      fig.appendChild(fc)
      child.remove()
      break
    }
  })
}

export function adoptOrphanedFigcaptions(doc: Document): void {
  doc.querySelectorAll('figcaption').forEach((fc) => {
    if (fc.closest('figure')) return
    const prev = fc.previousElementSibling
    if (prev?.tagName === 'FIGURE') {
      prev.appendChild(fc)
      return
    }
    if (prev?.tagName === 'IMG') {
      const fig = doc.createElement('figure')
      prev.replaceWith(fig)
      fig.appendChild(prev)
      fig.appendChild(fc)
      return
    }
    const next = fc.nextElementSibling
    if (next?.tagName === 'FIGURE') {
      next.insertBefore(fc, next.firstChild)
      return
    }
    if (next?.tagName === 'IMG') {
      const fig = doc.createElement('figure')
      next.replaceWith(fig)
      fig.appendChild(fc)
      fig.appendChild(next)
    }
  })
}

export function unwrapCustomElements(doc: Document): void {
  const MEDIA_TAG = /video|player|audio|podcast/i
  const MEDIA_NAME = /video|youtube/i
  doc.querySelectorAll('*').forEach((el) => {
    if (!el.tagName.includes('-')) return
    if (MEDIA_TAG.test(el.tagName) || MEDIA_NAME.test(el.getAttribute('name') ?? '')) el.remove()
    else {
      const parent = el.parentNode
      if (parent) {
        while (el.firstChild) parent.insertBefore(el.firstChild, el)
        el.remove()
      }
    }
  })
}

export function unwrapFigureWrappers(doc: Document): void {
  let wrappers: NodeListOf<Element>
  while ((wrappers = doc.querySelectorAll('figure div, figure span, picture span')).length > 0) {
    let changed = false
    wrappers.forEach((el) => {
      if (el.closest('figcaption')) return
      el.replaceWith(...Array.from(el.childNodes))
      changed = true
    })
    if (!changed) break
  }
}

export function stripAriaHiddenFromCaptions(doc: Document): void {
  doc.querySelectorAll('figcaption[aria-hidden]').forEach((el) => el.removeAttribute('aria-hidden'))
}

export function unwrapDropcaps(doc: Document): void {
  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'BLOCKQUOTE', 'LI'])
  doc.querySelectorAll('[class*="dropcap"], [class*="drop-cap"], [class*="drop_cap"]').forEach((el) => {
    if (BLOCK.has(el.tagName)) {
      el.querySelectorAll(':scope > span').forEach((span) => {
        span.replaceWith(...Array.from(span.childNodes))
      })
      return
    }
    const next = el.nextElementSibling
    el.replaceWith(...Array.from(el.childNodes))
    if (next?.tagName === 'SPAN' && next.parentElement) {
      next.replaceWith(...Array.from(next.childNodes))
    }
  })

  doc.querySelectorAll('p > span:first-child').forEach((span) => {
    if ((span.textContent?.trim() ?? '').length === 1) {
      const letter = span.textContent.trim()
      span.replaceWith(letter)
    }
  })

  doc.querySelectorAll('p > strong:first-child').forEach((strong) => {
    if ((strong.textContent ?? '').trim().length === 1) {
      strong.replaceWith(...Array.from(strong.childNodes))
    }
  })
}

export function unwrapMarkElements(doc: Document): void {
  doc.querySelectorAll('mark').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
}

export function unwrapFontElements(doc: Document): void {
  doc.querySelectorAll('font').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
}

/** Strip aria-hidden from non-decorative elements so Readability doesn't discard their text content. */
export function stripAriaHidden(doc: Document): void {
  doc
    .querySelectorAll('[aria-hidden="true"]:not(svg):not(img)')
    .forEach((el) => el.removeAttribute('aria-hidden'))
}

export function unwrapHgroups(doc: Document): void {
  doc.querySelectorAll('hgroup').forEach((el) => el.replaceWith(...Array.from(el.childNodes)))
}

export function unwrapNestedLists(doc: Document): void {
  // real-life case on newsroom.spotify.com
  doc.querySelectorAll('ol > li, ul > li').forEach((li) => {
    if (li.children.length !== 1) return
    const inner = li.children[0]
    if (inner.tagName !== 'OL' && inner.tagName !== 'UL') return
    if ((li.textContent?.trim() ?? '') !== (inner.textContent?.trim() ?? '')) return
    if (!li.parentElement) return
    li.parentElement.replaceWith(inner)
  })
}

export function stripHtmlComments(doc: Document): void {
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT)
  const comments: Node[] = []
  while (walker.nextNode()) comments.push(walker.currentNode)
  comments.forEach((n) => n.parentNode?.removeChild(n))
}

export function stripBooklikeStamps(doc: Document): void {
  doc
    .querySelectorAll<HTMLElement>(
      '[data-booklike-src],[data-booklike-w],[data-booklike-h],[data-booklike-error],[data-booklike-hidden]',
    )
    .forEach((el) => {
      delete el.dataset.booklikeSrc
      delete el.dataset.booklikeW
      delete el.dataset.booklikeH
      delete el.dataset.booklikeError
      delete el.dataset.booklikeHidden
    })
}

function findFirstParagraph(root: Element): Element | null {
  const candidates = Array.from(root.querySelectorAll('p')).filter((p) => {
    if (p.closest('figcaption')) return false
    return (p.textContent?.trim().length ?? 0) >= 10
  })
  return (
    candidates.find(
      (p) => Array.from(p.parentElement?.children ?? []).filter((el) => el.tagName === 'P').length >= 2,
    ) ??
    candidates[0] ??
    null
  )
}

export function injectLedeImage(doc: Document, siteRule: SiteRule | undefined): string | null {
  const article = getArticleRoot(doc)
  if (!article) return null

  const ledeContainers = [
    '[data-testid*="lede" i]',
    '[data-testid*="hero" i]',
    '[class*="lede-" i]',
    '[class*="lede" i]',
    '[class*="hero-" i]',
    '[class*="hero" i]',
  ]
  if (siteRule?.lede) ledeContainers.unshift(siteRule.lede.container)

  const main = doc.querySelector('main, [role="main"]')

  function isValidPosition(el: Element): boolean {
    if (!main) return true
    if (main.contains(el)) return true
    return !!(el.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING)
  }

  function imgArea(img: HTMLImageElement): number {
    const w = +(img.getAttribute('data-booklike-w') ?? img.getAttribute('width') ?? 0)
    const h = +(img.getAttribute('data-booklike-h') ?? img.getAttribute('height') ?? 0)
    return w * h
  }

  let img: HTMLImageElement | null = null
  let matchedContainer: string | null = null

  for (const container of ledeContainers) {
    const candidates = Array.from(doc.querySelectorAll<HTMLImageElement>(`${container} img`)).filter(
      isValidPosition,
    )
    if (!candidates.length) continue
    matchedContainer = container
    img = candidates.reduce((best, c) => (imgArea(c) > imgArea(best) ? c : best))
    break
  }

  if (!img) {
    const firstPara = findFirstParagraph(article)
    if (firstPara) {
      for (const fig of Array.from(article.querySelectorAll('figure'))) {
        if (!fig.querySelector('img')) continue
        if (!(fig.compareDocumentPosition(firstPara) & Node.DOCUMENT_POSITION_FOLLOWING)) continue
        if (firstPara.parentNode!.contains(fig)) break
        firstPara.parentNode?.insertBefore(fig, firstPara)
        break
      }
    }
    return null
  }

  const matchedEl = matchedContainer ? img.closest(matchedContainer) : null
  const figureParent = img.closest('figure')

  const afterImg = (el: Element | null): Element | null =>
    el && img.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING ? el : null
  const firstAfter = (root: Element | null | undefined, sel: string): Element | null =>
    root ? (Array.from(root.querySelectorAll(sel)).find((el) => afterImg(el)) ?? null) : null

  const captionEl =
    firstAfter(img.closest('figure'), '[itemprop="caption"]') ??
    firstAfter(matchedEl, '[itemprop="caption"]') ??
    afterImg(doc.querySelector(`figcaption[data-testid="lede-art-caption"]`)) ??
    firstAfter(img.closest('figure'), 'figcaption') ??
    firstAfter(matchedEl, 'figcaption') ??
    firstAfter(matchedEl, '[class*="caption"]') ??
    firstAfter(matchedEl, '[class*="credit"]') ??
    null
  const captionHTML = captionEl?.innerHTML?.trim() ?? null
  const captionText =
    captionHTML === null &&
    /\s/.test(img.alt) &&
    !/\.\w{2,4}$/.test(img.alt) &&
    !/^image may contain/i.test(img.alt)
      ? img.alt.trim()
      : null

  const pictureOrImg = img.closest('picture') ?? img

  const fig = doc.createElement('figure')
  img.removeAttribute('style')
  img.removeAttribute('class')
  img.removeAttribute('title')
  fig.appendChild(pictureOrImg)
  if (captionHTML) {
    const fc = doc.createElement('figcaption')
    fc.innerHTML = captionHTML
    fig.appendChild(fc)
  } else if (captionText) {
    const fc = doc.createElement('figcaption')
    fc.textContent = captionText
    fig.appendChild(fc)
  }

  if (figureParent && !figureParent.contains(article)) figureParent.remove()
  else if (matchedEl && matchedEl !== pictureOrImg && matchedEl !== doc.body && !matchedEl.contains(article))
    matchedEl.remove()

  return fig.outerHTML
}
