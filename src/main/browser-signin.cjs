const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

const APP = 'Google Chrome.app/Contents/MacOS/Google Chrome';
const OWNER = 'local.music.youtube browser sign-in v1\n';
const COOKIE_URLS = ['https://music.youtube.com/', 'https://www.youtube.com/', 'https://youtube.com/'];
const COOKIE_DOMAINS = new Set(COOKIE_URLS.map(url => new URL(url).hostname));
const AUTH_COOKIE = /^(?:SID|HSID|SSID|APISID|SAPISID|SIDCC|LOGIN_INFO|__Secure-(?:1P|3P)(?:APISID|SID(?:CC|TS|RTS)?))$/;
const SIGNED_IN_COOKIE = /^(?:SID|__Secure-(?:1P|3P)SID)$/;
const MESSAGES = {
  opening: 'Opening Google Chrome…',
  ready: 'Sign in to Google in Chrome. When YouTube Music shows your account, choose Done signing in.',
  closed: 'Chrome closed. If YouTube Music showed your account, choose Done signing in.',
  copying: 'Connecting your YouTube Music session…',
  empty: 'YouTube Music was still signed out. Sign in again and wait for your account to appear in YouTube Music.',
  failed: 'The YouTube Music session could not be transferred. Please sign in again.',
  cancelled: 'Google sign-in was cancelled.',
};

function loginURL() {
  const next = new URL('https://www.youtube.com/signin');
  next.search = new URLSearchParams({ action_handle_signin: 'true', app: 'desktop', next: COOKIE_URLS[0] });
  const entry = new URL('https://accounts.google.com/ServiceLogin');
  entry.search = new URLSearchParams({ service: 'youtube', ltmpl: 'music', uilel: '3', continue: next.href });
  return entry.href;
}

async function findChrome() {
  for (const folder of ['/Applications', path.join(os.homedir(), 'Applications')]) {
    const file = path.join(folder, APP);
    if (await fs.access(file, constants.X_OK).then(() => true, () => false)) return file;
  }
  throw Error('Install Google Chrome in Applications to sign in with a passkey.');
}

// Chrome always receives a never-before-used child of our private sign-in folder.
// The owner marker prevents adopting an existing directory with unrelated contents.
async function makeProfile(dir) {
  const root = await fs.realpath(dir);
  const chromeRoot = path.join(os.homedir(), 'Library/Application Support/Google');
  if (root === chromeRoot || root.startsWith(chromeRoot + path.sep) ||
      root === os.homedir() || root === path.parse(root).root) throw Error('Unsafe sign-in folder.');
  const base = path.join(root, 'GoogleSignIn');
  let created = true;
  await fs.mkdir(base, { mode: 0o700 }).catch(error => {
    if (error.code !== 'EEXIST') throw error;
    created = false;
  });
  const stat = await fs.lstat(base);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) {
    throw Error('Unsafe sign-in folder.');
  }
  const marker = path.join(base, '.owner');
  if (created) await fs.writeFile(marker, OWNER, { mode: 0o600, flag: 'wx' });
  const markerStat = await fs.lstat(marker);
  if (!markerStat.isFile() || markerStat.size !== Buffer.byteLength(OWNER) ||
      await fs.readFile(marker, 'utf8') !== OWNER) throw Error('Unrecognized sign-in folder.');
  return fs.mkdtemp(path.join(base, 'attempt-'));
}

function cookieDetails(cookie) {
  if (!cookie || !AUTH_COOKIE.test(cookie.name) || typeof cookie.value !== 'string' || !cookie.value ||
      cookie.partitionKey || cookie.partitionKeyOpaque || !cookie.path?.startsWith('/')) return null;
  const domain = String(cookie.domain || '').replace(/^\./, '');
  if (!COOKIE_DOMAINS.has(domain)) return null;
  const details = {
    url: 'https://' + domain + '/', name: cookie.name, value: cookie.value,
    path: cookie.path, secure: !!cookie.secure, httpOnly: !!cookie.httpOnly,
    sameSite: ({ None: 'no_restriction', Lax: 'lax', Strict: 'strict' })[cookie.sameSite] || 'unspecified',
  };
  // Supplying a domain in Electron expands a host-only cookie to subdomains.
  if (cookie.domain.startsWith('.')) details.domain = cookie.domain;
  if (!cookie.session && Number.isFinite(cookie.expires) && cookie.expires > 0) {
    if (cookie.expires <= Date.now() / 1000) return null;
    details.expirationDate = cookie.expires;
  }
  return details;
}

function withTimeout(promise, ms, message) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(message)), ms);
  })]).finally(() => clearTimeout(timer));
}

function managedProcess(child) {
  const ready = new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', () => reject(Error('Chrome could not start.')));
  });
  const processState = { child, ready, finished: false };
  processState.exit = new Promise(resolve => {
    const finish = () => { processState.finished = true; resolve(); };
    child.once('exit', finish);
    child.once('error', finish);
  });
  return processState;
}

// Signal only the exact child returned by spawn. Wait for Chrome to close its
// database before opening the one-time profile in a second process.
function stopProcess(proc) {
  if (!proc || proc.finished) return Promise.resolve();
  if (!proc.stopping) {
    proc.child.kill('SIGTERM');
    proc.stopping = withTimeout(proc.exit, 35000, 'Chrome did not close.').catch(async () => {
      if (!proc.finished) proc.child.kill('SIGKILL');
      await withTimeout(proc.exit, 5000, 'Chrome could not be stopped.');
      throw Error('Chrome did not finish saving the sign-in session.');
    });
  }
  return proc.stopping;
}

class ChromePipe {
  constructor(proc) {
    this.output = proc.child.stdio[3];
    this.pending = new Map();
    this.seq = 0;
    this.buffer = '';
    const input = proc.child.stdio[4];
    input.setEncoding('utf8');
    input.on('data', chunk => this.receive(chunk));
    input.on('end', () => this.close());
    input.on('error', () => this.close());
    this.output.on('error', () => this.close());
    proc.exit.then(() => this.close());
  }

  receive(chunk) {
    this.buffer += chunk;
    let end;
    while ((end = this.buffer.indexOf('\0')) !== -1) {
      const packet = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      let reply;
      try { reply = JSON.parse(packet); } catch { this.close(); return; }
      const waiter = this.pending.get(reply.id);
      if (!waiter) continue;
      this.pending.delete(reply.id);
      if (reply.error) waiter.reject(Error('Chrome could not read the YouTube session.'));
      else waiter.resolve(reply.result);
    }
    if (this.buffer.length > 4 * 1024 * 1024) this.close();
  }

  call(method, params = {}, sessionId) {
    if (this.closed) return Promise.reject(Error('Chrome closed.'));
    const id = ++this.seq;
    const result = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.output.write(JSON.stringify({ id, method, params, sessionId }) + '\0', err => {
        if (err) reject(Error('Chrome closed.'));
      });
    });
    return withTimeout(result, 15000, 'Chrome timed out.').finally(() => this.pending.delete(id));
  }

  close() {
    this.closed = true;
    this.buffer = '';
    for (const waiter of this.pending.values()) waiter.reject(Error('Chrome closed.'));
    this.pending.clear();
  }
}

class BrowserSignIn {
  constructor({ dir, targetSession, onStatus = () => {}, launch = spawn, locate = findChrome }) {
    this.dir = dir;
    this.targetSession = targetSession;
    this.onStatus = onStatus;
    this.launch = launch;
    this.locate = locate;
  }

  status() {
    const flow = this.flow;
    return {
      active: !!flow && !flow.cancelled, canComplete: !!flow && flow.phase === 'ready' && !flow.cancelled,
      busy: !!flow && flow.phase !== 'ready', message: flow?.message || '',
    };
  }

  report(flow, phase, message) {
    if (this.flow !== flow || flow.cancelled) return;
    flow.phase = phase;
    flow.message = message;
    this.onStatus(this.status());
  }

  assertCurrent(flow) {
    if (this.closed || flow.cancelled || this.flow !== flow) throw Error(MESSAGES.cancelled);
  }

  start() {
    if (this.closed) return Promise.reject(Error('Sign-in is closed.'));
    if (this.cancelling) return this.cancelling.then(() => this.start());
    if (this.flow) {
      const flow = this.flow;
      if (flow.phase !== 'ready' || flow.transfer) return flow.opening.then(() => this.status());
      if (flow.reopening) return flow.reopening;
      flow.reopening = this.reopen(flow).finally(() => { flow.reopening = null; });
      return flow.reopening;
    }
    const flow = this.flow = { phase: 'opening', message: MESSAGES.opening, logins: new Set() };
    flow.opening = this.open(flow).catch(async error => {
      await this.finish(flow);
      if (flow.cancelled) throw Error(MESSAGES.cancelled);
      if (error.message === 'Install Google Chrome in Applications to sign in with a passkey.') throw error;
      throw Error('A private Google Chrome sign-in window could not open.');
    });
    this.onStatus(this.status());
    return flow.opening;
  }

  async open(flow) {
    flow.executable = await this.locate();
    flow.profile = await makeProfile(this.dir);
    this.assertCurrent(flow);
    return this.showLogin(flow);
  }

  async reopen(flow) {
    this.report(flow, 'opening', MESSAGES.opening);
    try {
      return await this.showLogin(flow);
    } catch {
      this.report(flow, 'ready', 'Chrome could not reopen. If sign-in completed, choose Done signing in.');
      return this.status();
    }
  }

  async showLogin(flow) {
    // With a live profile Chrome forwards this request to its existing process.
    // Keep both handles until they exit, since Chrome can elect a new root if the
    // previous window closes during launch. Never quit or activate Chrome by name.
    const login = managedProcess(this.launch(flow.executable, [
      '--user-data-dir=' + flow.profile, '--no-first-run', '--no-default-browser-check', '--app=' + loginURL(),
    ], { stdio: 'ignore' }));
    flow.logins.add(login);
    login.exit.then(() => {
      flow.logins.delete(login);
      if (flow.phase === 'ready' && flow.logins.size === 0) this.report(flow, 'ready', MESSAGES.closed);
    });
    await login.ready;
    this.assertCurrent(flow);
    this.report(flow, 'ready', flow.logins.size ? MESSAGES.ready : MESSAGES.closed);
    return this.status();
  }

  complete() {
    const flow = this.flow;
    if (!flow || flow.cancelled || this.closed) return Promise.resolve({ ok: false, message: MESSAGES.cancelled });
    if (!flow.transfer) {
      flow.transfer = this.copy(flow).catch(() => ({
        ok: false, message: flow.cancelled ? MESSAGES.cancelled : MESSAGES.failed,
      })).finally(() => this.finish(flow));
    }
    return flow.transfer;
  }

  async copy(flow) {
    await flow.opening;
    await flow.reopening;
    this.assertCurrent(flow);
    this.report(flow, 'copying', MESSAGES.copying);
    await Promise.all([...flow.logins].map(stopProcess));
    this.assertCurrent(flow);
    flow.reader = managedProcess(this.launch(flow.executable, [
      '--user-data-dir=' + flow.profile, '--no-first-run', '--no-default-browser-check',
      '--headless=new', '--disable-background-networking', '--remote-debugging-pipe', 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] }));
    const pipe = new ChromePipe(flow.reader);
    await flow.reader.ready;
    this.assertCurrent(flow);
    const { targetId } = await pipe.call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await pipe.call('Target.attachToTarget', { targetId, flatten: true });
    // A URL-scoped request keeps even this fresh profile's Google-wide cookies
    // outside the app process. The name/domain filter below narrows it further.
    const { cookies } = await pipe.call('Network.getCookies', { urls: COOKIE_URLS }, sessionId);
    const details = cookies.map(cookieDetails).filter(Boolean);
    if (!details.some(cookie => SIGNED_IN_COOKIE.test(cookie.name))) return { ok: false, message: MESSAGES.empty };
    for (const cookie of details) {
      this.assertCurrent(flow);
      await this.targetSession.cookies.set(cookie);
    }
    this.assertCurrent(flow);
    await this.targetSession.cookies.flushStore();
    this.assertCurrent(flow);
    return { ok: true, message: '' };
  }

  finish(flow) {
    if (!flow.cleanup) {
      flow.cleanup = (async () => {
        try {
          await Promise.all([...flow.logins, flow.reader].map(stopProcess));
        } finally {
          if (flow.profile && ![...flow.logins, flow.reader].some(proc => proc && !proc.finished)) {
            await fs.rm(flow.profile, { recursive: true, force: true, maxRetries: 3 });
          }
          if (this.flow === flow) { this.flow = null; this.onStatus(this.status()); }
        }
      })();
    }
    return flow.cleanup;
  }

  cancel() {
    if (this.cancelling) return this.cancelling;
    const flow = this.flow;
    if (!flow) return Promise.resolve();
    flow.cancelled = true;
    const stopping = Promise.allSettled([...flow.logins, flow.reader].map(stopProcess));
    this.cancelling = (async () => {
      await Promise.allSettled([flow.opening, flow.reopening, flow.transfer, stopping]);
      await this.finish(flow);
    })().finally(() => { this.cancelling = null; });
    return this.cancelling;
  }

  close() {
    this.closed = true;
    return this.cancel();
  }
}

module.exports = { BrowserSignIn };

