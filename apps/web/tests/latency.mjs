// UI 기준 지연 측정: 파일을 고른 순간(change 이벤트) → 첫 쪽 이미지가 로드되어 data-rendered=1이 되는 순간.
//   immediate : 페이지 로드 직후 바로 여는 경우 (Worker/WASM 초기화와 겹침)
//   warm      : Worker 예열이 끝난 뒤 여는 경우 (보통의 사용)
//   second    : 같은 페이지에서 이어서 두 번째 문서를 여는 경우
//   node tests/latency.mjs [--list docs/phase1/data/corpus-94-files.tsv] [--limit 60] [--out x.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { startServer, launch, samples, sleep, web } from './helpers.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const list = resolve(web, arg('list', '../../docs/phase1/data/corpus-94-files.tsv'));
const limit = Number(arg('limit', 60));
const out = arg('out', '');
const files = readFileSync(list, 'utf8').split('\n').filter(Boolean).map((l) => l.split('\t')[1]).slice(0, limit);

const { server, url } = await startServer(0);
const browser = await launch();
const pct = (xs, p) => { xs = [...xs].sort((a, b) => a - b); const k = (xs.length - 1) * p / 100, f = Math.floor(k), c = Math.min(f + 1, xs.length - 1); return xs[f] + (xs[c] - xs[f]) * (k - f); };

const INSTALL = () => {
  window.__t = null;
  const input = document.getElementById('file-input');
  input.addEventListener('change', () => { window.__t = { t0: performance.now(), t1: null }; }, true);
  new MutationObserver(() => {
    if (window.__t && !window.__t.t1 && document.querySelector('.page[data-rendered="1"]')) window.__t.t1 = performance.now();
  }).observe(document.getElementById('pages'), { attributes: true, subtree: true, attributeFilter: ['data-rendered'] });
};
const reset = () => { window.__t = null; };

const rows = [];
async function measure(page, file) {
  await page.evaluate(reset);
  await page.setInputFiles('#file-input', file);
  try {
    await page.waitForFunction(() => window.__t && window.__t.t1, null, { timeout: 60000 });
    const t = await page.evaluate(() => window.__t);
    return t.t1 - t.t0;
  } catch { return null; }
}
async function freshPage() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.goto(url + '/');
  await page.evaluate(INSTALL);
  return { ctx, page };
}
for (const rel of files) {
  const buf = readFileSync(`${samples}/${rel}`);
  const file = { name: basename(rel), mimeType: 'application/octet-stream', buffer: buf };
  const row = { rel, size: buf.length };
  // immediate: 페이지 로드 직후 바로 연다 (Worker 초기화가 아직 끝나지 않았을 수 있음)
  let { ctx, page } = await freshPage();
  row.immediate = await measure(page, file);
  await ctx.close();
  // warm: Worker 예열이 끝난 뒤 연다 (사용자가 파일을 고르는 보통의 경우)
  ({ ctx, page } = await freshPage());
  await sleep(800);
  row.warm = await measure(page, file);
  // second: 같은 페이지에서 이어서 두 번째 문서를 연다 (앱이 다음 Worker를 미리 올려 둔 뒤)
  await page.evaluate(() => { document.querySelectorAll('.page[data-rendered]').forEach((e) => delete e.dataset.rendered); });
  await sleep(800);
  row.second = await measure(page, file);
  await ctx.close();
  rows.push(row);
}
const ok = (k) => rows.map((r) => r[k]).filter((v) => v != null);
const summary = {};
for (const k of ['immediate', 'warm', 'second']) summary[k] = { n: ok(k).length, p50: Math.round(pct(ok(k), 50)), p95: Math.round(pct(ok(k), 95)), max: Math.round(Math.max(...ok(k))) };
console.log(JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, rows }, null, 1));
await browser.close(); server.close();
