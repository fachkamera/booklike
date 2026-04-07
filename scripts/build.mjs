import { build, context } from 'esbuild'
import { cpSync, rmSync, watch, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { config } from 'dotenv'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
config({ path: resolve(__dirname, '../.env') })

const isProd = process.argv.includes('--prod')
const isFirefox = process.argv.includes('--firefox')

rmSync('dist', { recursive: true, force: true })
cpSync('src/assets', 'dist', { recursive: true })
const manifest = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
if (isFirefox) delete manifest.background.service_worker
else delete manifest.background.scripts
writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2))
cpSync('src/reader.html', 'dist/reader.html')
cpSync('src/options.html', 'dist/options.html')

const twArgs = ['-i', 'src/styles/main.css', '-o', 'dist/reader.css']
if (isProd) twArgs.push('--minify')
else twArgs.push('--watch')

const tw = spawn('./node_modules/.bin/tailwindcss', twArgs, {
  stdio: 'inherit',
})

const sharedOptions = {
  outdir: 'dist',
  bundle: true,
  target: 'chrome114',
  sourcemap: !isProd,
  minify: isProd,
  drop: isProd ? ['console'] : [],
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
    __PROXY_IMAGE_API__: JSON.stringify(process.env.PROXY_IMAGE_API ?? ''),
  },
}

const mainOptions = {
  ...sharedOptions,
  entryPoints: ['src/background.ts', 'src/content.ts', 'src/options.ts'],
  format: 'esm',
}

if (isProd) {
  const twDone = new Promise((resolve) => tw.on('close', resolve))
  await Promise.all([build(mainOptions), twDone])
} else {
  const [mainCtx] = await Promise.all([context(mainOptions)])
  await Promise.all([mainCtx.watch()])
  watch('src', { recursive: true }, (_, filename) => {
    if (filename === 'reader.html') cpSync('src/reader.html', 'dist/reader.html')
    if (filename === 'options.html') cpSync('src/options.html', 'dist/options.html')
    if (filename === 'manifest.json') {
      const m = JSON.parse(readFileSync('src/manifest.json', 'utf8'))
      if (isFirefox) delete m.background.service_worker
      else delete m.background.scripts
      writeFileSync('dist/manifest.json', JSON.stringify(m, null, 2))
    }
  })
  console.log('Watching...')
}
