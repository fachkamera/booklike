import { DICT_MIN_CHARS } from '../config'

interface DictDefinition {
  definition: string
  example?: string
  synonyms: string[]
  antonyms: string[]
}

interface DictMeaning {
  partOfSpeech: string
  definitions: DictDefinition[]
}

interface DictPhonetic {
  text?: string
  audio?: string
}

interface DictEntry {
  word: string
  phonetic?: string
  phonetics: DictPhonetic[]
  meanings: DictMeaning[]
}

function isValidEntry(x: unknown): x is DictEntry {
  return (
    typeof x === 'object' &&
    x !== null &&
    'word' in x &&
    typeof (x as DictEntry).word === 'string' &&
    'meanings' in x &&
    Array.isArray((x as DictEntry).meanings)
  )
}

const DICT_POPOVER_BASE =
  'fixed z-[200] w-128 rounded-2xl border border-stone-200 bg-white/80 font-sans text-black shadow-xl backdrop-blur-lg dark:border-stone-800 dark:bg-black/80 dark:text-white transition-[opacity,transform,filter] duration-[180ms] ease-out-expo'

export function createDictionary(deps: { doc: Document; iframe: HTMLIFrameElement; lang: string }) {
  const { doc, iframe, lang } = deps

  const dictPopover = doc.createElement('div')

  const dictLoader = doc.createElement('div')
  dictLoader.className = 'dict-loader'
  dictLoader.style.cssText =
    'position:fixed;z-index:201;display:flex;gap:5px;align-items:center;opacity:0;pointer-events:none;transform:translate(-50%,0)'
  for (let i = 0; i < 3; i++) {
    const dot = doc.createElement('div')
    dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:currentColor;flex-shrink:0'
    dictLoader.appendChild(dot)
  }
  doc.body.appendChild(dictLoader)

  let enabled = true
  let dictVisible = false
  let stopDictAudio: (() => void) | null = null
  let dictAnchorX = 0
  let dictAnchorY = 0
  let loaderAnims: Animation[] = []
  const dictCache = new Map<string, DictEntry[] | null>()

  function showLoader(): void {
    const loaderRect = doc.getSelection()?.rangeCount
      ? (Array.from(doc.getSelection()!.getRangeAt(0).getClientRects())[0] ?? null)
      : null
    const loaderX = loaderRect ? loaderRect.left + loaderRect.width / 2 : dictAnchorX
    const anchorY = loaderRect ? loaderRect.bottom : dictAnchorY
    Object.assign(dictLoader.style, {
      left: loaderX + 'px',
      top: `${anchorY + 2}px`,
      opacity: '1',
    })
    loaderAnims.forEach((a) => a.cancel())
    loaderAnims = Array.from(dictLoader.children).map((dot, i) =>
      dot.animate(
        [
          { transform: 'scale(0.5)', opacity: '0.25' },
          { transform: 'scale(1)', opacity: '1' },
          { transform: 'scale(0.5)', opacity: '0.25' },
        ],
        { duration: 900, delay: i * 220, iterations: Infinity, easing: 'ease-in-out' },
      ),
    )
  }

  function hideLoader(): void {
    dictLoader.style.opacity = '0'
    loaderAnims.forEach((a) => a.cancel())
    loaderAnims = []
  }

  async function fetchDefinition(word: string): Promise<DictEntry[] | null> {
    const key = word.toLowerCase()
    if (dictCache.has(key)) return dictCache.get(key)!
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'booklike-dict-lookup',
        word: key,
      })) as { data: unknown }
      const data = res?.data
      const result =
        Array.isArray(data) && data.length > 0 && isValidEntry(data[0]) ? (data as DictEntry[]) : null
      dictCache.set(key, result)
      return result
    } catch (_) {
      return null
    }
  }

  function revealDictPopover(): void {
    dictPopover.remove()
    dictPopover.removeAttribute('style')
    dictPopover.className = DICT_POPOVER_BASE
    Object.assign(dictPopover.style, {
      opacity: '0',
      transform: 'scale(0.8)',
      filter: 'blur(4px)',
    })

    doc.body.appendChild(dictPopover)

    const { contentWindow } = iframe
    if (!contentWindow) throw new Error('iframe contentWindow unavailable')

    const vw = contentWindow.innerWidth
    const vh = contentWindow.innerHeight
    const pw = dictPopover.offsetWidth || 512
    const ph = dictPopover.offsetHeight || 160
    let left = dictAnchorX - pw / 2
    let top = dictAnchorY + 8
    left = Math.max(8, Math.min(left, vw - pw - 8))
    const isAbove = top + ph > vh - 8
    if (isAbove) top = dictAnchorY - ph - 34
    const originX = Math.round(Math.max(0, Math.min(100, ((dictAnchorX - left) / pw) * 100)))
    Object.assign(dictPopover.style, {
      left: left + 'px',
      top: Math.max(8, top) + 'px',
      transformOrigin: `${originX}% ${isAbove ? '100%' : '0%'}`,
    })

    void dictPopover.offsetWidth

    requestAnimationFrame(() => {
      if (!dictVisible) return
      Object.assign(dictPopover.style, { opacity: '', transform: '', filter: '' })
    })

    doc.getElementById('dictAudioBtn')?.addEventListener('click', (e) => {
      e.stopPropagation()
      const url = (e.currentTarget as HTMLElement).dataset.url ?? ''
      if (!url) return
      if (stopDictAudio) {
        stopDictAudio()
        stopDictAudio = null
      }
      void chrome.runtime
        .sendMessage({ type: 'booklike-fetch-url', url })
        .then((res: { dataUrl: string | null }) => {
          if (!res?.dataUrl) return
          const b64 = res.dataUrl.split(',')[1]
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
          let ctx: AudioContext
          try {
            ctx = new AudioContext()
          } catch {
            return
          }
          void ctx.decodeAudioData(
            bytes.buffer,
            (buffer) => {
              const source = ctx.createBufferSource()
              source.buffer = buffer
              source.connect(ctx.destination)
              source.start(0)
              stopDictAudio = () => {
                source.stop()
                void ctx.close()
              }
            },
            () => {
              void ctx.close()
            },
          )
        })
        .catch(() => {})
    })
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function buildDictHTML(data: DictEntry[]): string {
    const entry = data[0]
    const phonetic = entry.phonetics?.find((p) => p.text)?.text ?? entry.phonetic ?? ''
    const audioEntry = entry.phonetics?.find((p) => p.audio)
    const audioUrl: string | null = audioEntry?.audio
      ? audioEntry.audio.startsWith('//')
        ? 'https:' + audioEntry.audio
        : audioEntry.audio
      : null

    let html = '<div class="px-4 pt-3 pb-2">'
    html += '<div class="flex items-center gap-2 mb-3">'
    html += `<span class="font-bold text-sm">${esc(entry.word)}</span>`
    if (audioUrl) {
      html += `<button id="dictAudioBtn" aria-label="Play pronunciation" data-url="${audioUrl}" class="flex shrink-0 items-center justify-center size-8  rounded-full text-yellow-600 hover:bg-white hover:shadow dark:text-yellow-400 dark:hover:bg-stone-850 dark:hover:shadow-bevel"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-4"><path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z"/><path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z"/></svg></button>`
    }
    if (phonetic) html += `<span class="font-mono text-xs opacity-50">${esc(phonetic)}</span>`
    html += '</div>'

    const meanings: DictMeaning[] = entry.meanings ?? []
    html += '<div class="flex flex-col divide-y divide-current/10 text-xs">'
    meanings.slice(0, 3).forEach((m) => {
      html += '<div class="py-2">'
      html += `<div class="mb-1.5 text-[0.6rem] uppercase tracking-widest opacity-50">${esc(m.partOfSpeech)}</div>`
      html += '<ol class="flex flex-col gap-1.5">'
      m.definitions.slice(0, 3).forEach((d, i) => {
        html += `<li class="flex gap-1.5 leading-relaxed"><span class="shrink-0 opacity-40">${i + 1}.</span><span>${esc(d.definition)}`
        if (d.example) html += `<em class="block mt-0.5 not-italic opacity-50">"${esc(d.example)}"</em>`
        html += '</span></li>'
      })
      html += '</ol></div>'
    })
    html += '</div></div>'
    return html
  }

  function close(): void {
    const wasVisible = dictVisible
    dictVisible = false
    dictPopover.remove()
    if (!wasVisible) return
    hideLoader()
    if (stopDictAudio) {
      stopDictAudio()
      stopDictAudio = null
    }
    doc.getSelection()?.removeAllRanges()
  }

  async function open(word: string): Promise<void> {
    dictVisible = true
    const anchorRange = doc.getSelection()?.rangeCount ? doc.getSelection()!.getRangeAt(0) : null
    const anchorRect = anchorRange ? (Array.from(anchorRange.getClientRects())[0] ?? null) : null
    dictAnchorX = anchorRect ? anchorRect.left + anchorRect.width / 2 : 0
    dictAnchorY = anchorRect ? anchorRect.bottom : 0

    const cached = dictCache.has(word.toLowerCase())
    if (!cached) showLoader()
    const data = await fetchDefinition(word)
    if (!cached) hideLoader()
    if (!dictVisible) return

    dictPopover.innerHTML = data?.length
      ? buildDictHTML(data)
      : `<div class="px-4 py-3 text-xs opacity-50">No definition found for "<em>${word}</em>".</div>`
    revealDictPopover()
  }

  doc.addEventListener('mouseup', (e) => {
    if (!enabled || e.button !== 0 || !lang.startsWith('en') || dictVisible) return
    const sel = doc.getSelection()
    const text = sel ? sel.toString().trim() : ''
    if (text && text.length >= DICT_MIN_CHARS && !/\s/.test(text) && !/^https?:\/\//i.test(text))
      void open(text)
  })

  function setEnabled(value: boolean): void {
    enabled = value
    if (!value) close()
  }

  return { open, close, isVisible: () => dictVisible, popover: dictPopover, setEnabled }
}
