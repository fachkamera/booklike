// Transcodes the downloaded pronunciation recordings into the files we self-host, one per
// word, and writes the attribution that has to travel with them:
//
//   node scripts/build-audio.ts
//   node scripts/build-audio.ts --force   # re-encode even where output already exists
//
// Needs ffmpeg on PATH, plus .cache/audio/ from scripts/fetch-audio.ts. Writes
//   .cache/audio-opus/<word>.opus      the objects to upload, word-keyed
//   scripts/audio-words.json           every word that ends up with a recording
//   .cache/audio-credits/<shard>.json  per-word attribution for the credits page
//
// scripts/build-dict.ts reads audio-words.json to decide which entries get the audio
// flag, so the dictionary has to be rebuilt once after this script runs.

import { execFile } from 'node:child_process'
import { availableParallelism } from 'node:os'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { promisify } from 'node:util'
import {
  CACHE_DIR,
  cacheName,
  licenceAllows,
  META_FILE,
  outName,
  readAudioIndex,
  shardOf,
  type AudioMeta,
} from './audio-index.ts'

const run = promisify(execFile)

const OUT_DIR = '.cache/audio-opus'

/** Stripped from every credit's source link and restored by the credits page. */
const COMMONS_FILE_PREFIX = 'https://commons.wikimedia.org/wiki/File:'
const CREDITS_DIR = '.cache/audio-credits'
const WORDS_FILE = 'scripts/audio-words.json'

/** Opus bitrate. Mono speech is transparent enough here that 32k was indistinguishable. */
const BITRATE = '24k'

/** EBU R128 target. Commons recordings span 30 dB, so this is what makes playback usable. */
const LOUDNORM = 'loudnorm=I=-16:TP=-1.5:LRA=11'

/**
 * Leading-silence trim. RMS detection rather than peak: mic clicks have a high peak but
 * almost no energy, and peak detection stops the trim at the click, leaving the noise in.
 * 60 ms of lead-in is kept so the word does not start abruptly.
 */
const TRIM =
  'silenceremove=start_periods=1:start_duration=0.02:start_silence=0.06:start_threshold=-50dB:detection=rms'

/** Shorter than this is a truncated file rather than a word. */
const MIN_SECONDS = 0.15

/** Longer than this is a sentence or a mis-tagged upload. */
const MAX_SECONDS = 12

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

/**
 * Lingua Libre credits its recordings as "Speaker: X Recorder: Y", almost always with the
 * same person twice. Credit one name where they match, both where they differ.
 */
function credit(artist: string | undefined): string | undefined {
  const match = /^Speaker:\s*(.+?)\s+Recorder:\s*(.+)$/.exec(artist ?? '')
  if (!match) return artist
  const [, speaker, recorder] = match
  return speaker === recorder ? speaker : `${speaker} (recorded by ${recorder})`
}

async function duration(file: string): Promise<number> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'csv=p=0',
    file,
  ])
  return Number(stdout.trim())
}

async function encode(source: string, target: string, meta: AudioMeta, trim: boolean): Promise<void> {
  await run('ffmpeg', [
    '-nostdin',
    '-v',
    'error',
    '-i',
    source,
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    '-af',
    trim ? `${LOUDNORM},${TRIM}` : LOUDNORM,
    '-ac',
    '1',
    '-ar',
    '48000',
    '-c:a',
    'libopus',
    '-b:a',
    BITRATE,
    '-vbr',
    'on',
    '-application',
    'audio',
    // The target is a .part until it has passed, so the container cannot be inferred from it.
    '-f',
    'ogg',
    ...(credit(meta.artist) ? ['-metadata', `ARTIST=${credit(meta.artist)}`] : []),
    ...(meta.license ? ['-metadata', `LICENSE=${meta.license}`] : []),
    ...(meta.descriptionUrl ? ['-metadata', `SOURCE=${meta.descriptionUrl}`] : []),
    '-metadata',
    'COMMENT=Re-encoded to Opus for booklike.app',
    '-y',
    target,
  ])
}

const index = readAudioIndex()
const metaByPath = new Map<string, AudioMeta>()
for (const line of readFileSync(META_FILE, 'utf8').split('\n')) {
  if (!line) continue
  const meta = JSON.parse(line) as AudioMeta
  if (licenceAllows(meta) && index.has(meta.path)) metaByPath.set(meta.path, meta)
}

const force = process.argv.includes('--force')
mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(CREDITS_DIR, { recursive: true })

const jobs = [...metaByPath.values()].filter((m) => existsSync(`${CACHE_DIR}/${cacheName(m.path)}`))
process.stderr.write(
  `${jobs.length.toLocaleString()}/${metaByPath.size.toLocaleString()} recordings downloaded, ` +
    `covering ${jobs.reduce((n, m) => n + (index.get(m.path)?.length ?? 0), 0).toLocaleString()} words\n`,
)

/**
 * One word's attribution. The licence deed URL and the Commons page prefix are both
 * derivable from what is here, and leaving them out halves the size of the credit shards
 * in the website repo; gzip made them nearly free over the wire either way.
 */
interface Credit {
  /** Contributor, as credited on the Commons file page. */
  a?: string
  /** Licence short name, e.g. "CC BY-SA 4.0". */
  l?: string
  /** Commons file title, minus the wiki/File: prefix. */
  s?: string
}

const credits = new Map<string, Credit>()
const words: string[] = []
const dropped: string[] = []
let encoded = 0
let skipped = 0
let untrimmed = 0

async function build(meta: AudioMeta): Promise<void> {
  const targets = (index.get(meta.path) ?? []).map((word) => ({ word, file: `${OUT_DIR}/${outName(word)}` }))
  if (!targets.length) return

  const record = (): void => {
    for (const { word } of targets) {
      words.push(word)
      credits.set(word, {
        a: credit(meta.artist),
        l: meta.license,
        s: meta.descriptionUrl?.replace(COMMONS_FILE_PREFIX, ''),
      })
    }
  }

  if (!force && targets.every((t) => existsSync(t.file))) {
    skipped++
    record()
    return
  }

  const source = `${CACHE_DIR}/${cacheName(meta.path)}`
  const first = targets[0].file
  // Encoded beside the target and moved into place only once it has passed, so a run killed
  // mid-ffmpeg leaves a .part rather than a truncated .opus the next run counts as done.
  const tmp = `${first}.part`
  try {
    await encode(source, tmp, meta, true)
    let seconds = await duration(tmp)
    // A trim that leaves almost nothing means the detector misread the recording; the
    // untrimmed encode is worth more than a stub.
    if (seconds < MIN_SECONDS) {
      await encode(source, tmp, meta, false)
      seconds = await duration(tmp)
      untrimmed++
    }
    if (seconds < MIN_SECONDS || seconds > MAX_SECONDS) {
      rmSync(tmp, { force: true })
      dropped.push(`${targets[0].word}\t${seconds.toFixed(2)}s`)
      return
    }
  } catch (err) {
    rmSync(tmp, { force: true })
    dropped.push(`${targets[0].word}\t${errMessage(err).split('\n')[0]}`)
    return
  }

  // Words that share a recording get their own object rather than a redirect.
  const bytes = readFileSync(tmp)
  for (const { file } of targets.slice(1)) {
    writeFileSync(`${file}.part`, bytes)
    renameSync(`${file}.part`, file)
  }
  renameSync(tmp, first)

  encoded++
  record()
  if (encoded % 1000 === 0) process.stderr.write(`  ${encoded.toLocaleString()} encoded\n`)
}

const queue = [...jobs]
await Promise.all(
  Array.from({ length: availableParallelism() }, async () => {
    let next
    while ((next = queue.shift())) await build(next)
  }),
)

words.sort()
// One word per line: a rebuild's diff then shows exactly which words gained or lost audio.
writeFileSync(WORDS_FILE, `${JSON.stringify(words, null, 2)}\n`)

const shards = new Map<string, Record<string, Credit>>()
for (const [word, credit] of credits) {
  const key = shardOf(word)
  const shard = shards.get(key) ?? {}
  shard[word] = credit
  shards.set(key, shard)
}
for (const [key, shard] of shards) writeFileSync(`${CREDITS_DIR}/${key}.json`, JSON.stringify(shard))

if (dropped.length) writeFileSync('.cache/audio-dropped.tsv', dropped.join('\n') + '\n')
process.stderr.write(
  `\n${encoded.toLocaleString()} encoded, ${skipped.toLocaleString()} already present, ` +
    `${untrimmed.toLocaleString()} kept untrimmed, ${dropped.length.toLocaleString()} dropped\n` +
    `${words.length.toLocaleString()} words with audio → ${WORDS_FILE}\n` +
    `${shards.size} credit shards → ${CREDITS_DIR}/ (copy into web/public/)\n`,
)
