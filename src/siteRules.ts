export interface SiteRule {
  remove?: string[]
  lede?: { container: string }
  preprocess?: (doc: Document) => void
}

const SITE_RULES: Record<string, SiteRule> = {
  '972mag.com': {
    remove: ['.partnership-wrapper'],
  },
  'apnews.com': {
    remove: ['[class*="carousel-slides" i]'],
    preprocess(doc) {
      doc.querySelectorAll('[data-ap-readmore-hidden]').forEach((el) => {
        el.removeAttribute('data-booklike-hidden')
      })
    },
  },
  'billboard.com': {
    remove: ['.newsletter-cta'],
  },
  'blog.mozilla.org': {
    remove: ['[class*="inline-cta"]'],
  },
  'cointelegraph.com': {
    remove: ['[data-ct-widget]'],
  },
  'forbes.com': {
    preprocess(doc) {
      doc.querySelectorAll('.key-facts').forEach((block) => {
        const ul = doc.createElement('ul')
        block.querySelectorAll('.key-facts-element').forEach((el) => {
          const li = doc.createElement('li')
          li.append(...Array.from(el.querySelector('p')?.childNodes ?? el.childNodes))
          ul.appendChild(li)
        })
        block.replaceWith(ul)
      })
    },
  },
  'newyorker.com': {
    remove: ['[class*="SiteFooterNoticesWrapper" i]'],
  },
  'nytimes.com': {
    remove: ['.bottom-of-article', '[aria-label="Gallery"]'],
  },
  'theverge.com': {
    preprocess(doc) {
      const containers = new Set<Element>()
      doc.querySelectorAll('li[id*="follow-author"]').forEach((li) => {
        const ul = li.parentElement
        const div = ul?.parentElement
        if (div?.tagName === 'DIV') containers.add(div)
      })
      containers.forEach((el) => el.remove())
    },
  },
  'techcrunch.com': {
    remove: [
      '.wp-block-techcrunch-inline-cta',
      '.wp-block-tc23-post-relevant-terms',
      '.wp-block-techcrunch-post-authors',
    ],
  },
  'washingtonpost.com': {
    remove: ['.type-topic-follow-interstitial', '[data-testid="timestamp"]', '.article-footer'],
  },
  'wikipedia.org': {
    remove: [
      '.mw-indicators',
      '[class*="status-indicator"]',
      '#siteSub',
      '.noprint',
      'table.infobox',
      '.float-right',
      '.float-left',
      '.floatright',
      '.floatleft',
      '.tright',
      'table[align="right"]',
      'table[align="left"]',
      'ul.gallery',
      '[class*="cite-backlink"]',
      '[role="navigation"]',
      '.mw-editsection',
    ],
    preprocess(doc) {
      doc.querySelectorAll('sup.reference').forEach((sup) => {
        sup.textContent = sup.textContent?.replace(/\s+/g, '') ?? ''
      })
    },
  },
}

export function matchSiteRules(doc: Document): SiteRule | undefined {
  const hostname = (() => {
    try {
      return new URL(doc.URL).hostname
    } catch {
      return ''
    }
  })().replace(/^www\./, '')
  for (const [domain, rule] of Object.entries(SITE_RULES)) {
    if (hostname === domain || hostname.endsWith('.' + domain)) return rule
  }
}

export function applySiteRules(doc: Document, rule?: SiteRule): void {
  if (!rule) return
  if (rule.remove)
    try {
      doc.querySelectorAll(rule.remove.join(',')).forEach((el) => el.remove())
    } catch {}
  if (rule.preprocess) rule.preprocess(doc)
}
