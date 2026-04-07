import { preprocess, identifyContentImageSrcs } from './preprocess'
import { extractArticle, buildArticleContent, extractHeadData } from './extract'
import { launchReader } from './reader/index'
import isVisible from './visibility'
import { MIN_NATURAL_RESOLUTION, EPUB_IMAGE_MIN_WIDTH, JS_RENDER_WAIT_TIMEOUT } from './config'
import { closestSrcsetUrl, triggerLazyImages, stampLazyImages, clearLazyCSS, waitForImages } from './prepare'
import { showLoadingOverlay, showExtractionError, isBelowMinWordCount } from './overlay'
import { getArticleRoot } from './helpers'
;(() => {
  if (window.__BOOKLIKE_ACTIVE__) return

  window.addEventListener('message', (e: MessageEvent) => {
    if ((e.data as { type?: unknown } | null)?.type !== 'booklike-print') return
    void chrome.runtime.sendMessage({ type: 'booklike-print' })
  })

  window.addEventListener('pageshow', (e: PageTransitionEvent) => {
    if (e.persisted && window.__BOOKLIKE_ACTIVE__) {
      location.reload()
    }
  })

  function stampFigcaptionBlocks(): HTMLElement[] {
    const stamped: HTMLElement[] = []
    document.querySelectorAll<HTMLElement>('figcaption').forEach((fc) => {
      const fcCs = getComputedStyle(fc)
      const isFlex =
        fcCs.display === 'flex' ||
        fcCs.display === 'inline-flex' ||
        fcCs.display === 'grid' ||
        fcCs.display === 'inline-grid'
      if (isFlex) {
        Array.from(fc.children).forEach((child) => {
          ;(child as HTMLElement).dataset.booklikeBlock = ''
          stamped.push(child as HTMLElement)
        })
      }
      fc.querySelectorAll<HTMLElement>('*').forEach((el) => {
        if (el.dataset.booklikeBlock !== undefined) return
        const cs = getComputedStyle(el)
        if (cs.float === 'left' || cs.float === 'right') {
          el.dataset.booklikeBlock = ''
          stamped.push(el)
        }
      })
    })
    return stamped
  }

  function markVisibility(): {
    markedHidden: HTMLElement[]
    markedTypographic: HTMLElement[]
  } {
    const SKIP_TYPOGRAPHIC_TAGS = new Set(['STRONG', 'EM', 'B', 'I'])
    const markedHidden: HTMLElement[] = []
    const markedTypographic: HTMLElement[] = []

    document.querySelectorAll<HTMLElement>('[class], [style]').forEach((el) => {
      if (el.tagName === 'LI') return
      if (el.tagName === 'PICTURE') return
      if ('booklikeLazy' in el.dataset) return
      if (!isVisible(el)) {
        el.dataset.booklikeHidden = ''
        markedHidden.push(el)
        return
      }
      if (SKIP_TYPOGRAPHIC_TAGS.has(el.tagName)) return
      const cs = getComputedStyle(el)
      if (!cs.display.startsWith('inline')) return
      const bold = Number(cs.fontWeight) >= 700 || cs.fontWeight === 'bold' || cs.fontWeight === 'bolder'
      const italic = cs.fontStyle === 'italic' || cs.fontStyle === 'oblique'
      if (bold) el.dataset.booklikeBold = ''
      if (italic) el.dataset.booklikeItalic = ''
      if (bold || italic) markedTypographic.push(el)
    })

    return { markedHidden, markedTypographic }
  }

  function getClipAncestor(el: HTMLElement): HTMLElement | null {
    let node = el.parentElement
    while (node && node !== document.body) {
      const overflow = getComputedStyle(node).overflowX
      if (overflow === 'hidden' || overflow === 'clip') return node
      node = node.parentElement
    }
    return null
  }

  function captureImageMetadata(markedHidden: HTMLElement[]): {
    markedImgs: Array<HTMLImageElement | SVGElement>
    exportSrcMap: Map<string, string>
  } {
    const exportSrcMap = new Map<string, string>()
    const markedImgs: Array<HTMLImageElement | SVGElement> = []

    document.querySelectorAll('img').forEach((img) => {
      const src = img.currentSrc || img.src
      if (src) img.dataset.booklikeSrc = src
      const picture = img.closest('picture')
      if (picture) {
        const sources = Array.from(picture.querySelectorAll('source'))
        const key = img.currentSrc || img.src
        // Find which <source> currentSrc came from to reliably detect its format
        const matchingSource = sources.find((s) =>
          s.srcset.split(/,\s+/).some((part) => part.trim().split(/\s+/)[0] === key),
        )
        const mimeType = matchingSource?.type ?? ''
        const isCompat =
          mimeType.includes('jpeg') ||
          mimeType.includes('png') ||
          (!mimeType && /\.(jpe?g|png)(\?|$)/i.test(key))
        if (!isCompat) {
          // currentSrc is WebP/AVIF (or unknown) — find a JPEG/PNG source and pick smallest ≥ 600w
          const compatSource =
            sources.find((s) => s.type?.includes('jpeg') && s.srcset) ??
            sources.find((s) => s.type?.includes('png') && s.srcset)
          if (compatSource?.srcset) {
            const compatSrc = closestSrcsetUrl(compatSource.srcset, EPUB_IMAGE_MIN_WIDTH)
            if (compatSrc && compatSrc !== key) exportSrcMap.set(key, compatSrc)
          }
        }
      }
      if (img.complete && img.naturalWidth === 0 && src) img.dataset.booklikeError = ''
      if (img.naturalWidth > 0 && img.naturalWidth * img.naturalHeight < MIN_NATURAL_RESOLUTION) {
        img.dataset.booklikeHidden = ''
        markedHidden.push(img)
      }
      const rect = img.getBoundingClientRect()
      const w = rect.width > 0 ? Math.round(rect.width) : img.naturalWidth
      const h = rect.height > 0 ? Math.round(rect.height) : img.naturalHeight
      if (w > 0 && h > 0) {
        img.dataset.booklikeW = String(w)
        img.dataset.booklikeH = String(h)
      }
      const clip = getClipAncestor(img)
      if (clip) {
        const clipRect = clip.getBoundingClientRect()
        if (rect.right <= clipRect.left || rect.left >= clipRect.right) {
          img.dataset.booklikeHidden = ''
          markedHidden.push(img)
        }
      }
      markedImgs.push(img)
    })

    document.querySelectorAll('svg').forEach((svg) => {
      const rect = svg.getBoundingClientRect()
      const sw = Math.round(rect.width),
        sh = Math.round(rect.height)
      if (sw > 0 && sh > 0) {
        svg.dataset.booklikeW = String(sw)
        svg.dataset.booklikeH = String(sh)
      }
      markedImgs.push(svg)
    })

    return { markedImgs, exportSrcMap }
  }

  function clearMarkers(
    markedHidden: HTMLElement[],
    markedImgs: Array<HTMLImageElement | SVGElement>,
    markedTypographic: HTMLElement[],
    markedLazy: HTMLImageElement[],
    markedBlock: HTMLElement[],
  ): void {
    markedHidden.forEach((el) => delete el.dataset.booklikeHidden)
    markedImgs.forEach((el) => {
      delete el.dataset.booklikeSrc
      delete el.dataset.booklikeError
      delete el.dataset.booklikeW
      delete el.dataset.booklikeH
    })
    markedTypographic.forEach((el) => {
      delete el.dataset.booklikeBold
      delete el.dataset.booklikeItalic
    })
    markedLazy.forEach((el) => delete el.dataset.booklikeLazy)
    markedBlock.forEach((el) => delete el.dataset.booklikeBlock)
  }

  async function run(): Promise<void> {
    window.__BOOKLIKE_ACTIVE__ = true
    if (document.readyState === 'loading') {
      await new Promise<void>((resolve) =>
        document.addEventListener('DOMContentLoaded', () => resolve(), { once: true }),
      )
    }

    let overlay: HTMLDivElement | null = null

    const hasContent = () =>
      ((getArticleRoot(document) ?? document.body)?.textContent?.trim().length ?? 0) > 300
    if (!hasContent()) {
      overlay = showLoadingOverlay()
      const deadline = Date.now() + JS_RENDER_WAIT_TIMEOUT
      while (Date.now() < deadline && !hasContent()) {
        await new Promise<void>((resolve) => setTimeout(resolve, 300))
      }
    }

    const showTimer = setTimeout(() => {
      overlay ??= showLoadingOverlay()
    }, 50)

    const markedLazy = stampLazyImages()
    try {
      triggerLazyImages()
      const earlyClone = document.cloneNode(true) as Document
      const keptSrcs = identifyContentImageSrcs(earlyClone)
      clearLazyCSS(markedLazy)
      await waitForImages(keptSrcs)
      await chrome.runtime.sendMessage({ type: 'booklike-kill-js' })
    } catch (err) {
      clearTimeout(showTimer)
      overlay ??= showLoadingOverlay()
      console.error('[BookLike] Pre-extraction error:', err) // eslint-disable-line no-console
      showExtractionError(overlay)
      return
    }
    clearTimeout(showTimer)

    const markedBlock = stampFigcaptionBlocks()
    const { markedHidden, markedTypographic } = markVisibility()
    const { markedImgs, exportSrcMap } = captureImageMetadata(markedHidden)

    const clone = document.cloneNode(true) as Document
    clearMarkers(markedHidden, markedImgs, markedTypographic, markedLazy, markedBlock)

    const headData = extractHeadData(clone)
    const { ledeHTML, upgradeMap } = preprocess(clone)
    const article = extractArticle(clone, headData)
    if (!article) {
      showExtractionError(overlay)
      return
    }

    const content = buildArticleContent(article, ledeHTML)
    if (isBelowMinWordCount(content)) {
      showExtractionError(overlay)
      return
    }

    launchReader(
      article.title,
      article.subtitle,
      article.author,
      article.byline,
      article.date,
      article.sourceUrl,
      content,
      article.lang,
      upgradeMap,
      exportSrcMap,
    ).catch((err) => {
      console.error('[BookLike] Launch error:', err) // eslint-disable-line no-console
      showExtractionError(overlay)
    })
  }

  run().catch((err) => {
    console.error('[BookLike] Exception:', err) // eslint-disable-line no-console
    showExtractionError(document.getElementById('booklike-loading') as HTMLDivElement | null)
  })
})()
