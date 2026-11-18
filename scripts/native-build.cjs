const { spawnSync } = require('node:child_process')
const path = require('node:path')
const fs = require('node:fs')
if (process.platform !== 'darwin') process.exit(0)

const root = path.resolve(__dirname, '..')
const headers = process.env.NODE_API_HEADERS || require('node-api-headers').include_dir
const testTarget = process.argv[2] === '--test-remote' ? process.argv[3] : null
const target = testTarget || path.join(root, 'native', 'prism.node')
const output = target + '.tmp'
const compile = spawnSync('xcrun', [
  'clang++', '-std=c++17', '-fobjc-arc', '-O2', '-Wall', '-Wextra',
  '-mmacosx-version-min=14.0', '-DNAPI_VERSION=8', '-bundle', '-undefined', 'dynamic_lookup',
  ...(testTarget ? ['-DPRISM_REMOTE_TEST'] : []),
  '-I', headers, '-framework', 'AppKit', '-framework', 'CoreAudio', '-framework', 'MediaPlayer',
  path.join(root, 'native', 'prism.mm'), path.join(root, 'native', 'remote.mm'), '-o', output,
], { stdio: 'inherit' })
if (compile.status !== 0) process.exit(compile.status ?? 1)
fs.renameSync(output, target)

