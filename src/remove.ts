import { getArticleRoot } from './helpers'
import {
  MIN_RENDERED_RESOLUTION,
  EXTREME_ASPECT_RATIO,
  SAFE_REMOVE_MAX_TEXT_FRACTION,
  BREADCRUMB_MAX_LINK_TEXT,
  BREADCRUMB_MAX_CONTAINER_TEXT_PER_LINK,
  SHARE_BYLINE_MAX_ANCESTOR_TEXT,
  RUBRIC_MAX_TEXT_CHARS,
  RELATED_SECTION_MAX_PROSE_CHARS,
} from './config'

function canRemoveSafely(el: Element, doc: Document): boolean {
  if (el === doc.documentElement || el === doc.body) return false
  const article = getArticleRoot(doc)

  if (article && !article.contains(el) && !el.contains(article)) return true

  const root = article ?? doc.body
  const rootLen = (root?.textContent ?? '').trim().length
  if (rootLen > 0) {
    const elLen = (el.textContent ?? '').trim().length
    if (elLen / rootLen > SAFE_REMOVE_MAX_TEXT_FRACTION) return false
  }

  return true
}

export function removeNonContentElements(doc: Document): void {
  doc.querySelectorAll('script, style, video, iframe, embed, object, hr').forEach((el) => el.remove())
  doc.querySelectorAll('address').forEach((el) => {
    if (canRemoveSafely(el, doc)) el.remove()
  })
}

export function removeHiddenElements(doc: Document): void {
  doc.querySelectorAll('[data-booklike-hidden]').forEach((el) => {
    if (!canRemoveSafely(el, doc)) return
    const target = el.tagName === 'IMG' ? (el.closest('picture') ?? el) : el
    target.remove()
  })
}

export function removeErrorImages(doc: Document): void {
  doc.querySelectorAll<HTMLImageElement>('img[data-booklike-error]').forEach((img) => {
    const figure = img.closest('figure')
    const self = img.closest('picture') ?? img
    ;(figure ?? self).remove()
  })
}

function isTooSmall(el: HTMLElement): boolean {
  const w = parseInt(el.dataset.booklikeW ?? '', 10)
  const h = parseInt(el.dataset.booklikeH ?? '', 10)
  if (!(w > 0) || !(h > 0)) return false
  if (w * h < MIN_RENDERED_RESOLUTION) return true
  if (Math.max(w / h, h / w) > EXTREME_ASPECT_RATIO) return true
  return false
}

export function removeSmallImages(doc: Document): void {
  doc.querySelectorAll<HTMLElement>('img[data-booklike-w], svg[data-booklike-w]').forEach((img) => {
    if (!isTooSmall(img)) return
    const figure = img.closest('figure')
    const self = img.closest('picture') ?? img
    const figureHasUsefulImg =
      figure && Array.from(figure.querySelectorAll('img')).some((i) => i !== img && !isTooSmall(i))
    if (figureHasUsefulImg) {
      self.remove()
    } else {
      ;(figure ?? self).remove()
    }
  })
}

export function removeDecorativeSvgs(doc: Document): void {
  doc.querySelectorAll('svg').forEach((el) => {
    if (el.querySelector('symbol') || el.querySelector('defs')) el.remove()
  })
  doc.querySelectorAll('a svg[aria-hidden="true"], label svg, button svg').forEach((el) => el.remove())
}

export function removeMeaninglessFigures(doc: Document): void {
  doc.querySelectorAll('figure').forEach((fig) => {
    if (!fig.querySelector('img, picture')) fig.remove()
  })
}

export function removeFigurelessFigcaptions(doc: Document): void {
  doc.querySelectorAll('figcaption:not(figure figcaption)').forEach((fc) => fc.remove())
}

export function removeFigureNoise(doc: Document): void {
  doc.querySelectorAll('figure button, figure dialog').forEach((el) => el.remove())
}

export function removeSvgPlaceholderImages(doc: Document): void {
  doc.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if ((img.getAttribute('src') ?? '').startsWith('data:image/svg')) {
      const container = img.closest('figure') ?? img.closest('picture') ?? img
      container.remove()
    }
  })
}

export function removeKnownNonContent(doc: Document): void {
  const selectors = [
    'a[hreflang]',
    '[role="tooltip"]',
    '[x-effect*="ThirdpartyConsent"]',
    '.tag-list',
    '.global-pre-text',
    '[class*="mb-masthead" i]',
    '[class*="recirculation" i]',
    '[class*="RelatedContent" i]',
    '[class*="MagazinePromo" i]',
    '[class*="disclaimer" i]',
    '[class*="outbrain" i]',
    '[class*="videoWrap" i]',
    '[class*="video-container" i]',
    '[class*="PrivacyEmbedConsent" i]',
    '[class*="privacy-embed" i]',
    '[class*="consent-overlay" i]',
    '[class*="eu-cookie" i]',
    '[class*="sliding-popup" i]',
    '[class*="article-suggest" i]',
    '[class*="subscribe" i]',
    '[class*="comments-link" i]',
    '[class*="article-tags" i]',
    '[class*="meta-box" i]',
    '[class*="videoplayer" i]',
    '[class*="video-player" i]',
    '[class*="section-label" i]',
    '[class*="ArticleAudio" i]',
    '[class*="article__copyright" i]',
    '[class*="NewsletterSignup" i]',
    '[class*="cta_snippet" i]',
    '[data-tracking="article-status" i]',
    '[data-testid="byline" i]',
    '[data-testid="storyReadTime" i]',
    '[data-testid="storyPublishDate" i]',
    '[data-testid*="video-player" i]',
    '[data-testid*="videoplayer" i]',
    '[data-testid*="VideoBlock" i]',
    '[data-testid="decibel-player" i]',
    '[data-video-id]',
    '[data-component*="youtube" i]',
    '[data-component-type="post-bottom" i]',
    '[data-component-type="post-category-tags" i]',
    '[data-testid="nudge" i]',
    '[data-testid="teaser"]',
    '[data-manual-remove="true"]',
    '[data-sctrack*="Teaser" i]',
    '[data-external-article-headline]',
    '[data-external-article-kicker]',
    '[data-flatplan-ignore="true"]',
    '[class*="dateModified" i]',
    '[class*="date-modified" i]',
    '[data-timestamp]',
  ]
  doc.querySelectorAll(selectors.join(',')).forEach((el) => {
    if (canRemoveSafely(el, doc)) el.remove()
  })

  const adWrapperPattern = /\bad[-_\w]*wrapper\b/i
  doc.querySelectorAll('[id]').forEach((el) => {
    if (adWrapperPattern.test(el.id) && canRemoveSafely(el, doc)) el.remove()
  })
  doc.querySelectorAll('[class]').forEach((el) => {
    if ([...el.classList].some((c) => adWrapperPattern.test(c)) && canRemoveSafely(el, doc)) el.remove()
  })
}

export function removeBreadcrumbs(doc: Document): void {
  const hasBreadcrumbClass = (el: Element): boolean =>
    /breadcrumb|crumb/i.test(el.className) ||
    Array.from(el.querySelectorAll('[class]')).some((c) => /breadcrumb|crumb/i.test(c.className))

  const isBreadcrumb = (el: Element, requireClassHint = false): boolean => {
    const links = el.querySelectorAll('a')
    if (links.length < 2) return false
    const allShort = Array.from(links).every((a) => {
      const t = a.textContent?.trim() ?? ''
      return t.length > 0 && t.length < BREADCRUMB_MAX_LINK_TEXT
    })
    if (!allShort) return false
    const textLen = el.textContent?.trim().length ?? 0
    if (textLen > links.length * BREADCRUMB_MAX_CONTAINER_TEXT_PER_LINK) return false
    if (requireClassHint) return hasBreadcrumbClass(el)
    return true
  }

  const roots = Array.from(doc.querySelectorAll('article, main, [role="main"]'))
  roots.forEach((root) => {
    const header = root.querySelector(':scope header')
    if (header)
      header.querySelectorAll('ul, ol, nav').forEach((el) => {
        if (isBreadcrumb(el)) el.remove()
      })

    root.querySelectorAll('nav').forEach((nav) => {
      if (isBreadcrumb(nav)) nav.remove()
    })

    root.querySelectorAll('ul, ol').forEach((el) => {
      if (isBreadcrumb(el, true)) el.remove()
    })
  })

  doc.querySelectorAll('nav').forEach((nav) => {
    if (roots.some((r) => r.contains(nav))) return
    if (!isBreadcrumb(nav, true)) return
    const h1 = nav.querySelector('h1')
    if (h1) nav.parentElement?.insertBefore(h1, nav)
    nav.remove()
  })
}

export function removeRubricLabels(doc: Document): void {
  const selector = '[class*="rubric"], [class*="kicker"], [class*="eyebrow"], [class*="label--"]'
  doc.querySelectorAll(selector).forEach((el) => {
    if (!canRemoveSafely(el, doc)) return
    if (el.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, figure, img, a')) return
    const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (text.length === 0 || text.length > RUBRIC_MAX_TEXT_CHARS) return
    el.remove()
  })

  doc.querySelectorAll('h1').forEach((h1) => {
    const prev = h1.previousElementSibling
    if (!prev) return
    if (prev.querySelector('a, img, figure, p, ul, ol')) return
    const text = prev.textContent?.replace(/\s+/g, ' ').trim() ?? ''
    if (!text || text.length > RUBRIC_MAX_TEXT_CHARS || text.endsWith('.')) return
    if (canRemoveSafely(prev, doc)) prev.remove()
  })
}

const INLINE_PROMO_LABEL = /^(also\s+read|read\s+also|read\s+more|see\s+also|more\s+on|related)[:\s]/i
const CTA_LINK_TEXT = /^(click\s+here|subscribe|sign\s+up|sign\s+in|log\s+in|register)\b/i

export function removeInlineRecommendedWidgets(doc: Document): void {
  doc.querySelectorAll('.recommended').forEach((el) => {
    const siblings = el.parentElement?.children
    if (!siblings) return
    if (Array.from(siblings).some((s) => s !== el && s.tagName === 'P')) el.remove()
  })

  doc.querySelectorAll('p > strong, p > em').forEach((el) => {
    if (!el.isConnected) return
    if (!INLINE_PROMO_LABEL.test(el.textContent?.trim() ?? '')) return
    if (!el.querySelector('a')) return
    const p = el.parentElement!
    const childNodes = Array.from(p.childNodes)
    const idx = childNodes.indexOf(el)
    const before = childNodes.slice(0, idx)
    const onlyBrsBefore = before.every(
      (n) =>
        (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim()) ||
        (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName === 'BR'),
    )
    if (!onlyBrsBefore) return
    const after = childNodes.slice(idx + 1)
    const afterText = after
      .filter(
        (n) =>
          n.nodeType === Node.TEXT_NODE ||
          (n.nodeType === Node.ELEMENT_NODE && (n as Element).tagName !== 'BR'),
      )
      .map((n) => n.textContent ?? '')
      .join('')
      .trim()
    before.forEach((n) => n.remove())
    let next: ChildNode | null = el.nextSibling
    el.remove()
    while (
      next &&
      ((next.nodeType === Node.ELEMENT_NODE && (next as Element).tagName === 'BR') ||
        (next.nodeType === Node.TEXT_NODE && !next.textContent?.trim()))
    ) {
      const toRemove = next
      next = next.nextSibling
      toRemove.remove()
    }
    if (!afterText) p.remove()
  })

  doc.querySelectorAll('p').forEach((p) => {
    const links = p.querySelectorAll('a')
    if (links.length !== 1) return
    const link = links[0]
    if (!CTA_LINK_TEXT.test(link.textContent?.trim() ?? '')) return
    let wrapperInP: Element = link
    while (wrapperInP.parentElement !== p) wrapperInP = wrapperInP.parentElement!
    const outerText = Array.from(p.childNodes)
      .filter((n) => n !== wrapperInP)
      .map((n) => n.textContent ?? '')
      .join('')
      .trim()
    if (outerText) return
    p.remove()
  })
}

export function removeLooseNonArticleHeadings(doc: Document): void {
  const pattern = /^(further reading|see also|related articles?|more\s+\w+$)/i
  doc.querySelectorAll('h2, h3').forEach((h) => {
    if (!pattern.test(h.textContent?.trim() ?? '')) return

    const toRemove: Element[] = [h]
    let next = h.nextElementSibling
    while (next?.tagName === 'P') {
      const links = next.querySelectorAll('a')
      if (links.length === 0) break
      const totalText = next.textContent?.replace(/\s+/g, ' ').trim().length ?? 0
      const linkText = Array.from(links).reduce((n, a) => n + (a.textContent?.trim().length ?? 0), 0)
      if (totalText - linkText > RELATED_SECTION_MAX_PROSE_CHARS) break // too much prose — stop here
      toRemove.push(next)
      next = next.nextElementSibling
    }

    toRemove.forEach((el) => el.remove())
  })
}

const NON_ARTICLE_SECTION_PATTERN =
  /^(more\s+\w+$|editor.?s.? picks|related|recommended|also read|read (also|more)|you (may|might) also|most (read|popular)|trending|popular articles|jump\s+to\b|explore\s+more\b)/i
const COMMENTS_PATTERN =
  /^(comments|kommentare|commentaires|comentarios|commenti|coment[aá]rios|reacties|commentaar|komentarze|kommentarer|kommentit|koment[aá][rř]e|комментарии)$/i

export function removeNonArticleSections(doc: Document): void {
  doc.querySelectorAll('section, div').forEach((el) => {
    const pFirstChild = el.querySelector(':scope > p:first-child, :scope > div:first-child')
    const heading =
      el.querySelector(':scope > h2, :scope > h3, :scope > header, :scope > * > header') ??
      (pFirstChild &&
      !pFirstChild.querySelector('p, h2, h3, img') &&
      (pFirstChild.textContent?.trim().length ?? 0) < 40
        ? pFirstChild
        : null) ??
      Array.from(
        el.querySelectorAll(
          ':scope > strong, :scope > b, :scope > * > strong, :scope > * > b, :scope > p > strong, :scope > p > b, :scope > * > p > strong, :scope > * > p > b',
        ),
      ).find((bold) => bold.textContent?.trim() === bold.parentElement?.textContent?.trim())
    if (!heading) return
    const text = heading.textContent?.trim() ?? ''
    if (!NON_ARTICLE_SECTION_PATTERN.test(text) && !COMMENTS_PATTERN.test(text)) return
    let toRemove: Element = el
    if (el.children.length === 1) {
      while (toRemove.parentElement?.children.length === 1) {
        toRemove = toRemove.parentElement
      }
      if (toRemove.parentElement) toRemove = toRemove.parentElement
    }
    if (canRemoveSafely(toRemove, doc)) toRemove.remove()
    else if (toRemove !== el && canRemoveSafely(el, doc)) el.remove()
  })
}

export function removeComplementaryElements(doc: Document): void {
  doc.querySelectorAll('[role="complementary"]').forEach((el) => {
    let wrapper: Element = el
    while (wrapper.parentElement) {
      const parent = wrapper.parentElement
      if (parent.tagName === 'BODY' || parent.tagName === 'ARTICLE') break
      const hasSiblingParagraphs = Array.from(parent.children).some(
        (s) => s !== wrapper && s.tagName === 'P' && (s.textContent?.trim().length ?? 0) > 20,
      )
      if (hasSiblingParagraphs) break
      wrapper = parent
    }
    if (canRemoveSafely(wrapper, doc)) wrapper.remove()
    else if (wrapper !== el && canRemoveSafely(el, doc)) el.remove()
  })
}

export function removeMetadataLists(doc: Document): void {
  doc.querySelectorAll('ul, ol').forEach((list) => {
    if (!list.querySelector('time[datetime]')) return
    if (list.querySelector('a[href]')) return
    const clone = list.cloneNode(true) as Element
    clone.querySelectorAll('svg').forEach((el) => el.remove())
    const totalText = (clone.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (totalText.length < 200) list.remove()
  })
}

export function removeShareLinkBylines(doc: Document): void {
  const SHARE_HOSTS = [
    'facebook.com/sharer',
    'twitter.com/intent/tweet',
    'linkedin.com/shareArticle',
    'share.flipboard.com',
    'reddit.com/submit',
  ]
  doc.querySelectorAll('time[datetime]').forEach((time) => {
    let el: Element | null = time.parentElement
    while (el && el !== doc.body && el.tagName !== 'ARTICLE') {
      if ((el.textContent ?? '').trim().length > SHARE_BYLINE_MAX_ANCESTOR_TEXT) break
      if (SHARE_HOSTS.some((h) => el!.querySelector(`a[href*="${h}"]`))) {
        if (canRemoveSafely(el, doc)) el.remove()
        return
      }
      el = el.parentElement
    }
  })
}

export function removeStandalonePublicationDates(doc: Document): void {
  doc.querySelectorAll('time[datetime]').forEach((el) => {
    const parent = el.parentNode
    if (!parent) return
    const directSiblingText = Array.from(parent.childNodes)
      .filter((n) => n !== el && n.nodeType === Node.TEXT_NODE)
      .map((n) => n.textContent ?? '')
      .join('')
      .replace(/\u00A0/g, ' ')
      .trim()
    if (directSiblingText.length < 20) {
      const hasElementSiblings = Array.from(parent.childNodes).some(
        (n) => n !== el && n.nodeType === Node.ELEMENT_NODE,
      )
      if ((parent as Element).tagName === 'P' && !hasElementSiblings) {
        ;(parent as Element).remove()
        return
      }
      const prev = el.previousSibling
      if (prev?.nodeType === Node.TEXT_NODE && /^\s*(on|at|·|—)\s*$/i.test(prev.textContent ?? '')) {
        prev.remove()
      }
      el.remove()
    }
  })
}

const SHARE_HOSTS =
  /\b(facebook\.com\/shar|twitter\.com\/intent\/tweet|x\.com\/intent\/tweet|reddit\.com\/submit|linkedin\.com\/shareArticle|wa\.me\/|whatsapp\.com\/send|t\.me\/share|telegram\.me\/share|pinterest\.com\/pin\/create)\b/i

export function removeShareWidgets(doc: Document): void {
  doc.querySelectorAll('div, aside, p').forEach((el) => {
    const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('a[href]'))
    if (!links.length) return
    if (links.every((a) => SHARE_HOSTS.test(a.getAttribute('href') ?? ''))) el.remove()
  })
}

const STUB_EN = [
  'share',
  'written by',
  'pinned',
  'explore more topics',
  'explore more',
  'advertisement',
  'skip advertisement',
]
const STUB_BY_LANG: Record<string, string[]> = {
  de: ['teilen', 'geschrieben von'],
  fr: ['partager', 'écrit par', 'par'],
  es: ['compartir', 'escrito por'],
  it: ['condividi', 'scritto da'],
  pt: ['compartilhar', 'partilhar', 'escrito por'],
  nl: ['delen', 'geschreven door'],
}

export function removeStubElements(doc: Document): void {
  const lang = doc.documentElement.lang?.split('-')[0].toLowerCase() ?? ''
  const langTerms = STUB_BY_LANG[lang] ?? []
  const terms = [...STUB_EN, ...langTerms]
  const stubPattern = new RegExp(
    `^(\\[edit\\]|updated|and|by|on|${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`,
    'i',
  )
  doc.querySelectorAll('p, span, h2, h3, div').forEach((el) => {
    const t = el.textContent?.replace(/\u00A0/g, ' ').trim() ?? ''
    if (stubPattern.test(t)) el.remove()
  })
}

export function removeAudioPlayerWidgets(doc: Document): void {
  doc
    .querySelectorAll('[id*="beyondwords"], .beyondwords-wrapper, .beyondwords-player')
    .forEach((el) => el.remove())
  const durationPattern = /^listen\s*[·•]\s*\d+:\d+\s*$/i
  doc.querySelectorAll('div, p, span').forEach((el) => {
    if (durationPattern.test(el.textContent?.trim() ?? '')) el.remove()
  })
  const listenPattern = /^listen\s+to\s+(an?\s+)?audio\s+version/i
  doc.querySelectorAll('h1, h2, h3, h4, h5, h6, p').forEach((el) => {
    if (listenPattern.test(el.textContent?.trim() ?? '')) el.remove()
  })
}
