import { IMAGE_LOAD_TIMEOUT, IMAGE_LOAD_SETTLE_MS } from './config'

export function closestSrcsetUrl(srcset: string, targetW: number): string | null {
  const entries = srcset
    .split(',')
    .map((entry) => {
      const parts = entry.trim().split(/\s+/)
      return { url: parts[0], w: parseInt(parts[1] ?? '0', 10) || 0 }
    })
    .filter((e) => e.url)
  if (!entries.length) return null
  const candidates = entries.filter((e) => e.w >= targetW)
  const pick = candidates.length
    ? candidates.reduce((a, b) => (a.w < b.w ? a : b))
    : entries.reduce((a, b) => (a.w > b.w ? a : b))
  return pick.url
}

export function triggerLazyImages(): void {
  document.querySelectorAll<HTMLImageElement>('img[loading="lazy"]').forEach((img) => {
    img.removeAttribute('loading')
  })

  document
    .querySelectorAll<HTMLElement>('img[data-src], img[data-srcset], source[data-srcset]')
    .forEach((el) => {
      const dataSrc = el.getAttribute('data-src')
      if (dataSrc && !el.getAttribute('src')) el.setAttribute('src', dataSrc)
      el.removeAttribute('data-src')
      const dataSrcset = el.getAttribute('data-srcset')
      if (dataSrcset && !el.getAttribute('srcset')) el.setAttribute('srcset', dataSrcset)
      el.removeAttribute('data-srcset')
      const dataSizes = el.getAttribute('data-sizes')
      if (dataSizes && !el.getAttribute('sizes')) el.setAttribute('sizes', dataSizes)
      el.removeAttribute('data-sizes')
    })

  document.querySelectorAll('noscript').forEach((ns) => {
    const html = ns.textContent ?? ''
    if (!/<img[\s>]/i.test(html)) return

    const figure = ns.closest('figure') ?? ns.parentElement
    const hasExistingImage = figure
      ? Array.from(figure.querySelectorAll<HTMLImageElement>('img')).some((img) => img !== ns && !!img.src)
      : false
    if (hasExistingImage) {
      ns.remove()
      return
    }

    const tmp = document.createElement('div')
    tmp.innerHTML = html

    const figures = tmp.querySelectorAll(':scope > figure')
    const pictures = tmp.querySelectorAll(':scope > picture')
    const imgs = tmp.querySelectorAll(':scope > img')
    const nodes = Array.from(figures.length ? figures : pictures.length ? pictures : imgs)

    if (!nodes.length) return
    nodes.forEach((node) => ns.before(node))
    ns.remove()
  })
}

export function stampLazyImages(): HTMLImageElement[] {
  const marked: HTMLImageElement[] = []
  document.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    if (!img.closest('article, main, [role="main"]')) return
    if (img.getAttribute('loading') === 'lazy' || (!img.getAttribute('src') && !img.getAttribute('srcset'))) {
      img.dataset.booklikeLazy = ''
      marked.push(img)
    }
  })
  return marked
}

export function clearLazyCSS(lazyImgs: HTMLImageElement[]): void {
  lazyImgs.forEach((img) => {
    let parent = img.parentElement
    while (parent) {
      if (parent.tagName === 'FIGURE') break
      if (parent.matches('article, main, [role="main"]')) break
      if (parent.tagName === 'PICTURE') {
        parent.removeAttribute('style')
        parent.className = ''
      }
      parent = parent.parentElement
    }
    const { display, opacity, visibility } = getComputedStyle(img)
    const { width, height } = img.getBoundingClientRect()
    if (
      parseFloat(opacity) === 0 ||
      visibility === 'hidden' ||
      display === 'none' ||
      width === 0 ||
      height === 0
    ) {
      img.removeAttribute('style')
      img.className = ''
    }
  })
}

export async function waitForImages(keptSrcs: Set<string>): Promise<void> {
  const imgs = Array.from(document.querySelectorAll<HTMLImageElement>('img'))
  const pending = imgs.filter((img) => {
    if (img.complete) return false
    const src = img.getAttribute('src') ?? img.getAttribute('data-src') ?? ''
    if (src && !keptSrcs.has(src)) return false
    const rect = img.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) return false
    return true
  })
  if (pending.length > 0) {
    await new Promise<void>((resolve) => {
      let remaining = pending.length
      const done = () => {
        if (--remaining <= 0) resolve()
      }
      pending.forEach((img) => {
        img.addEventListener('load', done, { once: true })
        img.addEventListener('error', done, { once: true })
      })
      setTimeout(resolve, IMAGE_LOAD_TIMEOUT)
    })
  }
  await new Promise<void>((resolve) => setTimeout(resolve, IMAGE_LOAD_SETTLE_MS))
}
