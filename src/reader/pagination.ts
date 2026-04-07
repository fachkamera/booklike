const COLUMN_GAP = 40
const IMAGE_HEIGHT_CAP = 0.87
const CODE_BLOCK_MAX_BREAK_RATIO = 0.4
const BLOCK_SELECTOR = 'p, h1, h2, h3, h4, h5, h6, blockquote, figure, pre'

function tryPushImageToFirstPage(
  container: HTMLElement,
  height: number,
  contentWindow: Window,
): { el: HTMLElement; img: HTMLImageElement } | null {
  const firstImgEl = container.querySelector<HTMLElement>('figure, img.w-full')
  const firstImg =
    firstImgEl instanceof HTMLImageElement
      ? firstImgEl
      : (firstImgEl?.querySelector<HTMLImageElement>('img') ?? null)
  if (!firstImgEl || !firstImg) return null

  const cr = container.getBoundingClientRect()
  if (firstImgEl.getBoundingClientRect().left - cr.left <= 0) return null

  let nearestPrev: HTMLElement | null = null
  let el: HTMLElement = firstImgEl
  while (el !== container) {
    let sib = el.previousElementSibling as HTMLElement | null
    while (sib) {
      if (sib.getBoundingClientRect().height > 0) {
        nearestPrev = sib
        break
      }
      sib = sib.previousElementSibling as HTMLElement | null
    }
    if (nearestPrev) break
    el = el.parentElement!
  }
  if (!nearestPrev) return null

  const headerH =
    nearestPrev.getBoundingClientRect().bottom -
    cr.top +
    (parseFloat(contentWindow.getComputedStyle(nearestPrev).marginBottom) || 0)
  const imgMarginTop = parseFloat(contentWindow.getComputedStyle(firstImgEl).marginTop) || 0
  const captionH = firstImgEl.querySelector('figcaption')?.getBoundingClientRect().height ?? 0
  const remaining = height - headerH - imgMarginTop - captionH - 16
  if (remaining <= height * 0.3) return null

  firstImg.style.maxHeight = Math.floor(remaining) + 'px'
  return { el: firstImgEl, img: firstImg }
}

export function createPagination(deps: {
  container: HTMLElement
  wrapper: HTMLElement
  iframe: HTMLIFrameElement
  pageNum: HTMLElement
  btnPagePrev: HTMLButtonElement
  btnPageNext: HTMLButtonElement
  onClosePopover: () => void
  onPageChange?: () => void
}) {
  const { container, wrapper, iframe, pageNum, btnPagePrev, btnPageNext, onClosePopover } = deps
  let columnWidth = 0
  let columnHeight = 0
  let totalPages = 1
  let currentPage = 0
  let cachedAnchor = 0

  function measure(onDone?: () => void): void {
    const { contentWindow } = iframe
    if (!contentWindow) throw new Error('iframe contentWindow unavailable')
    const width = wrapper.clientWidth
    const height = wrapper.clientHeight
    if (width <= 0 || height <= 0) return
    columnWidth = width
    columnHeight = height
    Object.assign(container.style, {
      columnWidth: width + 'px',
      columnGap: COLUMN_GAP + 'px',
      columnFill: 'auto',
      height: height + 'px',
    })

    const imgMaxH = Math.floor(height * IMAGE_HEIGHT_CAP) + 'px'
    container.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
      img.style.maxHeight = imgMaxH
      img.style.objectFit = 'contain'
    })

    container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
      pre.style.breakInside = 'avoid'
    })

    requestAnimationFrame(() => {
      container.querySelectorAll<HTMLElement>('pre').forEach((pre) => {
        if (pre.getBoundingClientRect().height > height * CODE_BLOCK_MAX_BREAK_RATIO) {
          pre.style.breakInside = ''
        }
      })

      const pushed = tryPushImageToFirstPage(container, height, contentWindow)

      container.querySelectorAll<HTMLTableElement>('table').forEach((table) => {
        if (!table.dataset.booklikeTableWidth && table.scrollWidth > 0) {
          table.dataset.booklikeTableWidth = String(table.scrollWidth)
        }
        const tableWidth = parseInt(table.dataset.booklikeTableWidth ?? '0', 10)
        if (tableWidth > columnWidth) {
          table.dataset.booklikeOverflow = ''
        } else {
          delete table.dataset.booklikeOverflow
        }
        if (!table.nextElementSibling?.classList.contains('booklike-table-placeholder')) {
          const p = document.createElement('p')
          p.className = 'booklike-table-placeholder'
          p.textContent = '[Table removed — too wide for reader view]'
          table.after(p)
        }
      })

      requestAnimationFrame(() => {
        const scrollW = container.scrollWidth
        const pageStep = columnWidth + COLUMN_GAP
        totalPages = Math.max(1, Math.ceil(scrollW / pageStep))

        if (pushed) {
          const cr = container.getBoundingClientRect()
          if (pushed.el.getBoundingClientRect().left - cr.left > 0) {
            pushed.img.style.maxHeight = imgMaxH
            totalPages = Math.max(1, Math.round(container.scrollWidth / pageStep))
          }
        }

        if (onDone) {
          onDone()
        } else {
          if (currentPage >= totalPages) currentPage = totalPages - 1
          applyPage()
        }
      })
    })
  }

  function applyPage(): void {
    container.style.transform = 'translateX(-' + currentPage * (columnWidth + COLUMN_GAP) + 'px)'
    pageNum.textContent = 'Page ' + (currentPage + 1) + ' of ' + totalPages
    btnPagePrev.disabled = currentPage <= 0
    btnPageNext.disabled = currentPage >= totalPages - 1
    deps.onPageChange?.()
  }

  function getAnchor(): number {
    const blocks = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    if (!blocks.length || columnWidth <= 0) return 0
    const pageStep = columnWidth + COLUMN_GAP
    for (let i = 0; i < blocks.length; i++) {
      if (Math.floor(blocks[i].offsetLeft / pageStep) >= currentPage) return i
    }
    return 0
  }

  function restoreAnchor(blockIndex: number): void {
    const blocks = Array.from(container.querySelectorAll<HTMLElement>(BLOCK_SELECTOR))
    const el = blocks[blockIndex] ?? blocks[0]
    if (!el || columnWidth <= 0) return
    const page = Math.floor(el.offsetLeft / (columnWidth + COLUMN_GAP))
    currentPage = Math.max(0, Math.min(page, totalPages - 1))
    cachedAnchor = blockIndex
    applyPage()
  }

  function goNext(): void {
    onClosePopover()
    if (currentPage < totalPages - 1) {
      currentPage++
      cachedAnchor = getAnchor()
      applyPage()
    }
  }

  function goPrev(): void {
    onClosePopover()
    if (currentPage > 0) {
      currentPage--
      cachedAnchor = getAnchor()
      applyPage()
    }
  }

  function goTo(page: number): void {
    currentPage = Math.max(0, Math.min(page, totalPages - 1))
    cachedAnchor = getAnchor()
    applyPage()
  }

  function getTotal(): number {
    return totalPages
  }

  function getCachedAnchor(): number {
    return cachedAnchor
  }

  function getPrintHeight(): number {
    return totalPages * columnHeight
  }

  return {
    measure,
    applyPage,
    goNext,
    goPrev,
    goTo,
    getTotal,
    getAnchor,
    getCachedAnchor,
    restoreAnchor,
    getPrintHeight,
  }
}
