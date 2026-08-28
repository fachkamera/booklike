// Shared by the pronunciation-audio scripts: reads the built dictionary shards and
// reports which Commons recording every word points at.

import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { shardKey } from '../src/dict.ts'

/** Fixed prefix of every Wikimedia Commons upload path, written by scripts/build-dict.ts. */
export const COMMONS_PREFIX = 'https://upload.wikimedia.org/wikipedia/commons/'

/**
 * Which recording each word points at, written by scripts/build-dict.ts. The shipped
 * dictionary only carries a flag, so the Commons paths the fetch needs live here.
 */
const SOURCES_FILE = '.cache/audio-sources.json'

const { version } = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

/** Reads a setting from the environment, falling back to a KEY=value line in .env. */
export function env(name: string): string | undefined {
  const fromProcess = process.env[name]?.trim()
  if (fromProcess) return fromProcess
  if (!existsSync('.env')) return undefined
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const match = new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`).exec(line)
    if (match) return match[1].trim().replace(/^["']|["']$/g, '') || undefined
  }
  return undefined
}

/**
 * Wikimedia asks bulk clients to identify themselves and link somewhere contactable. Set
 * BOOKLIKE_CONTACT to an address they can reach you at before running a long fetch
 */
const CONTACT = env('BOOKLIKE_CONTACT')
export const USER_AGENT = `BookLike/${version} (+https://booklike.app${CONTACT ? `; ${CONTACT}` : ''})`

export const CACHE_DIR = '.cache/audio'
export const META_FILE = '.cache/audio-meta.jsonl'

/** What the Commons API reports about one recording, kept for the credits page. */
export interface AudioMeta {
  /** Commons path, minus COMMONS_PREFIX — the key across all audio scripts. */
  path: string
  title: string
  license?: string
  licenseUrl?: string
  artist?: string
  descriptionUrl?: string
  /** Set when the file page could not be read; such files are skipped. */
  error?: string
}

/** Every word that resolves to a recording, grouped by the recording it uses. */
export function readAudioIndex(): Map<string, string[]> {
  if (!existsSync(SOURCES_FILE)) {
    process.stderr.write(`${SOURCES_FILE} missing — run scripts/build-dict.ts first\n`)
    process.exit(1)
  }
  return new Map(Object.entries(JSON.parse(readFileSync(SOURCES_FILE, 'utf8')) as Record<string, string[]>))
}

/**
 * The Commons file whose page carries the licence. Lingua Libre recordings reach us as
 * `transcoded/<x>/<xy>/<name>.wav/<name>.wav.ogg`, a derived copy of the uploaded wav;
 * the licence lives on the wav's page, not on the transcode.
 */
export function commonsTitle(path: string): string {
  const decoded = decodeURIComponent(path)
  if (decoded.startsWith('transcoded/')) {
    const segments = decoded.split('/')
    return `File:${segments[segments.length - 2]}`
  }
  return `File:${decoded.split('/').pop()}`
}

export function commonsUrl(path: string): string {
  return COMMONS_PREFIX + path
}

/** Cache filename for a recording; Commons paths are too long and not filesystem-safe. */
export function cacheName(path: string): string {
  const hash = createHash('sha1').update(path).digest('hex').slice(0, 16)
  const ext = /\.(ogg|oga|mp3|wav|flac)$/i.exec(path)?.[1].toLowerCase() ?? 'ogg'
  return `${hash}.${ext}`
}

/**
 * Licences that let us re-host and re-encode. Commons forbids NoDerivatives, but
 * NonCommercial files and licences needing the full text shipped alongside (GFDL) are
 * more trouble than one recording is worth.
 */
const ALLOWED = /^(cc0|cc[ -]by(-sa)?[ -][\d.]+|public domain|pd)/i
const BLOCKED = /\bnc\b|noncommercial|gfdl|fal\b/i

export function licenceAllows(meta: AudioMeta): boolean {
  const licence = meta.license?.trim() ?? ''
  if (meta.error || !licence) return false
  if (BLOCKED.test(licence)) return false
  return ALLOWED.test(licence)
}

/** Credit files are sharded like the dictionary so the page fetches one small file. */
export function shardOf(word: string): string {
  return shardKey(word)
}

/**
 * Filename for a word's encoded audio. Uppercase letters are percent-encoded along with
 * everything non-ASCII, because macOS filesystems are case-insensitive: without this,
 * `Polish` and `polish` are the same file and one silently overwrites the other.
 */
export function outName(word: string): string {
  const encoder = new TextEncoder()
  let name = ''
  for (const ch of word.normalize('NFC')) {
    if (/[a-z0-9'\-_.~]/.test(ch)) {
      name += ch
      continue
    }
    for (const byte of encoder.encode(ch)) name += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
  }
  return `${name}.opus`
}

/** The word an outName() filename stands for; the object key we upload it under. */
export function nameToWord(file: string): string {
  return decodeURIComponent(file.replace(/\.opus$/, ''))
}
