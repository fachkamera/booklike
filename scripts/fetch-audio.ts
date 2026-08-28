// Downloads the pronunciation recordings the dictionary points at, so they can be
// transcoded and re-hosted instead of hotlinked:
//
//   node scripts/fetch-audio.ts
//   node scripts/fetch-audio.ts --report   # licence breakdown only, no downloads
//
// Needs .cache/audio-meta.jsonl from scripts/fetch-audio-meta.ts: only recordings whose
// licence allows re-hosting are fetched. Files land in .cache/audio/ under their cache
// name and are never re-fetched, so an interrupted run resumes for free.

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import {
  CACHE_DIR,
  cacheName,
  commonsUrl,
  licenceAllows,
  META_FILE,
  readAudioIndex,
  USER_AGENT,
} from './audio-index.ts'
import type { AudioMeta } from './audio-index.ts'

/**
 * Requests in flight. Throughput is governed by the adaptive rate below, not by this;
 * two is enough to keep the pipe busy while one response is being read.
 */
const CONCURRENCY = 2

/**
 * Requests per second to start at. upload.wikimedia.org answers 429 with a Retry-After
 * long before any documented limit, and the budget refills slowly once spent, so the run
 * opens well under what it expects to sustain and works its way up.
 */
const START_RATE = 1

/** Hard ceiling on the adaptive rate, however well things are going. */
const MAX_RATE = 3

/** Floor, so a throttled run keeps creeping forward instead of stopping. */
const MIN_RATE = 0.5

/**
 * Multiplier applied on every 429. Gentle on purpose: the occasional throttle is the
 * ceiling being found, not a reason to collapse to a crawl, and halving made the run
 * oscillate around a quarter of the rate the server actually allows.
 */
const RATE_BACKOFF = 0.8

/** Consecutive successes that earn a rate increase, and the size of that increase. */
const RATE_PROBE_AFTER = 50
const RATE_PROBE_STEP = 0.2

/** Pause used when a 429 arrives without a usable Retry-After header. */
const DEFAULT_RETRY_AFTER_MS = 15_000

/** Attempts per file before it is written off as failed. */
const MAX_RETRIES = 3

/**
 * Time a single request may take. Wikimedia sometimes accepts a connection and then never
 * answers; with a long timeout both workers sit in dead requests and the whole run freezes,
 * which cost more wall-clock time than throttling did. Failing fast and moving on is
 * cheaper, since the file is retried on the next run anyway.
 */
const FETCH_TIMEOUT_MS = 15_000

/**
 * Network failures in a row that mean the connection is gone rather than one file being
 * unlucky. The run stops instead of marking thousands of files failed; everything already
 * on disk stays, so re-running picks up where it left off. Throttling does not count.
 */
const OFFLINE_STREAK = 20

/**
 * Throttled responses in a row with nothing downloaded in between. At that point the
 * budget is not refilling and the run should stop rather than crawl; re-run later.
 */
const THROTTLE_STALL = 60

/** Anything larger is not a word recording and is skipped. */
const MAX_BYTES = 2_000_000

const FAILED_FILE = '.cache/audio-failed.jsonl'

function readMeta(): AudioMeta[] {
  if (!existsSync(META_FILE)) {
    process.stderr.write(`${META_FILE} missing — run scripts/fetch-audio-meta.ts first\n`)
    process.exit(1)
  }
  const rows: AudioMeta[] = []
  for (const line of readFileSync(META_FILE, 'utf8').split('\n')) {
    if (line) rows.push(JSON.parse(line) as AudioMeta)
  }
  return rows
}

const index = readAudioIndex()
const meta = readMeta().filter((m) => index.has(m.path))

const words = (path: string) => index.get(path)?.length ?? 0

/** Files and words per licence string, split by whether the licence lets us re-host. */
const tally = new Map<string, { files: number; words: number; allowed: boolean }>()
for (const m of meta) {
  const key = m.error ? `(${m.error})` : (m.license ?? '(none)')
  const row = tally.get(key) ?? { files: 0, words: 0, allowed: licenceAllows(m) }
  row.files++
  row.words += words(m.path)
  tally.set(key, row)
}

function report(title: string, allowed: boolean): void {
  const rows = [...tally].filter(([, r]) => r.allowed === allowed).sort((a, b) => b[1].files - a[1].files)
  if (!rows.length) return
  process.stderr.write(`\n${title}\n`)
  for (const [licence, r] of rows) {
    process.stderr.write(
      `  ${String(r.files).padStart(6)} files ${String(r.words).padStart(6)} words  ${licence}\n`,
    )
  }
}

report('re-hosting allowed:', true)
report('rejected — these words fall back to speech synthesis:', false)

const kept = meta.filter(licenceAllows)
const keptWords = kept.reduce((n, m) => n + words(m.path), 0)
const allWords = meta.reduce((n, m) => n + words(m.path), 0)
process.stderr.write(
  `\n${kept.length.toLocaleString()}/${meta.length.toLocaleString()} recordings usable, ` +
    `covering ${keptWords.toLocaleString()}/${allWords.toLocaleString()} words\n`,
)

if (process.argv.includes('--report')) process.exit(0)

mkdirSync(CACHE_DIR, { recursive: true })

const pending = kept.filter((m) => !existsSync(`${CACHE_DIR}/${cacheName(m.path)}`))
process.stderr.write(`${pending.length.toLocaleString()} to download\n`)

let done = kept.length - pending.length
let failed = 0
const failures: string[] = []
const queue = [...pending]
let offlineStreak = 0
let offline = false

let rate = START_RATE
let successStreak = 0
let throttled = 0
let throttleStreak = 0
let blocked = false
/** Next moment a request may leave, moved forward by every send and every 429. */
let nextSlot = Date.now()
const started = Date.now()

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Serialises departures so the whole run obeys one rate, whatever the concurrency. */
async function takeSlot(): Promise<void> {
  const now = Date.now()
  const at = Math.max(now, nextSlot)
  nextSlot = at + 1000 / rate
  if (at > now) await sleep(at - now)
}

function slowDown(retryAfter: string | null): void {
  successStreak = 0
  throttled++
  if (++throttleStreak >= THROTTLE_STALL) blocked = true
  rate = Math.max(MIN_RATE, rate * RATE_BACKOFF)
  const seconds = Number(retryAfter)
  const pause = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_AFTER_MS
  nextSlot = Math.max(nextSlot, Date.now() + pause)
}

function speedUp(): void {
  if (++successStreak < RATE_PROBE_AFTER) return
  successStreak = 0
  rate = Math.min(MAX_RATE, rate + RATE_PROBE_STEP)
}

function progress(): void {
  const elapsed = (Date.now() - started) / 1000
  const fetched = done - (kept.length - pending.length)
  const perSecond = fetched / elapsed
  const eta = perSecond > 0 ? (queue.length + CONCURRENCY) / perSecond / 60 : 0
  process.stderr.write(
    `  ${done.toLocaleString()}/${kept.length.toLocaleString()} ` +
      `at ${perSecond.toFixed(2)}/s (rate ${rate.toFixed(2)}/s, ${throttled.toLocaleString()} throttled) ` +
      `ETA ${eta.toFixed(0)} min\n`,
  )
}

/** Returns false when the file should go back on the queue rather than be written off. */
async function download(m: AudioMeta): Promise<boolean> {
  const target = `${CACHE_DIR}/${cacheName(m.path)}`
  const tmp = `${target}.part`
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    await takeSlot()
    try {
      const res = await fetch(commonsUrl(m.path), {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      offlineStreak = 0
      if (res.status === 429 || res.status === 403) {
        void res.body?.cancel()
        slowDown(res.headers.get('retry-after'))
        return false
      }
      if (res.status === 404) {
        void res.body?.cancel()
        failures.push(JSON.stringify({ path: m.path, error: '404' }))
        failed++
        return true
      }
      if (!res.ok) throw new Error(`status ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      if (buf.byteLength > MAX_BYTES) {
        failures.push(JSON.stringify({ path: m.path, error: `oversized ${buf.byteLength}` }))
        failed++
        return true
      }
      writeFileSync(tmp, buf)
      renameSync(tmp, target)
      done++
      throttleStreak = 0
      speedUp()
      if (done % 250 === 0) progress()
      return true
    } catch (err) {
      rmSync(tmp, { force: true })
      if (attempt === MAX_RETRIES) {
        if (++offlineStreak >= OFFLINE_STREAK) {
          offline = true
          return false
        }
        failures.push(
          JSON.stringify({ path: m.path, error: err instanceof Error ? err.message : String(err) }),
        )
        failed++
        return true
      }
      await sleep(1000 * attempt)
    }
  }
  return true
}

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let next
    while (!offline && !blocked && (next = queue.shift())) {
      if (!(await download(next))) queue.push(next)
    }
  }),
)

if (failures.length) writeFileSync(FAILED_FILE, failures.join('\n') + '\n')
progress()
process.stderr.write(
  `\n${done.toLocaleString()} in ${CACHE_DIR}, ${failed.toLocaleString()} failed` +
    (failed ? ` (see ${FAILED_FILE})\n` : '\n'),
)
if (offline) {
  process.stderr.write(`stopped after ${OFFLINE_STREAK} network failures in a row — re-run to resume\n`)
  process.exit(1)
}
if (blocked) {
  process.stderr.write(
    `stopped after ${THROTTLE_STALL} throttled responses in a row — wait a while, then re-run to resume\n`,
  )
  process.exit(1)
}
