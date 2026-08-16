/** Fixed prefix stripped from every audio path at build time. */
export const COMMONS_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/'

/**
 * Why a pronunciation download produced no audio. `permanent` does not retry.
 */
export type AudioFailure = 'ratelimit' | 'permanent' | 'transient'

export interface AudioResponse {
  audio: string | null
  failure?: AudioFailure
}

export interface DictGloss {
  /** Definition text. */
  d: string
  /** Topic label, e.g. "geography". */
  t?: string
  /** Usage example. */
  x?: string
}

export interface DictPos {
  /** Part of speech. */
  p: string
  g: DictGloss[]
}

export interface DictRecord {
  /** Phonemic IPA. */
  i?: string
  /** Commons path of the pronunciation recording, minus COMMONS_PREFIX. */
  a?: string
  e?: DictPos[]
  /** Set on inflected forms; points at the lemma holding the definitions. */
  of?: string
}

export interface DictResolved extends DictRecord {
  /** The looked-up word, or the lemma an inflected form redirected to. */
  w: string
  e: DictPos[]
}

/**
 * wiktextract abbreviates parts of speech; spell them out for display. Mapping here
 * rather than in the bundle keeps the repeated label out of 150k entries.
 */
const POS_LABELS: Record<string, string> = {
  adj: 'adjective',
  adv: 'adverb',
  conj: 'conjunction',
  det: 'determiner',
  intj: 'interjection',
  name: 'proper noun',
  num: 'numeral',
  prep: 'preposition',
  prep_phrase: 'prepositional phrase',
  pron: 'pronoun',
  postp: 'postposition',
  abbrev: 'abbreviation',
  combining_form: 'combining form',
}

export function posLabel(pos: string): string {
  return POS_LABELS[pos] ?? pos.replace(/_/g, ' ')
}

export function shardKey(word: string): string {
  const key = word.toLowerCase().slice(0, 2)
  return /^[a-z]+$/.test(key) ? key : '_'
}

export function audioUrl(path: string): string {
  return COMMONS_PREFIX + path
}

type Shard = Record<string, DictRecord>

async function loadShard(key: string): Promise<Shard | null> {
  let res: Response
  try {
    res = await fetch(chrome.runtime.getURL(`dict/${key}.json.gz`))
  } catch (_) {
    return null
  }
  if (!res.ok || !res.body) return null
  const stream = res.body.pipeThrough(new DecompressionStream('gzip'))
  return (await new Response(stream).json()) as Shard
}

function candidates(word: string, deliberateCapital: boolean): string[] {
  const lower = word.toLowerCase()
  const capitalised = lower.charAt(0).toUpperCase() + lower.slice(1)
  const isAcronym = word.length > 1 && word === word.toUpperCase() && word !== lower
  if (!isAcronym && /[A-Z]/.test(word.slice(1))) return [word]
  const order =
    isAcronym || deliberateCapital
      ? [word, lower, capitalised, word.toUpperCase()]
      : [lower, word, capitalised, word.toUpperCase()]
  return [...new Set(order)]
}

export async function lookup(word: string, deliberateCapital = false): Promise<DictResolved | null> {
  const shard = await loadShard(shardKey(word))
  if (!shard) return null

  const spellings = candidates(word, deliberateCapital)
  let key = ''
  for (const candidate of spellings) {
    if (shard[candidate]) {
      key = candidate
      break
    }
  }
  if (!key) return null
  const record = shard[key]

  if (record.of && !record.e?.length && key !== word) {
    const better = spellings.find((c) => c !== key && shard[c]?.e?.length)
    const senses = better ? shard[better].e : undefined
    if (better && senses) return { ...shard[better], w: better, e: senses }
  }

  if (record.of) {
    const lemma = record.of
    const lemmaKey = shardKey(lemma)
    const lemmaShard = lemmaKey === shardKey(word) ? shard : await loadShard(lemmaKey)
    const target = lemmaShard?.[lemma]
    if (target?.e?.length) return { ...target, w: lemma, e: target.e }
  }

  if (!record.e?.length) return null
  return { ...record, w: key, e: record.e }
}
