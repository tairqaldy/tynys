// Layout check in a real browser engine: no horizontal overflow at phone and tablet widths with the
// example route drawn and every "Show the math" panel open.
//
// Runs only with TYNYS_E2E=1 against a fresh `pnpm build` (use `pnpm test:layout`). It serves dist/
// with `vite preview` on port 4317, loads the page in mock mode inside a same-origin iframe of the
// exact width (headless Chrome windows cannot be narrower than 500 px), and reads back
// documentElement.scrollWidth through `--dump-dom`. Everything it starts is stopped afterwards.

import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { preview, type Plugin, type PreviewServer } from 'vite';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 4317;
const enabled = !!process.env.TYNYS_E2E && existsSync('dist/index.html') && existsSync(CHROME);

const HARNESS = `<!doctype html><html><body style="margin:0">
<pre id="out">pending</pre>
<script>
const q = new URLSearchParams(location.search);
const w = Number(q.get('w'));
try { localStorage.setItem('tynys.city', 'astana'); localStorage.setItem('tynys.theme', 'light'); } catch (e) {}
const f = document.createElement('iframe');
f.src = '/?mock=1';
f.style.cssText = 'border:0;display:block;width:' + w + 'px;height:900px';
document.body.appendChild(f);
f.onload = () => setTimeout(() => {
  const d = f.contentDocument;
  d.querySelectorAll('details.panel').forEach((x) => (x.open = true));
  setTimeout(() => {
    const vw = d.documentElement.clientWidth;
    const wide = [...d.querySelectorAll('body *')]
      .filter((el) => el.getBoundingClientRect().right > vw + 0.5 && !el.closest('.maplibregl-map') && !el.closest('.sr-only'))
      .slice(0, 8)
      .map((el) => el.tagName.toLowerCase() + '.' + String(el.className.baseVal ?? el.className).split(' ')[0] + ' ' + Math.round(el.getBoundingClientRect().right));
    document.getElementById('out').textContent = JSON.stringify({
      vw,
      scrollWidth: d.documentElement.scrollWidth,
      wide,
      route: !!d.querySelector('.route-cards'),
      example: !!d.querySelector('.example-note'),
      panels: d.querySelectorAll('details.panel[open]').length,
    });
  }, 1500);
}, 4000);
</script></body></html>`;

const harness: Plugin = {
  name: 'layout-harness',
  configurePreviewServer(server) {
    server.middlewares.use('/__layout', (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(HARNESS);
    });
  },
};

function run(width: number, profile: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    execFile(
      CHROME,
      [
        '--headless=new',
        `--user-data-dir=${profile}`,
        '--hide-scrollbars',
        '--window-size=1300,1000',
        '--virtual-time-budget=20000',
        '--dump-dom',
        `http://localhost:${PORT}/__layout?w=${width}`,
      ],
      { timeout: 90_000, maxBuffer: 20 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return reject(err);
        const m = /<pre id="out">([^<]*)<\/pre>/.exec(stdout);
        if (!m) return reject(new Error('harness output missing'));
        try {
          resolve(JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')));
        } catch {
          reject(new Error(`harness did not finish: ${m[1].slice(0, 80)}`));
        }
      },
    );
  });
}

describe.skipIf(!enabled)('layout in headless Chrome', () => {
  let server: PreviewServer;
  let profile: string;
  beforeAll(async () => {
    profile = mkdtempSync(join(tmpdir(), 'tynys-layout-'));
    server = await preview({ preview: { port: PORT, strictPort: true, host: 'localhost' }, plugins: [harness], logLevel: 'silent' });
  }, 30_000);
  afterAll(async () => {
    await server?.close();
    if (profile) rmSync(profile, { recursive: true, force: true });
  });

  it.each([375, 768, 1280])('no horizontal overflow at %i px with the math panels open', async (w) => {
    const r = await run(w, profile);
    expect(r.panels).toBe(3);
    expect(r.route, 'example route drawn').toBe(true);
    expect(r.example, 'example route marked').toBe(true);
    expect({ scrollWidth: r.scrollWidth, wide: r.wide }).toEqual({ scrollWidth: w, wide: [] });
  }, 120_000);
});
