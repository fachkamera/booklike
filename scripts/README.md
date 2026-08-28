# Build scripts

Everything here is build-time tooling. None of it ships in the extension.

## Dictionary

```bash
pnpm build-dict
```

Downloads the kaikki.org wiktextract extract (cached in `.cache/`, ~480 MB) and writes the
gzipped shards in `src/assets/dict/`. `scripts/build.ts` copies those into `dist/` **at
startup only**, so a running watch process has to be restarted to pick up a rebuilt
dictionary.

Trying the extension locally needs nothing else: `scripts/audio-words.json` is committed, so
the play button appears only for the words that have a recording on
`audio.booklike.app`. The pipeline below is only for rebuilding or re-hosting the audio
corpus itself.

## Pronunciation audio

Recordings come from Wikimedia Commons, are re-encoded to Opus, and are served from an R2
bucket. Four steps, each resumable, in this order:

| step         | command                            | reads                       | writes                                                                    |
| ------------ | ---------------------------------- | --------------------------- | ------------------------------------------------------------------------- |
| 1. licences  | `node scripts/fetch-audio-meta.ts` | `.cache/audio-sources.json` | `.cache/audio-meta.jsonl`                                                 |
| 2. download  | `node scripts/fetch-audio.ts`      | the two above               | `.cache/audio/` (~840 MB)                                                 |
| 3. transcode | `node scripts/build-audio.ts`      | `.cache/audio/`             | `.cache/audio-opus/`, `scripts/audio-words.json`, `.cache/audio-credits/` |
| 4. upload    | `node scripts/upload-audio.ts`     | `.cache/audio-opus/`        | the R2 bucket                                                             |

`.cache/audio-sources.json` comes from `pnpm build-dict`, so run that first.

**Then rebuild the dictionary a second time.** Step 3 writes `scripts/audio-words.json`,
the list of words that ended up with a recording; `build-dict` reads it to decide which
entries get the audio flag. Without the second pass, words whose recording was rejected for
its licence or has vanished from Commons show a play button that plays nothing.

### Requirements

- **ffmpeg** on `PATH` (step 3).
- **`BOOKLIKE_CONTACT`** — an email address to complement the tool's user-agent for fetching wikimedia audios per [Wikimedia's User-Agent Policy](https://foundation.wikimedia.org/wiki/Policy:Wikimedia_Foundation_User-Agent_Policy))
- **`.env`** with R2 credentials (step 4 only), scoped to the bucket with Object Read & Write:

  ```
  R2_ACCOUNT_ID=...
  R2_ACCESS_KEY_ID=...
  R2_SECRET_ACCESS_KEY=...
  ```

- **CORS on the bucket**, once, before the extension can play anything from it:

  ```bash
  wrangler r2 bucket cors set booklike-audio --file scripts/r2-cors.json
  ```

### Notes

- Local filenames percent-encode uppercase letters (`Polish` → `%50olish.opus`). macOS
  filesystems are case-insensitive, so without that `Polish.opus` and `polish.opus` are the
  same file and one silently overwrites the other. The R2 key is the filename decoded.
- Recordings under a licence that does not allow re-hosting are skipped, and
  `node scripts/fetch-audio.ts --report` prints the licence breakdown including everything
  rejected.
