import { build, context, type BuildOptions } from 'esbuild'
import { cpSync, rmSync, watch, readFileSync, writeFileSync } from 'fs'
import { spawn } from 'child_process'

const isProd = process.argv.includes('--prod')
const isFirefox = process.argv.includes('--firefox')

interface Manifest {
  background: { service_worker?: string; scripts?: string[] }
  key?: string
}

const readManifest = () => JSON.parse(readFileSync('src/manifest.json', 'utf8')) as Manifest

const writeManifest = (manifest: Manifest) => {
  if (isFirefox) {
    delete manifest.key
    delete manifest.background.service_worker
  } else {
    delete manifest.background.scripts
  }
  writeFileSync('dist/manifest.json', JSON.stringify(manifest, null, 2))
}

rmSync('dist', { recursive: true, force: true })
cpSync('src/assets', 'dist', { recursive: true })
writeManifest(readManifest())
cpSync('src/reader.html', 'dist/reader.html')
cpSync('src/options.html', 'dist/options.html')

const twArgs = ['-i', 'src/styles/main.css', '-o', 'dist/reader.css']
if (isProd) twArgs.push('--minify')
else twArgs.push('--watch')

const tw = spawn('./node_modules/.bin/tailwindcss', twArgs, {
  stdio: 'inherit',
})

const sharedOptions: BuildOptions = {
  outdir: 'dist',
  bundle: true,
  target: 'chrome114',
  sourcemap: !isProd,
  minify: isProd,
  drop: isProd ? ['console'] : [],
  define: {
    'process.env.NODE_ENV': JSON.stringify(isProd ? 'production' : 'development'),
  },
}

const mainOptions: BuildOptions = {
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
    if (filename === 'manifest.json') writeManifest(readManifest())
  })
  console.log('Watching...')
}
