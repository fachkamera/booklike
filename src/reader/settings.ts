import type { ReaderSettings } from '../types'

export const STORAGE_KEY = 'booklike-settings'

export const FONT_CLASSES: Record<string, string> = {
  literata: 'font-literata',
  garamond: 'font-garamond',
  inter: 'font-inter',
  spectral: 'font-spectral',
}

export const FONT_SIZE_MAP: Record<string, string> = {
  small: 'prose-sm',
  regular: 'prose-base',
  large: 'prose-lg',
  xlarge: 'prose-xl',
}

export const LINE_HEIGHT_MAP: Record<string, string> = {
  compact: 'leading-[1.625]',
  normal: 'leading-[1.875]',
  relaxed: 'leading-[2.125]',
}

export const TEXT_ALIGN_MAP: Record<string, string> = {
  left: 'prose-p:text-left',
  justify: 'prose-p:text-justify',
}

export const MARGIN_MAP: Record<string, string> = {
  narrow: 'inset-x-8',
  medium: 'inset-x-12',
  wide: 'inset-x-16',
}

export const LETTER_SPACING_MAP: Record<string, Record<string, string>> = {
  _default: {
    compact: 'tracking-tight',
    normal: 'tracking-normal',
    relaxed: 'tracking-wide',
  },
  spectral: {
    compact: 'tracking-[-0.035em]',
    normal: 'tracking-[-0.01em]',
    relaxed: 'tracking-[0.015em]',
  },
}

export const HYPHENS_MAP: Record<string, string> = {
  auto: 'hyphens-auto',
  none: 'hyphens-none',
}

export const defaults: ReaderSettings = {
  theme: 'auto',
  displayMode: 'light',
  font: 'spectral',
  fontSize: 'large',
  lineHeight: 'normal',
  letterSpacing: 'normal',
  textAlign: 'justify',
  margin: 'medium',
  hyphens: 'auto',
  highContrast: false,
  preserveLinks: true,
  showImages: true,
  epubImages: true,
  epubLinks: false,
  dictionary: true,
}

function pick<T extends string>(
  value: T | undefined,
  valid: readonly T[] | Record<T, unknown>,
  fallback: T,
): T {
  const keys = Array.isArray(valid) ? valid : (Object.keys(valid) as T[])
  return value && keys.includes(value) ? value : fallback
}

export async function loadSettings(state: ReaderSettings): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY)
    const s = stored[STORAGE_KEY] as Partial<ReaderSettings> | undefined
    if (!s) return
    state.theme = pick(s.theme, ['auto', 'light', 'dark'] as const, defaults.theme)
    state.displayMode = pick(s.displayMode, ['light', 'dark'] as const, defaults.displayMode)
    state.font = pick(s.font, FONT_CLASSES, defaults.font)
    state.fontSize = pick(s.fontSize, FONT_SIZE_MAP, defaults.fontSize)
    state.lineHeight = pick(s.lineHeight, LINE_HEIGHT_MAP, defaults.lineHeight)
    state.letterSpacing = pick(s.letterSpacing, LETTER_SPACING_MAP._default, defaults.letterSpacing)
    state.textAlign = pick(s.textAlign, TEXT_ALIGN_MAP, defaults.textAlign)
    state.margin = pick(s.margin, MARGIN_MAP, defaults.margin)
    state.hyphens = pick(s.hyphens, HYPHENS_MAP, defaults.hyphens)
    state.highContrast = s.highContrast ?? defaults.highContrast
    state.preserveLinks = s.preserveLinks ?? defaults.preserveLinks
    state.showImages = s.showImages ?? defaults.showImages
    state.epubImages = s.epubImages ?? defaults.epubImages
    state.epubLinks = s.epubLinks ?? defaults.epubLinks
    state.dictionary = s.dictionary ?? defaults.dictionary
  } catch (_) {}
}

export function saveSettings(state: ReaderSettings): void {
  chrome.storage.local
    .set({ [STORAGE_KEY]: state })
    .catch((e) => console.error('BookLike: failed to save settings', e)) // eslint-disable-line no-console
}

export function syncSettingsUI(doc: Document, state: ReaderSettings): void {
  const radios: [string, string][] = [
    ['theme', state.theme],
    ['display-mode', state.displayMode],
    ['font', state.font],
    ['font-size', state.fontSize],
    ['line-height', state.lineHeight],
    ['letter-spacing', state.letterSpacing],
    ['text-align', state.textAlign],
    ['margin', state.margin],
    ['hyphens', state.hyphens],
  ]
  for (const [name, value] of radios) {
    const el = doc.querySelector<HTMLInputElement>(`input[name="${name}"][value="${value}"]`)
    if (el) el.checked = true
  }
  const checkboxes: [string, boolean][] = [
    ['links', state.preserveLinks],
    ['images', state.showImages],
    ['contrast', state.highContrast],
    ['dictionary', state.dictionary],
  ]
  for (const [name, checked] of checkboxes) {
    const el = doc.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${name}"]`)
    if (el) el.checked = checked
  }
}

export function bindToggle(doc: Document, inputName: string, onChange: (checked: boolean) => void): void {
  const input = doc.querySelector<HTMLInputElement>(`input[type="checkbox"][name="${inputName}"]`)
  input?.addEventListener('change', () => onChange(input.checked))
}

export function bindSetting<K extends keyof ReaderSettings>(
  doc: Document,
  inputName: string,
  state: ReaderSettings,
  key: K,
  apply: () => void,
  extra?: () => void,
): void {
  doc.querySelectorAll<HTMLInputElement>(`input[name="${inputName}"]`).forEach((r) => {
    r.addEventListener('change', () => {
      state[key] = r.value as ReaderSettings[K]
      apply()
      saveSettings(state)
      extra?.()
    })
  })
}
