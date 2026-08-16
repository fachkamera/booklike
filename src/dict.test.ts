import { existsSync, readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { DICT_CASES } from './dict.cases.ts'

const ASSETS = new URL('./assets/', import.meta.url)

/**
 * `lookup` reads the bundle through the extension's own path: `chrome.runtime.getURL`
 * plus `fetch` plus gzip. Pointing those two at the shard directory runs the real
 * resolution code unchanged, so the cases test the shipped bundle rather than a fixture.
 */
;(globalThis as { chrome?: unknown }).chrome = {
  runtime: { getURL: (path: string) => new URL(path, ASSETS).href },
}
const realFetch = globalThis.fetch
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  if (!url.startsWith('file:')) return realFetch(input, init)
  // Missing shards reject in the extension too, and `lookup` reads that as "unknown word".
  if (!existsSync(new URL(url))) return Promise.reject(new Error('not found'))
  return Promise.resolve(new Response(readFileSync(new URL(url))))
}) as typeof fetch

const { lookup } = await import('./dict.ts')

const skip = existsSync(new URL('dict/', ASSETS)) ? false : 'no bundle — run scripts/build-dict.mjs'

for (const { word, cap, w } of DICT_CASES) {
  void test(`${word}${cap ? ' (deliberate capital)' : ''} -> ${w ?? 'nothing'}`, { skip }, async () => {
    const entry = await lookup(word, cap)
    assert.equal(entry?.w ?? null, w)
  })
}
