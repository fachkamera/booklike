// Uploads the transcoded pronunciations to the R2 bucket they are served from:
//
//   node scripts/upload-audio.ts             # upload whatever is missing
//   node scripts/upload-audio.ts --dry-run   # report what would be uploaded
//
// Needs .cache/audio-opus/ from scripts/build-audio.ts and R2 credentials in .env:
//
//   R2_ACCOUNT_ID=...
//   R2_ACCESS_KEY_ID=...
//   R2_SECRET_ACCESS_KEY=...
//
// Object keys are the filenames decoded back to words, so `%50olish.opus` is stored as
// `v1/en/Polish.opus` — see outName() for why the local files are encoded at all. Existing
// keys are listed first, so re-running only uploads what changed.

import { createHash, createHmac } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { env, nameToWord } from './audio-index.ts'

const BUCKET = 'booklike-audio'
const SOURCE_DIR = '.cache/audio-opus'

const PREFIX = 'v1/en'

/** Recordings never change under a given key, so they may be cached indefinitely. */
const CACHE_CONTROL = 'public, max-age=31536000, immutable'

const CONTENT_TYPE = 'audio/ogg'

/** Parallel uploads. R2 is not the bottleneck; request latency is. */
const CONCURRENCY = 32

const MAX_RETRIES = 4

/** R2 ignores the region but SigV4 requires one. */
const REGION = 'auto'
const SERVICE = 's3'

function credentials(): { accountId: string; accessKeyId: string; secretAccessKey: string } {
  const accountId = env('R2_ACCOUNT_ID')
  const accessKeyId = env('R2_ACCESS_KEY_ID')
  const secretAccessKey = env('R2_SECRET_ACCESS_KEY')
  if (!accountId || !accessKeyId || !secretAccessKey) {
    process.stderr.write('missing R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY in .env\n')
    process.exit(1)
  }
  return { accountId, accessKeyId, secretAccessKey }
}

const { accountId, accessKeyId, secretAccessKey } = credentials()
const HOST = `${accountId}.r2.cloudflarestorage.com`

const sha256 = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: Buffer | string, data: string) => createHmac('sha256', key).update(data).digest()

/** S3 signs the path with RFC 3986 escaping, and does not escape the separators. */
function encodePath(key: string): string {
  return key
    .split('/')
    .map((segment) =>
      encodeURIComponent(segment).replace(
        /[!'()*]/g,
        (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
    )
    .join('/')
}

interface SignedRequest {
  method: 'PUT' | 'GET'
  key?: string
  query?: Record<string, string>
  body?: Buffer
  headers?: Record<string, string>
}

function sign({ method, key = '', query = {}, body, headers = {} }: SignedRequest): {
  url: string
  headers: Record<string, string>
} {
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const dateStamp = amzDate.slice(0, 8)
  const payloadHash = sha256(body ?? '')

  const path = `/${BUCKET}${key ? `/${encodePath(key)}` : ''}`
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join('&')

  const all: Record<string, string> = {
    ...headers,
    host: HOST,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }
  const names = Object.keys(all)
    .map((n) => n.toLowerCase())
    .sort()
  const canonicalHeaders = names
    .map((n) => `${n}:${String(all[n] ?? all[n.toLowerCase()]).trim()}\n`)
    .join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [method, path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  )

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')

  let signing = hmac(`AWS4${secretAccessKey}`, dateStamp)
  signing = hmac(signing, REGION)
  signing = hmac(signing, SERVICE)
  signing = hmac(signing, 'aws4_request')
  const signature = createHmac('sha256', signing).update(stringToSign).digest('hex')

  all.Authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return {
    url: `https://${HOST}${path}${canonicalQuery ? `?${canonicalQuery}` : ''}`,
    headers: all,
  }
}

/**
 * Entity references as R2 writes them into a listing. Apostrophes come back as `&#39;`, so
 * missing this leaves every `o'clock` looking absent and re-uploads it on every run.
 */
function unescapeXml(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

/** Keys already in the bucket, so a re-run only uploads what is missing. */
async function existingKeys(): Promise<Set<string>> {
  const keys = new Set<string>()
  let token: string | undefined
  do {
    const query: Record<string, string> = { 'list-type': '2', prefix: `${PREFIX}/`, 'max-keys': '1000' }
    if (token) query['continuation-token'] = token
    const { url, headers } = sign({ method: 'GET', query })
    const res = await fetch(url, { headers })
    const xml = await res.text()
    if (!res.ok) {
      process.stderr.write(`list failed (${res.status}): ${xml.slice(0, 300)}\n`)
      process.exit(1)
    }
    for (const match of xml.matchAll(/<Key>([^<]*)<\/Key>/g)) keys.add(unescapeXml(match[1]))
    token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1]
    process.stderr.write(`  listed ${keys.size.toLocaleString()}\r`)
  } while (token)
  process.stderr.write('\n')
  return keys
}

async function put(key: string, body: Buffer): Promise<void> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { url, headers } = sign({
      method: 'PUT',
      key,
      body,
      headers: { 'content-type': CONTENT_TYPE, 'cache-control': CACHE_CONTROL },
    })
    try {
      const res = await fetch(url, { method: 'PUT', headers, body: new Uint8Array(body) })
      if (res.ok) {
        void res.body?.cancel()
        return
      }
      const text = await res.text()
      if (res.status < 500 && res.status !== 429) throw new Error(`${res.status} ${text.slice(0, 200)}`)
      if (attempt === MAX_RETRIES) throw new Error(`${res.status} after ${MAX_RETRIES} attempts`)
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err
    }
    await new Promise((r) => setTimeout(r, 500 * attempt))
  }
}

const files = readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.opus'))
process.stderr.write(`${files.length.toLocaleString()} local files\nlisting bucket…\n`)
const have = await existingKeys()

const pending = files.filter((f) => !have.has(`${PREFIX}/${nameToWord(f)}.opus`))
const bytes = pending.reduce((n, f) => n + readFileSync(`${SOURCE_DIR}/${f}`).byteLength, 0)
process.stderr.write(
  `${have.size.toLocaleString()} already in bucket, ` +
    `${pending.length.toLocaleString()} to upload (${(bytes / 1048576).toFixed(0)} MB)\n`,
)

if (process.argv.includes('--dry-run')) process.exit(0)

let done = 0
let failed = 0
const started = Date.now()
const queue = [...pending]
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    let file
    while ((file = queue.shift())) {
      const key = `${PREFIX}/${nameToWord(file)}.opus`
      try {
        await put(key, readFileSync(`${SOURCE_DIR}/${file}`))
        done++
      } catch (err) {
        failed++
        process.stderr.write(`\n  ${key}: ${err instanceof Error ? err.message : String(err)}\n`)
      }
      if ((done + failed) % 500 === 0) {
        const rate = done / ((Date.now() - started) / 1000)
        process.stderr.write(
          `  ${done.toLocaleString()}/${pending.length.toLocaleString()} at ${rate.toFixed(0)}/s\r`,
        )
      }
    }
  }),
)

process.stderr.write(
  `\n${done.toLocaleString()} uploaded, ${failed.toLocaleString()} failed` +
    (failed ? ' — re-run to retry\n' : '\n'),
)
if (failed) process.exit(1)
