// Builds the bundled dictionary from a kaikki.org wiktextract JSONL extract.
//
//   node scripts/build-dict.mjs            # uses the cached extract, downloads if missing
//   node scripts/build-dict.mjs --refetch  # discards the cache and downloads again
//   cat some-other.jsonl | node scripts/build-dict.mjs
//
// Writes gzipped shards to src/assets/dict/, which scripts/build.mjs already copies
// verbatim into dist/. Note that build.mjs copies src/assets at startup only, so a
// running watch process has to be restarted to pick up a rebuilt dictionary.

import { createInterface } from 'node:readline'
import { createGunzip, gzipSync } from 'node:zlib'
import {
  createReadStream,
  existsSync,
  fstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { DICT_MIN_CHARS } from '../src/config.ts'
import { shardKey } from '../src/dict.ts'
import { DEFAULT_OUT, fetchDictSource } from './fetch-dict-source.mjs'

/** Definitions kept per part of speech, taken round-robin across etymologies. */
const MAX_GLOSSES = 4

const MAX_WORDS = Number(process.env.DICT_MAX_WORDS ?? 150_000)

/** Longest usage example kept; anything longer is a citation in disguise. */
const MAX_EXAMPLE_CHARS = 120

/** Words must be a single Latin-script token, optionally hyphenated or possessive. */
const WORD_RE = /^[\p{Lu}\p{Ll}][\p{Lu}\p{Ll}'’-]*$/u

/** Fixed prefix of every Wikimedia Commons upload path, restored at runtime. */
const COMMONS_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/'

const OUT_DIR = 'src/assets/dict'

/** Shards are written here and swapped in at the end, so a failed run keeps the old bundle. */
const TMP_DIR = `${OUT_DIR}.tmp`

/** Phonemic IPA in the accent we display; falls back to any phonemic transcription. */
function pickIpa(sounds = []) {
  const phonemic = sounds.filter((s) => s.ipa?.startsWith('/'))
  const ga = phonemic.find((s) => s.tags?.includes('General-American'))
  return (ga ?? phonemic[0])?.ipa
}

/** Prefer the US recordings for consistency */
function audioRank(sound) {
  const name = sound.audio ?? ''
  if (/^en[-_]us[-_]/i.test(name)) return 0
  if (sound.tags?.some((t) => t === 'US' || t === 'General-American')) return 1
  if (/^en[-_]/i.test(name)) return 2
  return 3
}

/** Commons path of the pronunciation recording, minus the shared prefix. */
function pickAudio(sounds = []) {
  const usable = sounds.filter((s) => s.ogg_url?.startsWith(COMMONS_PREFIX))
  if (!usable.length) return undefined
  let best = usable[0]
  for (const sound of usable) {
    if (audioRank(sound) < audioRank(best)) best = sound
  }
  return best.ogg_url.slice(COMMONS_PREFIX.length)
}

/** Bare cross-references ("See about to.") are navigation, not definitions. */
const XREF = /^\s*see\b/i

/**
 * Senses a present-day reader will not meet, dropped whenever the word has better ones
 * to show.
 */
const DEAD_TAGS = new Set(['obsolete', 'archaic', 'dated', 'rare', 'uncommon'])

/**
 * Marginal senses: kept and shown, but not evidence that an inflected form is a word in
 * its own right.
 */
const MARGINAL_TAGS = new Set(['slang', 'vulgar', 'informal', 'colloquial', 'nonstandard', 'proscribed'])

/**
 * Plain senses an inflected form needs before it keeps its own entry instead of
 * redirecting to its lemma.
 */
const FORM_OWN_GLOSSES = 2

/** A form_of sense tagged like this describes a relation the reader did not select */
const DEMOTED_FORM_TAGS = new Set([...DEAD_TAGS, ...MARGINAL_TAGS, 'euphemistic'])

/**
 * How much bigger a form's own wiktextract entry must be than its inflection entry before
 * it keeps its own senses regardless of the gloss test above.
 */
const FORM_OWN_SIZE_RATIO = 20

/** Collected per etymology before filtering, since dead senses can come first. */
const GLOSS_POOL = MAX_GLOSSES * 3

/**
 * Nested glosses run general -> specific, so the last is the useful one. But some
 * sub-senses are only a pointer at another entry, in which case the parent gloss is
 * the real definition; if even that is a pointer the sense is dropped entirely.
 */
function definitionOf(sense) {
  const glosses = sense.glosses
  if (!glosses?.length) return null
  let text = glosses[glosses.length - 1]
  if (XREF.test(text) && glosses.length > 1) text = glosses[glosses.length - 2]
  return XREF.test(text) ? null : text
}

/** Wiktionary's own usage examples; quotations are citations and far too long. */
function exampleOf(sense) {
  for (const ex of sense.examples ?? []) {
    if (ex.type !== 'example') continue
    const text = (ex.text ?? '').replace(/ /g, ' ').trim()
    if (text && text.length <= MAX_EXAMPLE_CHARS && !text.includes('\n')) return text
  }
  return null
}

/** Glosses of one etymology, already trimmed to what a merged entry could use. */
function glossesOf(senses) {
  const out = []
  const seen = new Set()
  for (const sense of senses) {
    if (sense.form_of) continue
    const d = definitionOf(sense)
    if (!d || seen.has(d)) continue
    seen.add(d)
    const gloss = { d }
    if (sense.topics?.length) gloss.t = sense.topics[0]
    const example = exampleOf(sense)
    if (example) gloss.x = example
    if (sense.tags?.some((t) => DEAD_TAGS.has(t))) gloss.dead = true
    if (sense.tags?.some((t) => MARGINAL_TAGS.has(t))) gloss.marginal = true
    out.push(gloss)
    if (out.length === GLOSS_POOL) break
  }
  return out
}

/** Wiktionary splits by etymology, so interleave pools to keep every sense-family. */
function roundRobin(pools) {
  const picked = []
  const cursors = pools.map(() => 0)
  while (picked.length < MAX_GLOSSES && cursors.some((c, i) => c < pools[i].length)) {
    for (let i = 0; i < pools.length && picked.length < MAX_GLOSSES; i++) {
      if (cursors[i] < pools[i].length) picked.push(pools[i][cursors[i]++])
    }
  }
  return picked
}

/** True only when stdin actually carries data — isTTY alone is also false when it is closed. */
function isPiped() {
  try {
    const stat = fstatSync(0)
    return stat.isFIFO() || stat.isFile()
  } catch {
    return false
  }
}

/**
 * Lines of the extract: whatever is piped in, else the cached gzip under .cache/,
 * downloading it first if it is missing or --refetch was passed.
 */
async function sourceStream() {
  if (isPiped()) return process.stdin
  if (process.argv.includes('--refetch')) {
    rmSync(DEFAULT_OUT, { force: true })
    rmSync(`${DEFAULT_OUT}.parts`, { recursive: true, force: true })
  }
  if (!existsSync(DEFAULT_OUT)) {
    process.stderr.write(`${DEFAULT_OUT} not found — downloading\n`)
    await fetchDictSource()
  } else {
    process.stderr.write(`reading ${DEFAULT_OUT}\n`)
  }
  return createReadStream(DEFAULT_OUT).pipe(createGunzip())
}

const words = new Map()
const stubs = new Map()
let seen = 0
let skipped = 0

const rl = createInterface({ input: await sourceStream(), crlfDelay: Infinity })

for await (const line of rl) {
  if (!line) continue
  let entry
  try {
    entry = JSON.parse(line)
  } catch {
    continue
  }
  seen++
  if (seen % 200_000 === 0) process.stderr.write(`  ${seen.toLocaleString()} lines, ${words.size} words\n`)

  const { word, pos, lang, senses } = entry
  if (lang !== 'English' || !word || !pos || !senses?.length) continue
  // Selections this short never reach lookup, so their entries would be dead weight.
  if (word.length < DICT_MIN_CHARS) continue
  if (!WORD_RE.test(word)) {
    skipped++
    continue
  }

  const key = word

  const formOf = senses.find((s) => s.form_of?.[0]?.word)?.form_of[0].word
  if (formOf) {
    if (formOf !== key) {
      let byLemma = stubs.get(key)
      if (!byLemma) stubs.set(key, (byLemma = new Map()))
      let candidate = byLemma.get(formOf)
      if (!candidate) byLemma.set(formOf, (candidate = { b: 0, plain: false }))
      candidate.b += line.length
      candidate.plain ||= senses.some(
        (s) => s.form_of?.[0]?.word === formOf && !s.tags?.some((t) => DEMOTED_FORM_TAGS.has(t)),
      )
    }
  }
  if (!senses.some((s) => s.glosses?.length && !s.form_of)) continue

  const glosses = glossesOf(senses)
  if (!glosses.length) continue

  let record = words.get(key)
  if (!record) {
    if (words.size >= MAX_WORDS) continue
    words.set(key, (record = { pos: new Map() }))
  }
  record.i ??= pickIpa(entry.sounds)
  record.a ??= pickAudio(entry.sounds)
  if (!formOf) record.b = (record.b ?? 0) + line.length
  const pools = record.pos.get(pos)
  if (pools) pools.push(glosses)
  else record.pos.set(pos, [glosses])
}

process.stderr.write(`\nread ${seen.toLocaleString()} lines\n`)
process.stderr.write(`${words.size.toLocaleString()} words, ${stubs.size.toLocaleString()} inflections\n`)
process.stderr.write(`${skipped.toLocaleString()} skipped (multiword / non-Latin)\n`)

const shards = new Map()
/** Plain (non-dead, non-marginal) definitions of each word, for the redirect test below. */
const plainGlosses = new Map()
let withIpa = 0
let withAudio = 0

for (const [word, { i, a, pos }] of words) {
  const record = {}
  if (i) {
    record.i = i
    withIpa++
  }
  if (a) {
    record.a = a
    withAudio++
  }
  const hasLive = [...pos.values()].some((pools) => pools.some((g) => g.some((x) => !x.dead)))
  record.e = [...pos.entries()]
    .map(([p, pools]) => ({
      p,
      g: roundRobin(hasLive ? pools.map((g) => g.filter((x) => !x.dead)) : pools),
    }))
    .filter((e) => e.g.length)
  if (!record.e.length) continue
  plainGlosses.set(
    word,
    record.e.flatMap((e) => e.g.filter((g) => !g.marginal).map((g) => g.d)),
  )

  const key = shardKey(word)
  let shard = shards.get(key)
  if (!shard) shards.set(key, (shard = {}))
  shard[word] = record
}

/**
 * Whether an inflected form stands on its own. Definitions that merely restate the lemma
 * say nothing about the form, so they do not count towards it.
 */
function standsAlone(form, lemma) {
  const mentionsLemma = new RegExp(`\\b${lemma.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
  const own = (plainGlosses.get(form) ?? []).filter((d) => !mentionsLemma.test(d))
  return own.length >= FORM_OWN_GLOSSES
}

function outweighsInflection(form, formBytes) {
  return (words.get(form)?.b ?? 0) >= formBytes * FORM_OWN_SIZE_RATIO
}

let liveStubs = 0
let bySize = 0

/** Which lemma a form belongs to when several claim it */
function pickLemma(form, byLemma, rank) {
  let candidates = [...byLemma].filter(([lemma]) => words.has(lemma) && lemma !== form)
  const narrow = (keep) => candidates.some(keep) && (candidates = candidates.filter(keep))
  if (rank && !/['\u2019]/.test(form)) {
    narrow(([, c]) => c.plain)
    narrow(([lemma]) => lemma[0].toLowerCase() === form[0].toLowerCase())
  }
  return candidates[0]
}

for (const [form, byLemma] of stubs) {
  const key = shardKey(form)
  const existing = shards.get(key)?.[form]
  const picked = pickLemma(form, byLemma, !existing)
  if (!picked) continue
  const [lemma, { b }] = picked
  if (existing) {
    if (standsAlone(form, lemma)) continue
    if (outweighsInflection(form, b)) {
      bySize++
      continue
    }
    existing.of = lemma
  } else {
    let shard = shards.get(key)
    if (!shard) shards.set(key, (shard = {}))
    shard[form] = { of: lemma }
  }
  liveStubs++
}

for (const shard of shards.values()) {
  for (const record of Object.values(shard)) {
    for (const pos of record.e ?? []) {
      for (const gloss of pos.g) {
        delete gloss.dead
        delete gloss.marginal
      }
    }
  }
}

if (!shards.size) {
  process.stderr.write('\nno shards produced — keeping the existing bundle\n')
  process.exit(1)
}

rmSync(TMP_DIR, { recursive: true, force: true })
mkdirSync(TMP_DIR, { recursive: true })

let total = 0
for (const [key, shard] of [...shards].sort(([a], [b]) => a.localeCompare(b))) {
  const gz = gzipSync(Buffer.from(JSON.stringify(shard)), { level: 9 })
  writeFileSync(`${TMP_DIR}/${key}.json.gz`, gz)
  total += gz.length
}

rmSync(OUT_DIR, { recursive: true, force: true })
renameSync(TMP_DIR, OUT_DIR)

const entryCount = [...shards.values()].reduce((n, shard) => n + Object.keys(shard).length, 0)
process.stderr.write(`\n${shards.size} shards, ${(total / 1e6).toFixed(1)} MB gzipped\n`)
process.stderr.write(`${entryCount.toLocaleString()} lookups (${liveStubs.toLocaleString()} redirects)\n`)
process.stderr.write(`${bySize.toLocaleString()} redirects dropped by size (ratio ${FORM_OWN_SIZE_RATIO})\n`)
process.stderr.write(
  `IPA ${((withIpa / words.size) * 100).toFixed(0)}%, audio ${((withAudio / words.size) * 100).toFixed(0)}%\n`,
)
