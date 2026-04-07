export function createLightbox(deps: { doc: Document; iframe: HTMLIFrameElement; container: HTMLElement }) {
  const { doc, iframe, container } = deps

  const overlay = doc.createElement('div')
  overlay.setAttribute('inert', '')
  overlay.className = 'fixed inset-0 z-[200] cursor-zoom-out'
  overlay.style.cssText = 'opacity:0;pointer-events:none'

  const backdrop = doc.createElement('div')
  backdrop.className = 'absolute inset-0 bg-black/85'
  backdrop.style.cssText = 'opacity:0'

  const imgEl = doc.createElement('img')
  imgEl.alt = ''
  imgEl.style.cssText = 'position:absolute;object-fit:contain;will-change:transform'

  const captionEl = doc.createElement('p')
  captionEl.className = 'absolute font-sans text-sm text-center text-white/80 leading-snug'
  captionEl.style.cssText = 'opacity:0;transition:none'

  overlay.append(backdrop, imgEl, captionEl)
  doc.body.appendChild(overlay)

  let activeImg: HTMLImageElement | null = null
  let openState: {
    finalLeft: number
    finalTop: number
    finalW: number
    finalH: number
    scale: number
  } | null = null

  function noMotion(): boolean {
    return !!iframe.contentWindow?.matchMedia('(prefers-reduced-motion: reduce)').matches
  }

  function open(img: HTMLImageElement): void {
    activeImg = img

    imgEl.src = img.currentSrc || img.src

    const box = img.getBoundingClientRect()
    const { contentWindow } = iframe
    if (!contentWindow) throw new Error('iframe contentWindow unavailable')

    const naturalAspect = img.naturalWidth / img.naturalHeight
    const boxAspect = box.width / box.height
    let visW: number, visH: number
    if (contentWindow.getComputedStyle(img).objectFit === 'contain' && naturalAspect !== boxAspect) {
      if (naturalAspect < boxAspect) {
        visH = box.height
        visW = box.height * naturalAspect
      } else {
        visW = box.width
        visH = box.width / naturalAspect
      }
    } else {
      visW = box.width
      visH = box.height
    }
    const rect = {
      left: box.left + (box.width - visW) / 2,
      top: box.top + (box.height - visH) / 2,
      width: visW,
      height: visH,
    }
    const vw = contentWindow.innerWidth
    const vh = contentWindow.innerHeight
    const rem = parseFloat(contentWindow.getComputedStyle(doc.documentElement).fontSize)
    const pad = 2 * rem

    const captionText = img.closest('figure')?.querySelector('figcaption')?.textContent?.trim() ?? ''
    captionEl.textContent = captionText
    captionEl.style.display = captionText ? '' : 'none'

    const availW = vw - 2 * pad
    const captionGap = rem * 0.75

    let captionReserve = 0
    if (captionText) {
      captionEl.style.width = availW + 'px'
      captionReserve = captionEl.scrollHeight + captionGap
    }

    const availH = vh - 2 * pad - captionReserve
    const scale = Math.min(availW / rect.width, availH / rect.height)
    const finalW = rect.width * scale
    const finalH = rect.height * scale

    if (captionText) {
      captionEl.style.width = finalW + 'px'
      captionReserve = captionEl.scrollHeight + captionGap
    }

    const fullAvailH = vh - 2 * pad
    const blockH = finalH + captionReserve
    const finalLeft = (vw - finalW) / 2
    const finalTop = pad + (fullAvailH - blockH) / 2

    openState = { finalLeft, finalTop, finalW, finalH, scale }

    const skipMotion = noMotion()

    Object.assign(imgEl.style, {
      width: finalW + 'px',
      height: finalH + 'px',
      left: finalLeft + 'px',
      top: finalTop + 'px',
      transition: 'none',
      transform: 'none',
    })

    if (captionText) {
      Object.assign(captionEl.style, {
        top: finalTop + finalH + rem * 0.75 + 'px',
        left: finalLeft + 'px',
        width: finalW + 'px',
        opacity: '0',
        transition: 'none',
      })
    }

    const dx = rect.left + rect.width / 2 - (finalLeft + finalW / 2)
    const dy = rect.top + rect.height / 2 - (finalTop + finalH / 2)

    if (!skipMotion) {
      imgEl.style.transform = `translate(${dx}px, ${dy}px) scale(${1 / scale})`
    }

    overlay.removeAttribute('inert')
    overlay.style.pointerEvents = 'auto'
    overlay.style.opacity = '1'
    img.style.opacity = '0'

    const startAnimation = () => {
      if (activeImg !== img) return
      imgEl.getBoundingClientRect()
      requestAnimationFrame(() => {
        if (!skipMotion) {
          imgEl.style.transition = 'transform 0.35s var(--ease-out-expo)'
          imgEl.style.transform = 'none'
        }
        backdrop.style.transition = skipMotion ? 'none' : 'opacity 0.25s var(--ease-out-expo)'
        backdrop.style.opacity = '1'
        if (captionText) {
          captionEl.style.transition = skipMotion ? 'none' : 'opacity 0.8s 0.2s var(--ease-out-expo)'
          captionEl.style.opacity = '1'
        }
      })
    }

    imgEl.decode().then(startAnimation).catch(startAnimation)
  }

  function close(): void {
    if (!activeImg) return
    const img = activeImg
    const state = openState
    activeImg = null
    openState = null

    overlay.style.pointerEvents = 'none'
    overlay.setAttribute('inert', '')
    captionEl.style.transition = 'opacity 0.15s var(--ease-out-expo)'
    captionEl.style.opacity = '0'

    if (!state || noMotion()) {
      overlay.style.opacity = '0'
      backdrop.style.opacity = '0'
      img.style.opacity = ''
      return
    }

    const rect = img.getBoundingClientRect()
    const dx = rect.left + rect.width / 2 - (state.finalLeft + state.finalW / 2)
    const dy = rect.top + rect.height / 2 - (state.finalTop + state.finalH / 2)

    imgEl.style.transition = 'transform 0.35s var(--ease-out-expo)'
    imgEl.style.transform = `translate(${dx}px, ${dy}px) scale(${1 / state.scale})`

    backdrop.style.transition = 'opacity 0.25s var(--ease-out-expo)'
    backdrop.style.opacity = '0'

    imgEl.addEventListener(
      'transitionend',
      () => {
        if (activeImg !== null) return
        overlay.style.opacity = '0'
        backdrop.style.transition = 'none'
        imgEl.style.transition = 'none'
        imgEl.style.transform = 'none'
        img.style.opacity = ''
      },
      { once: true },
    )
  }

  const ac = new AbortController()
  const { signal } = ac

  overlay.addEventListener('click', close, { signal })

  container.querySelectorAll<HTMLImageElement>('img').forEach((img) => {
    img.style.cursor = 'zoom-in'
    img.style.pointerEvents = 'auto'
    img.addEventListener(
      'click',
      (e) => {
        e.stopPropagation()
        open(img)
      },
      { signal },
    )
  })

  function destroy(): void {
    ac.abort()
    overlay.remove()
  }

  return { close, destroy, isVisible: () => !!activeImg }
}
