// Take the README screenshots with headless Chrome over the DevTools protocol.
// No dependencies: Node 22 (global fetch and WebSocket) and a local Google Chrome.
//
//   node scripts/screenshots.mjs [base-url]        default base-url: http://localhost:5173
//
// Real time is used for waiting (not virtual time), so map tiles and API calls finish.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:5173';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// name, path + query, viewport, colour scheme; optional: scroll to a heading (scrollTo) or an element id
// (scrollId), open the first <details> (openMath), run a script before the capture (before).
const SHOTS = [
  { name: 'overview', query: '/?city=almaty', w: 1440, h: 900, scheme: 'light' },
  { name: 'overview-dark', query: '/?city=astana', w: 1440, h: 900, scheme: 'dark' },
  { name: 'when', query: '/?city=almaty&activity=kids', w: 1440, h: 900, scheme: 'light', scrollTo: 'When should I go out?', offset: 0 },
  { name: 'route', query: '/?city=almaty', w: 1440, h: 900, scheme: 'light', scrollTo: 'Which way should I walk?', offset: 330 },
  { name: 'math', query: '/?city=almaty', w: 1440, h: 900, scheme: 'light', openMath: true, scrollTo: 'Hidden Markov model', offset: -40 },
  { name: 'phone', query: '/?city=almaty', w: 390, h: 844, scheme: 'light', mobile: true },
  { name: 'docs', query: '/docs', w: 1440, h: 900, scheme: 'light' },
  { name: 'docs-hmm', query: '/docs', w: 1440, h: 900, scheme: 'light', scrollId: 'hmm', before: "document.querySelectorAll('#hmm .hl-feed__btn')[2]?.click()" },
  { name: 'docs-mdp', query: '/docs', w: 1440, h: 900, scheme: 'light', scrollId: 'mdp', before: "document.querySelector('#mdp .lab-btn--solid')?.click()" },
  { name: 'docs-astar', query: '/docs', w: 1440, h: 900, scheme: 'light', scrollId: 'astar' },
  { name: 'docs-dark', query: '/docs', w: 1440, h: 900, scheme: 'dark', scrollId: 'results' },
];

const profile = mkdtempSync(join(tmpdir(), 'tynys-shots-'));
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--hide-scrollbars',
  '--force-color-profile=srgb', '--no-first-run', 'about:blank',
], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = targets.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error('Chrome did not start');
}

try {
  const ws = new WebSocket(await connect());
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id); }
  });
  const send = (method, params = {}) => new Promise((resolve) => {
    pending.set(++id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
  const run = (expression) => send('Runtime.evaluate', { expression, awaitPromise: true });

  mkdirSync(OUT, { recursive: true });
  await send('Page.enable');
  for (const s of SHOTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.mobile ? 2 : 1, mobile: !!s.mobile });
    await send('Emulation.setEmulatedMedia', { features: [
      { name: 'prefers-color-scheme', value: s.scheme },
      { name: 'prefers-reduced-motion', value: 'reduce' },
    ] });
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: BASE + s.query });
    await sleep(1500);
    await run('try { localStorage.clear() } catch (e) {}');   // ignore a remembered theme or city
    await send('Page.navigate', { url: BASE + s.query });
    await sleep(9000);                                         // API calls, style, tiles, example route
    if (s.openMath) {
      await run(`document.querySelector('details') && (document.querySelector('details').open = true)`);
      await sleep(500);
    }
    if (s.scrollId) {
      await run(`document.getElementById(${JSON.stringify(s.scrollId)})?.scrollIntoView({ behavior: 'instant' })`);
      await sleep(2500);
    }
    if (s.before) {
      await run(s.before);
      await sleep(2500);
    }
    if (s.scrollTo) {
      await run(`(() => { const h = [...document.querySelectorAll('h2,h3')].find((x) => x.innerText.trim().startsWith(${JSON.stringify(s.scrollTo)}));
        if (h) window.scrollTo({ top: h.getBoundingClientRect().top + window.scrollY + ${s.offset || 0} - 120, behavior: 'instant' }); })()`);
      await sleep(2500);
    }
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(join(OUT, `${s.name}.png`), Buffer.from(shot.data, 'base64'));
    console.log('saved', `${s.name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(300);
  rmSync(profile, { recursive: true, force: true });
}
