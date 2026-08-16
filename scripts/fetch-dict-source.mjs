// Downloads the kaikki.org wiktextract extract that scripts/build-dict.mjs consumes.
// build-dict.mjs calls fetchDictSource() itself when the extract is missing, so this is
// only run directly to pre-fetch, or to resume an interrupted download:
//
//   node scripts/fetch-dict-source.mjs
//
// Any wiktextract JSONL works here — running wiktextract yourself over a dated
// Wikimedia dump produces the same schema and is the reproducible alternative.

import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from 'node:fs'
import { dirname } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createGunzip } from 'node:zlib'
import https from 'node:https'

const SOURCE = 'https://kaikki.org/dictionary/English/kaikki.org-dictionary-English.jsonl'

/** Where the extract is cached. Gitignored, and reused by every rebuild. */
export const DEFAULT_OUT = '.cache/kaikki-english.jsonl.gz'

/** Bytes per ranged request; small enough that a dropped connection costs little. */
const CHUNK_BYTES = 16 * 1024 * 1024

/** Concurrent connections. The host is volunteer-run — do not raise this casually. */
const CONCURRENCY = 4

/** Attempts per chunk before giving up. */
const MAX_RETRIES = 5

/** Raw request: no transparent inflation, so ranges stay byte-exact. */
function request(headers, onResponse) {
  return new Promise((resolve, reject) => {
    const req = https.get(SOURCE, { headers: { 'accept-encoding': 'gzip', ...headers } }, (res) => {
      onResponse(res, resolve, reject)
    })
    req.on('error', reject)
    req.setTimeout(120_000, () => req.destroy(new Error('timeout')))
  })
}

export async function fetchDictSource(out = DEFAULT_OUT) {
  const partsDir = `${out}.parts`
  mkdirSync(dirname(out), { recursive: true })

  const total = await request({ range: 'bytes=0-0' }, (res, resolve, reject) => {
    res.resume()
    if (res.headers['content-encoding'] !== 'gzip') {
      return reject(new Error('server no longer serves a precompressed copy'))
    }
    const match = /\/(\d+)$/.exec(res.headers['content-range'] ?? '')
    match ? resolve(Number(match[1])) : reject(new Error('server does not report a total size'))
  })

  const chunks = []
  for (let start = 0; start < total; start += CHUNK_BYTES) {
    chunks.push({ index: chunks.length, start, end: Math.min(start + CHUNK_BYTES, total) - 1 })
  }

  mkdirSync(partsDir, { recursive: true })
  const pad = (n) => String(n).padStart(5, '0')
  const sizeOf = (path) => (existsSync(path) ? statSync(path).size : -1)

  const pending = chunks.filter((c) => sizeOf(`${partsDir}/${pad(c.index)}`) !== c.end - c.start + 1)
  let completed = chunks.length - pending.length
  let failed = 0
  process.stderr.write(
    `${(total / 1e9).toFixed(2)} GB compressed in ${chunks.length} chunks; ${completed} already present\n`,
  )

  async function fetchChunk(chunk) {
    const path = `${partsDir}/${pad(chunk.index)}`
    const want = chunk.end - chunk.start + 1
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await request({ range: `bytes=${chunk.start}-${chunk.end}` }, async (res, resolve, reject) => {
          if (res.statusCode !== 206) {
            res.resume()
            return reject(new Error(`status ${res.statusCode}`))
          }
          try {
            await pipeline(res, createWriteStream(path))
            resolve()
          } catch (err) {
            reject(err)
          }
        })
        if (sizeOf(path) !== want) throw new Error('short read')
        completed++
        if (completed % 5 === 0 || completed === chunks.length) {
          process.stderr.write(`  ${completed}/${chunks.length} chunks\n`)
        }
        return
      } catch (err) {
        rmSync(path, { force: true })
        if (attempt === MAX_RETRIES) {
          failed++
          process.stderr.write(`  chunk ${chunk.index} failed: ${err.message}\n`)
          return
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }

  const queue = [...pending]
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (queue.length) await fetchChunk(queue.shift())
    }),
  )

  if (failed) {
    throw new Error(`${failed} chunks still missing — re-run to resume`)
  }

  process.stderr.write('\njoining chunks\n')
  const joined = createWriteStream(out)
  for (const name of readdirSync(partsDir).sort()) {
    await pipeline(createReadStream(`${partsDir}/${name}`), joined, { end: false })
  }
  await new Promise((resolve) => joined.end(resolve))

  process.stderr.write('verifying gzip integrity\n')
  let lines = 0
  await pipeline(createReadStream(out), createGunzip(), async function* (source) {
    for await (const buf of source) {
      for (const byte of buf) if (byte === 10) lines++
    }
  })

  rmSync(partsDir, { recursive: true, force: true })
  process.stderr.write(
    `wrote ${out} (${(statSync(out).size / 1e9).toFixed(2)} GB, ${lines.toLocaleString()} lines)\n`,
  )
  return out
}

if (import.meta.main) {
  try {
    await fetchDictSource(process.argv[2])
  } catch (err) {
    process.stderr.write(`\n${err.message}\n`)
    process.exit(1)
  }
}
