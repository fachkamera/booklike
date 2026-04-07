function isFullyClipped(style: CSSStyleDeclaration): boolean {
  if (style.clip && style.clip !== 'auto') {
    if (style.clip.includes('rect(0') && style.clip.includes('0')) {
      return true
    }
  }

  if (style.clipPath) {
    const cp = style.clipPath.replace(/\s+/g, '')
    if (cp === 'inset(50%)') return true
    if (cp === 'inset(100%)') return true
    if (cp === 'inset(0)' || cp === 'none') return false
  }

  return false
}

export default function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false

  const style = window.getComputedStyle(el)
  const { display, visibility, overflow, opacity } = style

  if (display === 'none') return false
  if (visibility === 'hidden' || visibility === 'collapse') return false

  if (parseFloat(opacity) === 0) return false

  if (isFullyClipped(style)) return false

  if (display === 'contents') return true

  const rect = el.getBoundingClientRect()
  if (rect.width === 0) return false
  // height:0 alone is unreliable, float containers collapse to height:0, floated children remain visible
  if (rect.height === 0 && overflow !== 'visible') return false
  if (rect.width <= 1 && rect.height <= 1 && overflow === 'hidden') return false

  return true
}
