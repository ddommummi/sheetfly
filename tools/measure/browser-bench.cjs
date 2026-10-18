// Sheetfly 1단계 측정 하네스: wasm-bindgen(web) 산출물을 헤드리스 Chromium에서 돌려
// 문서 열기 / 쪽수 계산 / 쪽 SVG 렌더 시간을 잰다.
//
// 사용: node browser-bench.cjs <wasm-pkg-dir> <corpus-root> <corpus.tsv> <out.json> [maxPages]
//   corpus.tsv: "<바이트>\t<corpus-root 기준 상대경로>" 줄들
// 환경: NODE_PATH에 playwright가 있어야 한다. 브라우저는 PLAYWRIGHT_BROWSERS_PATH의 Chromium을 쓴다.
// 시스템 글꼴에 따라 글자 폭이 달라지므로 시간은 "이 기계, 이 글꼴 구성" 기준의 상대 비교용이다.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const [pkgDir, corpusRoot, corpusTsv, outJson, maxPagesArg] = process.argv.slice(2);
const MAX_PAGES = Number(maxPagesArg || 10);

const files = fs.readFileSync(corpusTsv, 'utf8').split('\n').filter(Boolean).map((l) => {
  const [size, rel] = l.split('\t');
  return { size: Number(size), rel };
});

const mime = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let p;
  if (u.startsWith('/corpus/')) p = path.join(corpusRoot, u.slice('/corpus/'.length));
  else if (u === '/') { res.setHeader('content-type', 'text/html'); return res.end('<!doctype html><meta charset=utf-8><body>bench'); }
  else p = path.join(pkgDir, u);
  fs.readFile(p, (err, buf) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', mime[path.extname(p)] || 'application/octet-stream');
    res.end(buf);
  });
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(base + '/');

  const init = await page.evaluate(async ({ base }) => {
    const t0 = performance.now();
    let ctx = null, lastFont = '';
    globalThis.__measure = { calls: 0, ms: 0 };
    globalThis.measureTextWidth = (font, text) => {
      const a = performance.now();
      if (!ctx) ctx = document.createElement('canvas').getContext('2d');
      if (font !== lastFont) { ctx.font = font; lastFont = font; }
      const w = ctx.measureText(text).width;
      globalThis.__measure.calls++; globalThis.__measure.ms += performance.now() - a;
      return w;
    };
    const mod = await import(base + '/rhwp.js');
    const tImport = performance.now();
    await mod.default({ module_or_path: base + '/rhwp_bg.wasm' });
    const tInit = performance.now();
    globalThis.__rhwp = mod;
    return { importMs: tImport - t0, wasmInitMs: tInit - tImport };
  }, { base });

  const results = [];
  for (const f of files) {
    const r = await page.evaluate(async ({ base, rel, maxPages }) => {
      const out = { rel };
      try {
        const buf = new Uint8Array(await (await fetch(base + '/corpus/' + encodeURIComponent(rel).replace(/%2F/g, '/'))).arrayBuffer());
        globalThis.__measure.calls = 0; globalThis.__measure.ms = 0;
        const t0 = performance.now();
        const doc = new globalThis.__rhwp.HwpDocument(buf);
        const t1 = performance.now();
        const pc = doc.pageCount();
        const t2 = performance.now();
        out.openMs = t1 - t0; out.pageCountMs = t2 - t1; out.pages = pc;
        const n = Math.min(pc, maxPages), times = [];
        for (let i = 0; i < n; i++) {
          const a = performance.now();
          const svg = doc.renderPageSvg(i);
          times.push(performance.now() - a);
          if (i === 0) out.firstPageSvgBytes = svg.length;
        }
        out.pageSvgMs = times;
        // Canvas2D 경로: 실제 뷰어가 쓸 경로. 이 경로에서만 JS 글자 폭 콜백이 불린다.
        globalThis.__measure.calls = 0; globalThis.__measure.ms = 0;
        const canvas = document.createElement('canvas'), ctimes = [];
        for (let i = 0; i < n; i++) {
          const a = performance.now();
          doc.renderPageToCanvas(i, canvas, 1.0);
          ctimes.push(performance.now() - a);
        }
        out.pageCanvasMs = ctimes;
        out.measureCalls = globalThis.__measure.calls; out.measureMs = globalThis.__measure.ms;
        out.firstPageTotalMs = (t1 - t0) + (t2 - t1) + (times[0] ?? 0);
        doc.free();
      } catch (e) { out.error = String(e && e.message || e).slice(0, 200); }
      return out;
    }, { base, rel: f.rel, maxPages: MAX_PAGES });
    r.size = f.size;
    results.push(r);
  }
  const memory = await page.evaluate(() => performance.memory ? performance.memory.usedJSHeapSize : null);
  await browser.close(); server.close();
  fs.writeFileSync(outJson, JSON.stringify({ init, results, usedJSHeapSize: memory, maxPages: MAX_PAGES }, null, 1));
  console.log('wrote', outJson, 'files', results.length, 'errors', results.filter((x) => x.error).length);
})();
