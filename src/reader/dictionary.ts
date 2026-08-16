import {
  DICT_AUDIO_CACHE_MAX,
  DICT_AUDIO_DEADLINE_MS,
  DICT_AUDIO_LOADING_DELAY_MS,
  DICT_AUDIO_MAX_MS,
  DICT_MAX_POS,
  DICT_MIN_CHARS,
  DICT_POPOVER_GAP_PX,
  DICT_POPOVER_MIN_HEIGHT_PX,
  DICT_POPOVER_VIEWPORT_MARGIN_PX,
  DICT_SPEECH_RATE,
  DICT_SPEECH_START_MS,
} from '../config'
import { audioUrl, posLabel, type AudioResponse, type DictResolved } from '../dict'

interface DictLookup {
  entry: DictResolved | null
  unreachable: boolean
}

function isValidEntry(x: unknown): x is DictResolved {
  return (
    typeof x === 'object' &&
    x !== null &&
    'w' in x &&
    typeof (x as DictResolved).w === 'string' &&
    'e' in x &&
    Array.isArray((x as DictResolved).e)
  )
}

/** Trailing/leading punctuation a drag picks up; inner hyphens and apostrophes survive. */
const EDGE_PUNCTUATION = /^[^\p{L}]+|[^\p{L}]+$/gu

/** The word shape the bundled dictionary indexes: one Latin token, hyphens and apostrophes allowed. */
const DICT_WORD = /^\p{L}[\p{L}'\u2019-]*$/u

function isMultiWord(text: string): boolean {
  return /\s/.test(text)
}

function containsNumber(text: string): boolean {
  return /\p{N}/u.test(text)
}

function isUrl(text: string): boolean {
  return /^https?:\/\//i.test(text)
}

function isMidWord(range: Range, selected: string): boolean {
  const { startContainer: sc, endContainer: ec } = range
  const start = range.startOffset + (selected.length - selected.trimStart().length)
  const end = range.endOffset - (selected.length - selected.trimEnd().length)
  const scText = sc.nodeType === Node.TEXT_NODE ? (sc.textContent ?? '') : null
  const ecText = ec.nodeType === Node.TEXT_NODE ? (ec.textContent ?? '') : null
  const before = scText && start <= scText.length ? scText.slice(start - 1, start) : ''
  const after = ecText && end >= 0 ? ecText.slice(end, end + 1) : ''
  return /\p{L}/u.test(before) || /\p{L}/u.test(after)
}

const SENTENCE_LEAD = /[\s"'“”‘’([«]+$/u
const SENTENCE_END = /[.!?…:;]$/u
const BLOCK_TAGS = 'p,li,dd,dt,td,th,blockquote,figcaption,h1,h2,h3,h4,h5,h6,section,article,div'

function hasDeliberateCapital(range: Range, word: string): boolean {
  if (!/^\p{Lu}/u.test(word)) return false
  const node = range.startContainer
  const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
  const block = parent?.closest(BLOCK_TAGS)
  if (!block) return false

  const probe = block.ownerDocument.createRange()
  try {
    probe.setStart(block, 0)
    probe.setEnd(node, range.startOffset)
  } catch (_) {
    return false
  }
  const before = probe.toString().replace(SENTENCE_LEAD, '')
  if (!before || SENTENCE_END.test(before)) return false
  return !/^\p{Lu}/u.test(before.split(/\s+/).pop() ?? '')
}

const DICT_POPOVER_CONTENT =
  'min-h-0 overflow-y-auto overscroll-none px-4 py-3 mask-y-from-[calc(100%-1rem)] mask-y-to-100%'

const DICT_POPOVER_BASE =
  'fixed z-200 flex w-128 flex-col overflow-hidden rounded-2xl border border-stone-200 bg-white/80 font-sans text-black shadow-xl backdrop-blur-lg dark:border-stone-800 dark:bg-black/80 dark:text-white transition-[opacity,transform,filter] duration-180 ease-out-expo'

export function createDictionary(deps: { doc: Document; iframe: HTMLIFrameElement; lang: string }) {
  const { doc, iframe, lang } = deps

  const dictPopover = doc.createElement('div')
  const dictContent = doc.createElement('div')
  dictContent.className = DICT_POPOVER_CONTENT
  dictPopover.appendChild(dictContent)

  let enabled = true
  let dictVisible = false
  let stopDictAudio: (() => void) | null = null
  let audioBusy = false
  let audioSeq = 0
  let audioTimer: ReturnType<typeof setTimeout> | null = null
  let audioDeadlineTimer: ReturnType<typeof setTimeout> | null = null
  let audioLoadingTimer: ReturnType<typeof setTimeout> | null = null
  let speechStartTimer: ReturnType<typeof setTimeout> | null = null
  let pendingVoices: (() => void) | null = null
  let audioBtnEl: HTMLElement | null = null
  let dictAnchorX = 0
  let dictAnchorTop = 0
  let dictAnchorBottom = 0
  const dictCache = new Map<string, DictResolved | null>()
  const audioCache = new Map<string, Promise<string | null>>()
  const audioDead = new Set<string>()

  function fetchAudio(url: string): Promise<string | null> {
    const cached = audioCache.get(url)
    if (cached) {
      audioCache.delete(url)
      audioCache.set(url, cached)
      return cached
    }
    const pending = chrome.runtime
      .sendMessage({ type: 'booklike-fetch-audio', url })
      .then((res: AudioResponse) => res ?? { audio: null, failure: 'transient' as const })
      .catch((): AudioResponse => ({ audio: null, failure: 'transient' }))
      .then(({ audio, failure }: AudioResponse) => {
        if (audio) return audio
        if (failure === 'permanent') markDead(url)
        audioCache.delete(url)
        return null
      })
    audioCache.set(url, pending)
    if (audioCache.size > DICT_AUDIO_CACHE_MAX) audioCache.delete(audioCache.keys().next().value!)
    return pending
  }

  function markDead(url: string): void {
    audioDead.add(url)
    if (audioDead.size > DICT_AUDIO_CACHE_MAX) audioDead.delete(audioDead.values().next().value!)
  }

  async function fetchDefinition(word: string, deliberateCapital: boolean): Promise<DictLookup> {
    const key = `${word}:${deliberateCapital ? 1 : 0}`
    if (dictCache.has(key)) return { entry: dictCache.get(key)!, unreachable: false }
    try {
      const res = (await chrome.runtime.sendMessage({
        type: 'booklike-dict-lookup',
        word,
        deliberateCapital,
      })) as { entry: unknown; unreachable: boolean }
      if (res?.unreachable) return { entry: null, unreachable: true }
      const entry = isValidEntry(res?.entry) ? res.entry : null
      dictCache.set(key, entry)
      return { entry, unreachable: false }
    } catch (_) {
      return { entry: null, unreachable: true }
    }
  }

  function revealDictPopover(): void {
    dictPopover.remove()
    dictPopover.removeAttribute('style')
    dictPopover.className = DICT_POPOVER_BASE
    dictContent.scrollTop = 0
    Object.assign(dictPopover.style, {
      opacity: '0',
      transform: 'scale(0.8)',
      filter: 'blur(4px)',
    })

    doc.body.appendChild(dictPopover)

    const { contentWindow } = iframe
    if (!contentWindow) {
      close()
      return
    }

    const vw = contentWindow.innerWidth
    const vh = contentWindow.innerHeight
    const pw = dictPopover.offsetWidth
    const ph = dictPopover.offsetHeight
    const gap = DICT_POPOVER_GAP_PX
    const margin = DICT_POPOVER_VIEWPORT_MARGIN_PX

    const spaceBelow = vh - dictAnchorBottom - gap - margin
    const spaceAbove = dictAnchorTop - gap - margin
    const isAbove = ph > spaceBelow && (ph <= spaceAbove || spaceAbove > spaceBelow)
    const available = Math.max(DICT_POPOVER_MIN_HEIGHT_PX, isAbove ? spaceAbove : spaceBelow)
    const height = Math.min(ph, available)

    const left = Math.max(margin, Math.min(dictAnchorX - pw / 2, vw - pw - margin))
    const anchored = isAbove ? dictAnchorTop - gap - height : dictAnchorBottom + gap
    const top = Math.max(margin, Math.min(anchored, vh - height - margin))
    const originX = Math.round(Math.max(0, Math.min(100, ((dictAnchorX - left) / pw) * 100)))
    Object.assign(dictPopover.style, {
      left: left + 'px',
      top: top + 'px',
      maxHeight: available + 'px',
      transformOrigin: `${originX}% ${isAbove ? '100%' : '0%'}`,
    })

    void dictPopover.offsetWidth

    requestAnimationFrame(() => {
      if (!dictVisible) return
      Object.assign(dictPopover.style, { opacity: '', transform: '', filter: '' })
    })

    const audioBtn = doc.getElementById('dictAudioBtn')
    audioBtnEl = audioBtn
    audioBtn?.addEventListener('click', (e) => {
      e.stopPropagation()
      if (audioBusy) return
      const url = audioBtn.dataset.url ?? ''
      const word = audioBtn.dataset.word ?? ''
      audioBusy = true
      const seq = ++audioSeq
      const isStale = (): boolean => seq !== audioSeq
      audioTimer = setTimeout(abortAudio, DICT_AUDIO_MAX_MS)
      audioLoadingTimer = setTimeout(() => setAudioState('loading'), DICT_AUDIO_LOADING_DELAY_MS)
      if (!url || audioDead.has(url)) {
        speakWord(word)
        return
      }

      let settled = false
      const fallbackToSpeech = (): void => {
        if (settled || isStale()) return
        settled = true
        clearDeadline()
        speakWord(word)
      }
      audioDeadlineTimer = setTimeout(fallbackToSpeech, DICT_AUDIO_DEADLINE_MS)

      void fetchAudio(url)
        .then((audio: string | null) => {
          if (settled || isStale()) return
          if (!audio) {
            fallbackToSpeech()
            return
          }
          const bytes = Uint8Array.from(atob(audio), (c) => c.charCodeAt(0))
          let ctx: AudioContext
          try {
            ctx = new AudioContext()
          } catch {
            fallbackToSpeech()
            return
          }
          void ctx
            .decodeAudioData(bytes.buffer)
            .then(async (buffer) => {
              if (settled || isStale()) {
                void ctx.close()
                return
              }
              if (ctx.state === 'suspended') await ctx.resume()
              if (settled || isStale() || ctx.state !== 'running') {
                void ctx.close()
                fallbackToSpeech()
                return
              }
              settled = true
              clearDeadline()
              const source = ctx.createBufferSource()
              source.buffer = buffer
              source.connect(ctx.destination)
              source.onended = () => {
                void ctx.close()
                endAudio()
              }
              source.start(0)
              setAudioState('playing')
              stopDictAudio = () => {
                source.onended = null
                source.stop()
                void ctx.close()
              }
            })
            .catch(() => {
              void ctx.close()
              fallbackToSpeech()
            })
        })
        .catch(() => {
          fallbackToSpeech()
        })
    })
  }

  function setAudioState(state: 'idle' | 'loading' | 'playing'): void {
    if (audioLoadingTimer !== null) {
      clearTimeout(audioLoadingTimer)
      audioLoadingTimer = null
    }
    if (audioBtnEl) audioBtnEl.dataset.state = state
  }

  function clearDeadline(): void {
    if (audioDeadlineTimer !== null) {
      clearTimeout(audioDeadlineTimer)
      audioDeadlineTimer = null
    }
  }

  function clearSpeechStart(): void {
    if (speechStartTimer !== null) {
      clearTimeout(speechStartTimer)
      speechStartTimer = null
    }
    if (pendingVoices) {
      window.speechSynthesis?.removeEventListener('voiceschanged', pendingVoices)
      pendingVoices = null
    }
  }

  function endAudio(): void {
    if (audioTimer !== null) {
      clearTimeout(audioTimer)
      audioTimer = null
    }
    clearDeadline()
    clearSpeechStart()
    setAudioState('idle')
    audioBusy = false
    audioSeq++
    stopDictAudio = null
  }

  function abortAudio(): void {
    stopDictAudio?.()
    endAudio()
  }

  function speakWord(word: string): void {
    const synth = window.speechSynthesis
    if (!synth || !word) {
      endAudio()
      return
    }

    const speak = (): void => {
      if (synth.speaking) synth.cancel()
      const utterance = new SpeechSynthesisUtterance(word)
      utterance.lang = lang || 'en'
      utterance.rate = DICT_SPEECH_RATE
      utterance.onstart = () => setAudioState('playing')
      utterance.onend = endAudio
      utterance.onerror = endAudio
      stopDictAudio = () => {
        utterance.onstart = null
        utterance.onend = null
        utterance.onerror = null
        synth.cancel()
      }
      synth.speak(utterance)
      speechStartTimer = setTimeout(() => {
        speechStartTimer = null
        if (!synth.speaking && !synth.pending) endAudio()
      }, DICT_SPEECH_START_MS)
    }

    if (synth.getVoices().length) {
      speak()
      return
    }
    pendingVoices = () => {
      clearSpeechStart()
      if (audioBusy) speak()
    }
    synth.addEventListener('voiceschanged', pendingVoices, { once: true })
  }

  function esc(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  }

  function buildDictHTML(entry: DictResolved): string {
    const phonetic = entry.i ?? ''
    const url = entry.a ? audioUrl(entry.a) : null

    let html = '<div>'
    html += '<div class="flex items-center gap-2 mb-3">'
    html += `<span class="font-bold text-sm">${esc(entry.w)}</span>`
    if (url) {
      html += `<button id="dictAudioBtn" data-state="idle" aria-label="Play pronunciation" data-url="${esc(url)}" data-word="${esc(entry.w)}" class="group flex shrink-0 items-center justify-center size-8  rounded-full text-yellow-600 hover:bg-white hover:shadow dark:text-yellow-400 dark:hover:bg-stone-850 dark:hover:shadow-bevel"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="size-4"><path class="group-data-[state=loading]:animate-pulse group-data-[state=loading]:[animation-duration:900ms]" d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06Z"/><path class="group-data-[state=playing]:animate-pulse-deep group-data-[state=loading]:opacity-0 group-data-[state=playing]:[animation-delay:150ms]" d="M18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z"/><path class="group-data-[state=playing]:animate-pulse-deep group-data-[state=loading]:opacity-0" d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z"/></svg></button>`
    }
    if (phonetic) html += `<span class="font-mono text-xs opacity-50">${esc(phonetic)}</span>`
    html += '</div>'

    html += '<div class="flex flex-col divide-y divide-current/10 text-xs">'
    entry.e.slice(0, DICT_MAX_POS).forEach((meaning) => {
      html += '<div class="py-2">'
      html += `<div class="mb-1.5 text-[0.6rem] uppercase tracking-widest opacity-50">${esc(posLabel(meaning.p))}</div>`
      html += '<ol class="flex flex-col gap-1.5">'
      meaning.g.forEach((gloss, i) => {
        html += `<li class="flex gap-1.5 leading-relaxed"><span class="shrink-0 opacity-40">${i + 1}.</span><span>`
        if (gloss.t) html += `<em class="not-italic opacity-60">(${esc(gloss.t)}) </em>`
        html += esc(gloss.d)
        if (gloss.x) html += `<em class="mt-0.5 block not-italic opacity-50">"${esc(gloss.x)}"</em>`
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
    audioBtnEl = null
    if (!wasVisible) return
    abortAudio()
    doc.getSelection()?.removeAllRanges()
  }

  async function open(word: string, deliberateCapital = false): Promise<void> {
    dictVisible = true
    const anchorRange = doc.getSelection()?.rangeCount ? doc.getSelection()!.getRangeAt(0) : null
    const anchorRect = anchorRange ? (Array.from(anchorRange.getClientRects())[0] ?? null) : null
    dictAnchorX = anchorRect ? anchorRect.left + anchorRect.width / 2 : 0
    dictAnchorTop = anchorRect ? anchorRect.top : 0
    dictAnchorBottom = anchorRect ? anchorRect.bottom : 0

    const { entry, unreachable } = await fetchDefinition(word, deliberateCapital)
    if (!dictVisible) return

    dictContent.innerHTML = entry
      ? buildDictHTML(entry)
      : unreachable
        ? `<div class="text-xs opacity-50">Couldn't load the dictionary. Please try again later.</div>`
        : `<div class="text-xs opacity-50">No definition found for "<em>${esc(word)}</em>".</div>`
    revealDictPopover()
  }

  doc.addEventListener('mouseup', (e) => {
    if (!enabled || e.button !== 0 || !lang.startsWith('en') || dictVisible) return
    const sel = doc.getSelection()
    const selected = sel ? sel.toString() : ''
    const raw = selected.trim()
    if (!raw || isMultiWord(raw) || containsNumber(raw) || isUrl(raw)) return
    const word = raw.replace(EDGE_PUNCTUATION, '')
    if (word.length < DICT_MIN_CHARS || !DICT_WORD.test(word)) return
    const range = sel?.rangeCount ? sel.getRangeAt(0) : null
    if (range && isMidWord(range, selected)) return
    void open(word, range ? hasDeliberateCapital(range, word) : false)
  })

  function setEnabled(value: boolean): void {
    enabled = value
    if (!value) close()
  }

  return { open, close, isVisible: () => dictVisible, popover: dictPopover, setEnabled }
}
