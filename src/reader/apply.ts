import type { DisplayCtx } from '../types'
import {
  FONT_CLASSES,
  FONT_SIZE_MAP,
  LINE_HEIGHT_MAP,
  TEXT_ALIGN_MAP,
  MARGIN_MAP,
  LETTER_SPACING_MAP,
  HYPHENS_MAP,
} from './settings'

const MARGIN_X_MAP: Record<string, string> = {
  narrow: 'inset-x-8',
  medium: 'inset-x-12',
  wide: 'inset-x-16',
}

function resolveTheme(ctx: DisplayCtx): string {
  if (ctx.state.theme === 'auto') return ctx.prefersDark.matches ? 'dark' : 'light'
  return ctx.state.theme
}

function swapClass(el: Element, map: Record<string, string>, key: string, fallback: string): void {
  Object.values(map).forEach((c) => el.classList.remove(c))
  el.classList.add(map[key] || map[fallback])
}

export function applyTheme(ctx: DisplayCtx): void {
  ctx.doc.documentElement.classList.toggle('dark', resolveTheme(ctx) === 'dark')
}

export function applyDisplayMode(ctx: DisplayCtx): void {
  const { doc, state } = ctx
  doc.documentElement.classList.toggle('display-dark', state.displayMode === 'dark')
  doc.documentElement.classList.toggle('high-contrast', state.highContrast)
}

export function applyFont(ctx: DisplayCtx): void {
  const { display, state } = ctx
  swapClass(display, FONT_CLASSES, state.font, 'literata')
  applyLineHeight(ctx)
  applyLetterSpacing(ctx)
}

export function applyFontSize(ctx: DisplayCtx): void {
  swapClass(ctx.display, FONT_SIZE_MAP, ctx.state.fontSize, 'large')
}

export function applyLineHeight(ctx: DisplayCtx): void {
  const { display } = ctx
  swapClass(display, LINE_HEIGHT_MAP, ctx.state.lineHeight, 'normal')
}

export function applyLetterSpacing(ctx: DisplayCtx): void {
  const { display, state } = ctx
  Object.values(LETTER_SPACING_MAP).forEach((m) =>
    Object.values(m).forEach((c) => display.classList.remove(c)),
  )
  const map = LETTER_SPACING_MAP[state.font] || LETTER_SPACING_MAP._default
  display.classList.add(map[state.letterSpacing] || map.normal)
}

export function applyTextAlign(ctx: DisplayCtx): void {
  swapClass(ctx.display, TEXT_ALIGN_MAP, ctx.state.textAlign, 'justify')
}

export function applyMargin(ctx: DisplayCtx): void {
  const { wrapper, pageIndicator, state } = ctx
  swapClass(wrapper, MARGIN_MAP, state.margin, 'medium')
  swapClass(pageIndicator, MARGIN_X_MAP, state.margin, 'medium')
}

export function applyHyphens(ctx: DisplayCtx): void {
  swapClass(ctx.display, HYPHENS_MAP, ctx.state.hyphens, 'auto')
}

export function applyLinks(ctx: DisplayCtx): void {
  const { doc, container, state } = ctx
  container
    .querySelectorAll(
      'a[href^="#"], a[href^="javascript:"], a[href=""], span[data-href^="#"], a:has(img), a:has(picture), figcaption a[href]',
    )
    .forEach((el) => {
      el.replaceWith(...Array.from(el.childNodes))
    })
  if (!state.preserveLinks) {
    container.querySelectorAll('a[href]').forEach((a) => {
      const span = doc.createElement('span')
      span.dataset.href = a.getAttribute('href') ?? ''
      while (a.firstChild) span.appendChild(a.firstChild)
      a.replaceWith(span)
    })
  } else {
    container.querySelectorAll<HTMLSpanElement>('span[data-href]').forEach((span) => {
      const a = doc.createElement('a')
      a.setAttribute('href', span.dataset.href ?? '')
      a.setAttribute('tabindex', '-1')
      while (span.firstChild) a.appendChild(span.firstChild)
      span.replaceWith(a)
    })
  }
}

export function applyImages(ctx: DisplayCtx): void {
  const { container, state } = ctx
  container.querySelectorAll('figure, img').forEach((el) => {
    el.classList.toggle('hidden', !state.showImages)
  })
}

export function applyAll(ctx: DisplayCtx): void {
  applyTheme(ctx)
  applyDisplayMode(ctx)
  applyFont(ctx)
  applyFontSize(ctx)
  applyTextAlign(ctx)
  applyMargin(ctx)
  applyHyphens(ctx)
  applyLinks(ctx)
  applyImages(ctx)
  ctx.measure()
}
