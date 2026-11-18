const { test } = require('node:test')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')

test('glass analyzer separates three known frequencies and settles in silence', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'prism-levels-'))
  try {
    const binary = path.join(directory, 'test')
    const source = path.resolve(__dirname, '../native/levels-test.cpp')
    execFileSync('xcrun', ['clang++', '-std=c++17', source, '-o', binary])
    execFileSync(binary)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('the registered macOS command block dispatches once and unregisters on quit', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'prism-remote-'))
  try {
    const addon = path.join(directory, 'test.node')
    const root = path.resolve(__dirname, '..')
    execFileSync(process.execPath, [path.join(root, 'scripts/native-build.cjs'), '--test-remote', addon])
    execFileSync(require('electron'), ['--user-data-dir=' + directory, path.join(root, 'native/remote-smoke.cjs')], {
      env: { ...process.env, PRISM_TEST_ADDON: addon }, timeout: 15000,
    })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

