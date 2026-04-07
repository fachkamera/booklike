import { execSync } from 'child_process'
import { mkdirSync, readFileSync } from 'fs'

const { version } = JSON.parse(readFileSync('package.json', 'utf8'))

mkdirSync('releases', { recursive: true })

console.log(`Building v${version}...`)

execSync('node scripts/build.mjs --prod', { stdio: 'inherit' })
execSync(`cd dist && zip -r ../releases/booklike-chrome-v${version}.zip . -x '.*' -x '*/.*'`, {
  stdio: 'inherit',
  shell: true,
})

execSync('node scripts/build.mjs --prod --firefox', { stdio: 'inherit' })
execSync(`cd dist && zip -r ../releases/booklike-firefox-v${version}.zip . -x '.*' -x '*/.*'`, {
  stdio: 'inherit',
  shell: true,
})

console.log(`Done: releases/booklike-chrome-v${version}.zip, releases/booklike-firefox-v${version}.zip`)
