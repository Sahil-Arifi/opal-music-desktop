const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough, Writable } = require('node:stream');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { BrowserSignIn } = require('../src/main/browser-signin.cjs');

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const mockCookie = (name, domain, extra = {}) => ({
  name, domain, value: 'synthetic-test-value', path: '/', secure: true, httpOnly: true,
  session: false, expires: Date.now() / 1000 + 3600, sameSite: 'Lax', ...extra,
});

function mockChild() {
  const child = new EventEmitter();
  child.signals = [];
  child.kill = signal => {
    child.signals.push(signal);
    setImmediate(() => child.emit('exit', 0, null));
    return true;
  };
  queueMicrotask(() => child.emit('spawn'));
  return child;
}

function mockReader(cookies, calls) {
  const child = mockChild();
  const input = new PassThrough();
  const output = new Writable({
    write(raw, _, callback) {
      const { id, method, params, sessionId } = JSON.parse(raw.toString().slice(0, -1));
      calls.push({ method, params, sessionId });
      const result = method === 'Target.createTarget' ? { targetId: 'target' } :
        method === 'Target.attachToTarget' ? { sessionId: 'session' } : { cookies };
      const msg = JSON.stringify({ id, result });
      input.write(msg.slice(0, 4)); input.write(msg.slice(4) + '\0');
      callback();
    },
  });
  child.stdio = [null, null, null, output, input];
  return child;
}

async function fixture(t, { cookies = [], set, launch } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'music-bridge-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const spawns = [], calls = [], written = [], flushed = [];
  const bridge = new BrowserSignIn({
    dir, locate: async () => chrome,
    targetSession: { cookies: {
      set: set || (async cookie => { written.push(cookie); }),
      flushStore: async () => { flushed.push(true); },
    } },
    launch: (executable, args, options) => {
      const reader = args.includes('--remote-debugging-pipe');
      const child = launch ? launch({ executable, args, options, reader }) :
        reader ? mockReader(cookies, calls) : mockChild();
      spawns.push({ child, args, options });
      return child;
    },
  });
  t.after(() => bridge.close());
  return { bridge, dir, spawns, calls, written, flushed };
}

test('sign-in launches an isolated regular Chrome, then transfers only unpartitioned YouTube identity cookies', async t => {
  const { bridge, spawns, dir, calls, written, flushed } = await fixture(t, { cookies: [
    mockCookie('SID', '.youtube.com'), mockCookie('__Secure-3PSID', 'music.youtube.com', { session: true, expires: -1 }),
    mockCookie('SID', '.google.com'), mockCookie('SID', 'accounts.google.com'), mockCookie('SID', 'youtube.com.evil.test'),
    mockCookie('PREF', '.youtube.com'), mockCookie('SIDCC', '.youtube.com', { partitionKey: { topLevelSite: 'https://different.test' } }),
    mockCookie('HSID', '.youtube.com', { expires: 1 }),
  ] });
  const ready = await bridge.start();
  assert.equal(ready.canComplete, true);
  assert.equal(spawns.length, 1);
  const args = spawns[0].args;
  assert.equal(args.some(a => /headless|debugging|automation|mock-keychain/.test(a)), false);
  const entry = new URL(args.find(a => a.startsWith('--app=')).slice(6));
  assert.equal(entry.origin, 'https://accounts.google.com');
  assert.equal(new URL(entry.searchParams.get('continue')).searchParams.get('next'), 'https://music.youtube.com/');
  const profile = args[0].split('=')[1];
  assert.equal(path.dirname(profile), path.join(await fs.realpath(dir), 'GoogleSignIn'));
  assert.equal((await fs.stat(profile)).mode & 0o777, 0o700);

  const pending = bridge.complete();
  assert.equal(pending, bridge.complete());
  assert.equal((await pending).ok, true);
  assert.deepEqual(spawns[0].child.signals, ['SIGTERM']);
  assert.deepEqual(spawns[1].child.signals, ['SIGTERM']);
  assert.equal(spawns[1].args[0], args[0]);
  assert.deepEqual(calls.map(c => c.method), ['Target.createTarget', 'Target.attachToTarget', 'Network.getCookies']);
  assert.deepEqual(calls.at(-1).params.urls, ['https://music.youtube.com/', 'https://www.youtube.com/', 'https://youtube.com/']);
  assert.deepEqual(written.map(c => c.name), ['SID', '__Secure-3PSID']);
  assert.equal(written[0].domain, '.youtube.com');
  assert.equal(written[0].sameSite, 'lax');
  assert.equal(written[0].httpOnly, true);
  assert.equal('domain' in written[1], false);
  assert.equal('expirationDate' in written[1], false);
  assert.equal(flushed.length, 1);
  assert.equal(bridge.status().active, false);
  await assert.rejects(fs.stat(profile), { code: 'ENOENT' });
});

test('refuses unowned directories and symlinks without altering their contents', async t => {
  const { dir, bridge, spawns } = await fixture(t);
  const base = path.join(dir, 'GoogleSignIn');
  const unrelated = path.join(dir, 'existing-profile');
  await fs.mkdir(unrelated, { mode: 0o700 });
  await fs.writeFile(path.join(unrelated, 'Default'), 'fixture sentinel');
  await fs.symlink(unrelated, base);
  await assert.rejects(bridge.start(), /private Google Chrome/);
  await fs.unlink(base);
  await fs.rename(unrelated, base);
  await assert.rejects(bridge.start(), /private Google Chrome/);
  assert.equal(await fs.readFile(path.join(base, 'Default'), 'utf8'), 'fixture sentinel');
  assert.equal(spawns.length, 0);
});

test('closing the login window never imports anything until the user chooses Done', async t => {
  const { bridge, spawns, written } = await fixture(t);
  await bridge.start();
  spawns[0].child.emit('exit', 0, null);
  await new Promise(setImmediate);
  assert.equal(bridge.status().canComplete, true);
  assert.equal(spawns.length, 1);
  await bridge.cancel();
  assert.equal(spawns.length, 1);
  assert.deepEqual(written, []);
  await bridge.start();
  assert.notEqual(spawns[0].args[0], spawns[1].args[0]);
  assert.equal((await bridge.complete()).ok, false);
  assert.deepEqual(written, []);
});

test('Reopen Chrome uses the same owned profile after closing and tracks a forwarding launcher separately', async t => {
  const { bridge, spawns, written } = await fixture(t);
  await bridge.start();
  const profile = spawns[0].args[0];
  await bridge.start();
  assert.equal(spawns[1].args[0], profile);
  spawns[1].child.emit('exit', 0, null);
  await new Promise(setImmediate);
  assert.doesNotMatch(bridge.status().message, /Chrome closed/);
  spawns[0].child.emit('exit', 0, null);
  await new Promise(setImmediate);
  assert.match(bridge.status().message, /Chrome closed/);
  await bridge.start();
  assert.equal(spawns[2].args[0], profile);
  assert.equal(spawns[2].args.some(a => a.includes('debugging')), false);
  await bridge.cancel();
  assert.deepEqual(spawns.map(s => s.child.signals), [[], [], ['SIGTERM']]);
  assert.deepEqual(written, []);
});

test('cancel waits for an already-started cookie write and prevents later writes', async t => {
  const started = Promise.withResolvers(), release = Promise.withResolvers();
  let count = 0;
  const { bridge, flushed } = await fixture(t, { cookies: [mockCookie('SID', '.youtube.com'), mockCookie('HSID', '.youtube.com')],
    set: async () => { count++; started.resolve(); await release.promise; } });
  await bridge.start();
  const pending = bridge.complete();
  await started.promise;
  let returned = false;
  const cancelled = bridge.cancel().then(() => { returned = true; });
  await new Promise(setImmediate);
  assert.equal(returned, false);
  release.resolve();
  await cancelled;
  assert.equal((await pending).ok, false);
  assert.equal(count, 1);
  assert.equal(flushed.length, 0);
});

test('an Electron cookie failure cannot leak its details in status or return data', async t => {
  const { bridge } = await fixture(t, { cookies: [mockCookie('SID', '.youtube.com')],
    set: async () => { throw Error('sensitive dummy value'); } });
  await bridge.start();
  assert.deepEqual(await bridge.complete(), { ok: false, message: 'The YouTube Music session could not be transferred. Please sign in again.' });
  assert.equal(bridge.status().active, false);
});

test('installed Chrome reads fixture cookies through the scoped production pipe after a native profile flush', {
  skip: process.platform !== 'darwin', timeout: 60000,
}, async t => {
  if (!await fs.access(chrome).then(() => true, () => false)) return t.skip('Google Chrome is not installed');
  const { chromium } = require('playwright-core');
  const { bridge, spawns, written } = await fixture(t, { launch: ({ executable, args, options, reader }) =>
    reader ? spawn(executable, [...args, '--use-mock-keychain'], options) : mockChild() });
  await bridge.start();
  const profile = spawns[0].args[0].slice('--user-data-dir='.length);
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: chrome, headless: true, offline: true, args: ['--use-mock-keychain', '--disable-background-networking'],
  });
  try {
    await context.addCookies(['.youtube.com', '.google.com', '.fixture.invalid'].map(domain => ({
      domain, path: '/', name: 'SID', value: 'fixture', secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 600,
    })));
  } finally { await context.close(); }
  assert.equal((await bridge.complete()).ok, true);
  assert.deepEqual(written.map(c => [c.name, c.domain]), [['SID', '.youtube.com']]);
  await assert.rejects(fs.stat(profile), { code: 'ENOENT' });
});

