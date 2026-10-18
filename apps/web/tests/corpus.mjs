// 코퍼스 크래시 시험: 샘플 문서 전체를 실제 Worker(CSP 헤더 적용 환경)로 열고
// 앞쪽 쪽들과 마지막 쪽을 렌더하고 전체 검색까지 수행해, 엔진 trap(크래시)·멈춤을 분류한다.
//   node tests/corpus.mjs [--limit N] [--timeout 60] [--max-mb 40] [--out result.json]
// 분류: ok / password(비밀번호 요구, 정상) / corrupt(우아한 오류, 크래시 아님) / crash(trap·worker 죽음) / timeout / render_error
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { startServer, launch, instrument, samples } from './helpers.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 0));
const TIMEOUT = Number(arg('timeout', 60)) * 1000;
const MAX_BYTES = Number(arg('max-mb', 40)) * 1048576;
const OUT = arg('out', '');
const RENDER_PAGES = 40;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(hwp|hwpx)$/i.test(e.name)) yield p;
  }
}
let files = [...walk(samples)].map((p) => ({ p, rel: relative(samples, p), size: statSync(p).size })).filter((f) => f.size <= MAX_BYTES);
files.sort((a, b) => a.rel.localeCompare(b.rel));
if (LIMIT) files = files.slice(0, LIMIT);

const { server, url } = await startServer(0);
const browser = await launch();
const page = await browser.newPage();
const rec = instrument(page, url);
await page.goto(url + '/');
let currentBuf = Buffer.alloc(0);
await page.route(`${url}/__corpus`, (route) => route.fulfill({ status: 200, contentType: 'application/octet-stream', body: currentBuf }));

// 페이지 안에서 앱과 같은 Worker 코드를 직접 구동한다 (UI 우회, 엔진·Worker 경로만 시험).
const results = [];
const t00 = Date.now();
for (const [idx, f] of files.entries()) {
  currentBuf = readFileSync(f.p);
  const t0 = Date.now();
  let r;
  try {
    r = await Promise.race([
      page.evaluate(async ({ pages }) => {
        const workerUrl = document.querySelector('meta[name="sheetfly-worker"]').content;
        const wasmUrl = document.querySelector('meta[name="sheetfly-wasm"]').content;
        const w = new Worker(workerUrl, { type: 'module' });
        window.__w = w;
        let id = 1;
        const pending = new Map();
        let dead = null;
        w.onmessage = (e) => { const m = e.data; if (m.type === 'progress') return; const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m); } };
        w.onerror = (e) => { dead = e.message || 'worker error'; for (const p of pending.values()) p({ ok: false, error: { code: 'worker_crashed', message: dead } }); pending.clear(); };
        const req = (type, payload = {}, transfer = []) => new Promise((res) => { const i = id++; pending.set(i, res); w.postMessage({ type, id: i, ...payload }, transfer); });
        const out = { stage: 'init' };
        try {
          let m = await req('init', { wasmUrl });
          if (!m.ok) return { status: 'crash', stage: 'init', msg: m.error.message };
          out.stage = 'open';
          const ab = await (await fetch('/__corpus')).arrayBuffer();
          m = await req('open', { buffer: ab }, [ab]);
          if (!m.ok) {
            const c = m.error.code;
            if (c === 'password_required') return { status: 'password' };
            if (c === 'corrupt' || c === 'drm' || c === 'no_pages') return { status: 'corrupt', code: c, msg: m.error.message.slice(0, 120) };
            return { status: 'crash', stage: 'open', code: c, msg: m.error.message.slice(0, 160) };
          }
          const n = m.pageCount;
          out.pages = n;
          out.stage = 'render';
          const list = [];
          for (let i = 0; i < Math.min(n, pages); i++) list.push(i);
          if (n > pages) list.push(n - 1);
          let renderErrors = 0;
          for (const i of list) {
            const r = await req('render', { page: i });
            if (!r.ok) {
              if (r.error.code === 'worker_crashed') return { status: 'crash', stage: 'render', page: i, msg: r.error.message.slice(0, 160), pages: n };
              renderErrors++;
            } else if (r.svg.byteLength < 50) renderErrors++;
          }
          out.stage = 'search';
          const s = await req('search', { query: '의', caseSensitive: false });
          if (!s.ok && s.error.code === 'worker_crashed') return { status: 'crash', stage: 'search', msg: s.error.message.slice(0, 160), pages: n };
          return { status: renderErrors ? 'render_error' : 'ok', pages: n, renderErrors, hits: s.ok ? s.hits : -1 };
        } catch (e) {
          return { status: 'crash', stage: out.stage, msg: String(e && e.message || e).slice(0, 160) };
        } finally { w.terminate(); }
      }, { pages: RENDER_PAGES }),
      new Promise((res) => setTimeout(() => res({ status: 'timeout' }), TIMEOUT)),
    ]);
  } catch (e) {
    r = { status: 'crash', stage: 'harness', msg: String(e.message || e).slice(0, 160) };
  }
  if (r.status === 'timeout') { try { await page.evaluate(() => window.__w?.terminate()); } catch { /* ignore */ } }
  r.rel = f.rel; r.size = f.size; r.ms = Date.now() - t0;
  results.push(r);
  if (r.status === 'crash' || r.status === 'timeout' || r.status === 'render_error') console.log(`[${r.status}] ${f.rel} ${JSON.stringify(r)}`);
  if ((idx + 1) % 100 === 0) console.log(`  … ${idx + 1}/${files.length} (${Math.round((Date.now() - t00) / 1000)}s)`);
}

const count = (s) => results.filter((r) => r.status === s).length;
const summary = {
  files: results.length, ok: count('ok'), password: count('password'), corrupt: count('corrupt'),
  render_error: count('render_error'), crash: count('crash'), timeout: count('timeout'),
  pages: results.reduce((a, r) => a + (r.pages || 0), 0), seconds: Math.round((Date.now() - t00) / 1000),
  externalRequests: rec.external.length, cspViolations: rec.csp.length, pageErrors: rec.errors.length,
};
console.log(JSON.stringify(summary, null, 1));
const corrupt = results.filter((r) => r.status === 'corrupt');
if (corrupt.length) console.log('corrupt(우아한 오류):', corrupt.map((r) => `${r.rel} [${r.msg}]`).join('\n  '));
if (OUT) writeFileSync(OUT, JSON.stringify({ summary, results }, null, 1));
await browser.close(); server.close();
process.exit(summary.crash || summary.externalRequests || summary.cspViolations || summary.pageErrors ? 1 : 0);
