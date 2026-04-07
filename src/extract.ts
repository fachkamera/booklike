import { Readability } from '@mozilla/readability'
import { postprocess, removeRedundantHeading } from './postprocess'
import type { Article } from './types'
import { MAX_BYLINE_AUTHORS } from './config'

const TRACKING_PARAMS =
  /^(utm_|fbclid|gclid|gad_source|mc_|ref_|s_|source|medium|campaign|dclid|twclid|li_fat_id|igshid)/i

function stripTrackingParams(href: string): string {
  try {
    const u = new URL(href)
    u.search = new URLSearchParams(
      Array.from(u.searchParams).filter(([k]) => !TRACKING_PARAMS.test(k)),
    ).toString()
    return u.toString()
  } catch {
    return href
  }
}

export function extractSubtitle(doc: Document): string | null {
  const selectors = [
    '[data-qa="subheadline"]',
    '[data-testid="subheadline"]',
    '[class*="subheadline"]',
    '[class*="standfirst"]',
    '.article__subtitle',
    '.article-summary',
    '.article__lead',
    '[class*="article-dek"]',
    '[class*="dek"]',
  ]
  for (const sel of selectors) {
    const el = doc.querySelector(sel)
    if (el) {
      const text = el.textContent?.trim() ?? ''
      if (text.length > 20 && text.length < 500) return text
    }
  }
  return null
}

const SOURCE_LABEL = /^(quelle|source[s]?|via|fuente|fonte|bron)\s*:/i
function removeBylineWrapper(el: Element): void {
  let ancestor: Element | null = el.parentElement
  while (ancestor) {
    const tag = ancestor.tagName
    if (tag === 'ARTICLE' || tag === 'BODY' || tag === 'MAIN' || tag === 'HTML') break
    const text = (ancestor.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (text.length > 300) break
    if (SOURCE_LABEL.test(text) || /metadata[_-]?source/i.test(ancestor.className)) {
      ancestor.remove()
      return
    }
    ancestor = ancestor.parentElement
  }
}

function extractJsonLdAuthor(doc: Document): string | null {
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data: unknown = JSON.parse(script.textContent ?? '')
      const nodes: unknown[] = Array.isArray(data)
        ? data
        : (data as Record<string, unknown>)['@graph']
          ? ((data as Record<string, unknown>)['@graph'] as unknown[])
          : [data]
      for (const node of nodes) {
        if (typeof node !== 'object' || node === null) continue
        const author = (node as Record<string, unknown>)['author']
        if (!author) continue
        const authors = Array.isArray(author) ? author : [author]
        const names = authors
          .map((a): unknown => {
            if (typeof a === 'string') return a
            if (typeof a === 'object' && a !== null) return (a as Record<string, unknown>)['name']
            return null
          })
          .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
          .map((n) => n.trim())
        if (names.length) {
          const display = names.slice(0, MAX_BYLINE_AUTHORS)
          return names.length > MAX_BYLINE_AUTHORS ? display.join(', ') + ' et al.' : display.join(', ')
        }
      }
    } catch {
      // malformed JSON-LD — skip
    }
  }
  return null
}

const cleanBylinePart = (s: string) =>
  s
    .replace(/([a-z])([A-Z])/g, '$1 $2') // fix label+name concatenation e.g. "VonLeah" → "Von Leah"
    .replace(/\s+/g, ' ')
    .replace(/^\s*(written\s+by|by|von|par|por|di|van|av|від|автор:?)\s+/i, '')
    .trim()

export function extractByline(doc: Document, readabilityByline: string | null): string | null {
  const jsonLdAuthor = extractJsonLdAuthor(doc)
  if (jsonLdAuthor) return jsonLdAuthor

  const selectors = [
    'meta[property="article:author"]',
    'meta[name="author"]',
    '[itemprop="author"]',
    '[rel="author"]',
    '[data-tb-author]',
    '[class*="author" i] a[href*="/author/"], [class*="byline" i] a[href*="/author/"]',
    '[class*="authorName" i]',
    '[class*="author-name" i]',
    '[class*="author_name" i]',
  ]
  for (const sel of selectors) {
    const els = Array.from(doc.querySelectorAll(sel))
    if (!els.length) continue
    let text: string
    if (els[0] instanceof HTMLMetaElement) {
      text = els[0].content
    } else if (els.length > 1 && els.every((el) => (el.textContent?.trim().length ?? 0) < 100)) {
      text = els
        .map((el) => el.textContent?.trim() ?? '')
        .filter(Boolean)
        .join(', ')
    } else {
      const el = els[0]
      const lis = Array.from(el.querySelectorAll('li'))
      text =
        lis.length > 1
          ? lis
              .map((li) => li.textContent?.trim() ?? '')
              .filter(Boolean)
              .join(', ')
          : (el.textContent?.trim() ?? '')
    }
    const parts = text
      .split(/[ \t]{2,}|\n+/)
      .map(cleanBylinePart)
      .filter(Boolean)
    const cleaned = parts.join('\n')
    if (
      cleaned &&
      !/^(see|view|read|visit|go to|about|more)\b/i.test(cleaned) &&
      !/^https?:\/\//i.test(cleaned)
    ) {
      if (!(els[0] instanceof HTMLMetaElement)) removeBylineWrapper(els[0])
      return cleaned.slice(0, 200)
    }
  }
  if (readabilityByline) {
    const firstLine = readabilityByline.split(/\n/)[0]
    const parts = firstLine
      .split(/[ \t]{2,}/)
      .map(cleanBylinePart)
      .filter(Boolean)
    const cleaned = parts.join('\n')
    if (cleaned && !/^(see|view|read|visit|go to|about|more)\b/i.test(cleaned)) return cleaned.slice(0, 200)
  }
  return null
}

function extractRawDateFromHead(doc: Document): string | null {
  const metaSelectors = [
    'meta[property="article:published_time"]',
    'meta[name="article:published_time"]',
    'meta[property="og:published_time"]',
    'meta[name="dc.date"]',
    'meta[name="date"]',
  ]
  for (const sel of metaSelectors) {
    const val = doc.querySelector(sel)?.getAttribute('content')
    if (val) return val
  }
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try {
      const data = JSON.parse(script.textContent ?? '') as Record<string, unknown>
      const entries: Record<string, unknown>[] = Array.isArray(data)
        ? (data as Record<string, unknown>[])
        : [data]
      for (const entry of entries) {
        if (Array.isArray(entry['@graph'])) entries.push(...(entry['@graph'] as Record<string, unknown>[]))
        const val = (entry.datePublished ?? entry.dateModified) as string | undefined
        if (val) return val
      }
    } catch {}
  }
  return null
}

export function extractHeadData(doc: Document): { preDate: string | null; preAuthor: string | null } {
  return { preDate: extractRawDateFromHead(doc), preAuthor: extractJsonLdAuthor(doc) }
}

export function extractDate(
  doc: Document,
  lang: string,
  preDate?: string | null,
  readabilityDate?: string | null,
): { formatted: string; datetime: string } | null {
  const toResult = (d: Date) => {
    if (isNaN(d.getTime())) return null
    return {
      formatted: d.toLocaleDateString(lang, { year: 'numeric', month: 'long', day: 'numeric' }),
      datetime: d.toISOString().slice(0, 10),
    }
  }

  const normalizeRaw = (raw: string): string => {
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.replace(' ', 'T')
    return raw
      .replace(/\s+\d{1,2}:\d{2}.*$/, '') // strip time-of-day suffix
      .replace(/\b([A-Za-z]{3,})\./, '$1') // "Feb." → "Feb"
      .trim()
  }

  const tryRaw = (raw: string | null | undefined) => {
    if (!raw) return null
    return toResult(new Date(normalizeRaw(raw)))
  }

  const r = tryRaw(preDate ?? readabilityDate)
  if (r) return r

  for (const scope of ['article header', 'header', 'article', '']) {
    const sel = scope ? `${scope} time` : 'time'
    const times = Array.from(doc.querySelectorAll<HTMLTimeElement>(sel))
    const results = times
      .map((el) => tryRaw(el.getAttribute('datetime') ?? el.textContent?.trim()))
      .filter(Boolean) as { formatted: string; datetime: string }[]
    const unique = new Set(results.map((r) => r.formatted))
    if (unique.size === 1) return results[0]
  }

  return null
}

const AUTHOR_SEP = /\s*[·|]\s*|\s+[—–-]\s+/

function stripAuthorFromTitle(title: string, author: string | null): string {
  if (!author) return title
  const esc = author.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const sep = `(?:${AUTHOR_SEP.source})`
  const prefix = new RegExp(`^${esc}${sep}`, 'i')
  if (prefix.test(title)) return title.replace(prefix, '')
  const suffix = new RegExp(`${sep}${esc}\\s*$`, 'i')
  if (suffix.test(title)) return title.replace(suffix, '')
  return title
}

function stripSiteName(title: string): string {
  const separators = [' | ', ' — ', ' – ', ' - ']
  for (const sep of separators) {
    const idx = title.lastIndexOf(sep)
    if (idx > 0 && title.slice(0, idx).length >= title.slice(idx + sep.length).length) {
      return title.slice(0, idx)
    }
  }
  return title
}

export function extractArticle(
  clone: Document,
  headData?: { preDate: string | null; preAuthor: string | null },
): Article | null {
  const article = new Readability(clone).parse()
  if (!article?.content) return null
  const lang = (article.lang ?? document.documentElement.lang) || 'en'
  const author = headData?.preAuthor ?? extractByline(clone, article.byline ?? null)
  const date = extractDate(clone, lang, headData?.preDate, article.publishedTime)
  let byline: string | null = null
  const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const authorHtml = author ? escHtml(author).replace(/\n/g, '<br>') : null
  if (authorHtml && date)
    byline =
      '<p>' +
      authorHtml +
      '</p><p><time datetime="' +
      date.datetime +
      '" class="whitespace-nowrap">' +
      date.formatted +
      '</time></p>'
  else if (authorHtml) byline = authorHtml
  else if (date)
    byline = '<p class="ml-auto"><time datetime="' + date.datetime + '">' + date.formatted + '</time></p>'
  return {
    title: stripAuthorFromTitle(stripSiteName(article.title ?? ''), author),
    subtitle: extractSubtitle(clone),
    author,
    byline,
    date: date?.datetime ?? null,
    sourceUrl: stripTrackingParams(document.location.href),
    content: article.content,
    lang,
  }
}

export function buildArticleContent(article: Article, ledeHTML: string | null = null): string {
  const extractedDiv = document.createElement('div')
  extractedDiv.innerHTML = article.content
  if (ledeHTML) {
    const tmp = document.createElement('div')
    tmp.innerHTML = ledeHTML
    const figEl = tmp.firstElementChild
    if (figEl) {
      const firstP = extractedDiv.querySelector('p')
      if (firstP) firstP.before(figEl)
      else extractedDiv.prepend(figEl)
    }
  }
  postprocess(extractedDiv)
  removeRedundantHeading(extractedDiv, article.title, article.subtitle, article.author)
  return extractedDiv.innerHTML
}
