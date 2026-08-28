// Reads the licence and author of every pronunciation recording the dictionary points
// at, so the recordings can be re-hosted with proper attribution:
//
//   node scripts/fetch-audio-meta.ts
//
// Appends to .cache/audio-meta.jsonl and resumes from whatever is already there, so an
// interrupted run costs nothing. scripts/fetch-audio.ts reads the result and downloads
// only the files whose licence allows re-hosting.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { commonsTitle, META_FILE, readAudioIndex, USER_AGENT, type AudioMeta } from './audio-index.ts'

const API = 'https://commons.wikimedia.org/w/api.php'

/** Titles per API call. 50 is the anonymous limit. */
const BATCH = 50

/** Pause between calls; the API is shared infrastructure. */
const THROTTLE_MS = 200

const MAX_RETRIES = 5

const errMessage = (err: unknown) => (err instanceof Error ? err.message : String(err))

interface ExtValue {
  value?: string
}

interface Page {
  title?: string
  missing?: boolean
  imageinfo?: {
    descriptionurl?: string
    extmetadata?: Record<string, ExtValue>
  }[]
}

interface ApiResult {
  query?: {
    pages?: Page[]
    normalized?: { from: string; to: string }[]
  }
}

/** extmetadata values are HTML fragments; the credits page wants plain text. */
function plain(html: string | undefined): string | undefined {
  if (!html) return undefined
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || undefined
}

async function callApi(titles: string[]): Promise<ApiResult> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'imageinfo',
    iiprop: 'extmetadata|url',
    iiextmetadatafilter: 'LicenseShortName|License|LicenseUrl|Artist|UsageTerms',
    titles: titles.join('|'),
  })
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(API, {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params,
        signal: AbortSignal.timeout(30_000),
      })
      if (!res.ok) throw new Error(`status ${res.status}`)
      return (await res.json()) as ApiResult
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
      await new Promise((r) => setTimeout(r, 1000 * attempt))
    }
  }
  throw new Error('unreachable')
}

function loadDone(): Set<string> {
  const done = new Set<string>()
  if (!existsSync(META_FILE)) return done
  for (const line of readFileSync(META_FILE, 'utf8').split('\n')) {
    if (!line) continue
    try {
      done.add((JSON.parse(line) as AudioMeta).path)
    } catch (_) {
      // A half-written final line from an interrupted run; it gets fetched again.
    }
  }
  return done
}

const index = readAudioIndex()
const done = loadDone()
const pending = [...index.keys()].filter((path) => !done.has(path))

process.stderr.write(
  `${index.size.toLocaleString()} recordings, ${done.size.toLocaleString()} already described, ` +
    `${pending.length.toLocaleString()} to fetch\n`,
)

mkdirSync(dirname(META_FILE), { recursive: true })

for (let i = 0; i < pending.length; i += BATCH) {
  const paths = pending.slice(i, i + BATCH)

  // Two paths can share a title (a wav and its transcode), and the API rejects repeats.
  const byTitle = new Map<string, string[]>()
  for (const path of paths) {
    const title = commonsTitle(path)
    const group = byTitle.get(title)
    if (group) group.push(path)
    else byTitle.set(title, [path])
  }

  let result: ApiResult
  try {
    result = await callApi([...byTitle.keys()])
  } catch (err) {
    process.stderr.write(`\nbatch at ${i} failed: ${errMessage(err)} — re-run to resume\n`)
    process.exit(1)
  }

  // The API normalises titles (underscores, first-letter case); map them back.
  const canonical = new Map<string, string>()
  for (const { from, to } of result.query?.normalized ?? []) canonical.set(to, from)

  const lines: string[] = []
  for (const page of result.query?.pages ?? []) {
    const title = page.title ?? ''
    const requested = canonical.get(title) ?? title
    const info = page.imageinfo?.[0]
    const ext = info?.extmetadata ?? {}
    for (const path of byTitle.get(requested) ?? []) {
      const meta: AudioMeta = {
        path,
        title: requested,
        license: plain(ext.LicenseShortName?.value ?? ext.UsageTerms?.value ?? ext.License?.value),
        licenseUrl: plain(ext.LicenseUrl?.value),
        artist: plain(ext.Artist?.value),
        descriptionUrl: info?.descriptionurl,
      }
      if (page.missing || !info) meta.error = page.missing ? 'missing' : 'no imageinfo'
      lines.push(JSON.stringify(meta))
    }
    byTitle.delete(requested)
  }

  // Anything the API did not answer for at all.
  for (const [title, group] of byTitle) {
    for (const path of group) {
      lines.push(JSON.stringify({ path, title, error: 'no page' } satisfies AudioMeta))
    }
  }

  appendFileSync(META_FILE, lines.join('\n') + '\n')
  const seen = Math.min(i + BATCH, pending.length)
  if (seen % (BATCH * 10) === 0 || seen === pending.length) {
    process.stderr.write(`  ${seen.toLocaleString()}/${pending.length.toLocaleString()}\n`)
  }
  await new Promise((r) => setTimeout(r, THROTTLE_MS))
}

process.stderr.write(`wrote ${META_FILE}\n`)
