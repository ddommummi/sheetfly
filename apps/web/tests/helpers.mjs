// E2E 공통: 서버 기동, 브라우저 기동, 요청·CSP 위반 기록.
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
export const web = resolve(here, '..');
export const samples = resolve(web, '../../third_party/rhwp/samples');

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const d of readdirSync(base).filter((x) => /^chromium-\d+$/.test(x)).sort().reverse()) {
      const p = join(base, d, 'chrome-linux', 'chrome');
      if (existsSync(p)) return p;
    }
  }
  return undefined; // playwright 기본 경로에 맡긴다
}

export async function startServer(port = 0) {
  process.env.PORT = String(port);
  const { server } = await import(`../scripts/serve.mjs?${Math.random()}`);
  await new Promise((r) => (server.listening ? r() : server.once('listening', r)));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

export async function launch() {
  return chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
}

/** 페이지에 요청/콘솔/CSP 기록을 붙인다. */
export function instrument(page, origin) {
  const rec = { requests: [], external: [], csp: [], errors: [], console: [] };
  page.on('request', (r) => {
    const u = r.url();
    rec.requests.push(u);
    if (!u.startsWith(origin) && !u.startsWith('blob:') && !u.startsWith('data:')) rec.external.push(u);
  });
  page.on('console', (m) => {
    const t = m.text();
    rec.console.push(`${m.type()}: ${t}`);
    if (/Content Security Policy|Refused to/i.test(t)) rec.csp.push(t);
  });
  page.on('pageerror', (e) => rec.errors.push(String(e.message || e)));
  return rec;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function waitState(page, state, timeout = 60000) {
  await page.waitForFunction((s) => document.body.dataset.state === s, state, { timeout });
}
