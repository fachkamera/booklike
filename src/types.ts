export interface Article {
  title: string
  subtitle: string | null
  author: string | null
  byline: string | null
  date: string | null
  sourceUrl: string
  content: string
  lang: string
}

export interface ReaderSettings {
  theme: string
  displayMode: string
  font: string
  fontSize: string
  lineHeight: string
  letterSpacing: string
  textAlign: string
  margin: string
  hyphens: string
  highContrast: boolean
  preserveLinks: boolean
  showImages: boolean
  epubImages: boolean
  epubLinks: boolean
  dictionary: boolean
}

export interface DisplayCtx {
  doc: Document
  iframe: HTMLIFrameElement
  state: ReaderSettings
  display: HTMLElement
  container: HTMLElement
  wrapper: HTMLElement
  bezel: HTMLElement
  pageIndicator: HTMLElement
  prefersDark: MediaQueryList
  measure: () => void
}

declare global {
  interface Window {
    __BOOKLIKE_ACTIVE__?: boolean
  }
}
