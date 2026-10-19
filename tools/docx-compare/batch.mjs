// 배치 비교: 모든 DOCX에 대해 IR(office_oxide) → 우리 조판 vs BetterOffice 정답. 쪽 수·쪽별 첫/끝 줄 일치.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/web/', import.meta.url).pathname);
const { chromium } = require('playwright-core');
// 환경변수: BO_REF(bo-reference 실행 파일), BO_ROOT(BetterOffice 체크아웃), OUT(결과 폴더), BUNDLE(esbuild IIFE 번들), FONT(측정에 쓸 글꼴 파일)
const S = (process.env.OUT ?? '/tmp/docx-compare') + '/';
mkdirSync(S + 'batch', { recursive: true });
const files = process.argv.slice(2).length ? process.argv.slice(2) : readFileSync(S + 'batch/files.txt', 'utf8').trim().split('\n');
const root = new URL('../../', import.meta.url).pathname;
const wasmDir = root + 'apps/web/src/wasm/';
const { default: init, SheetflyDoc } = await import(wasmDir + 'fmt_docx.js');
await init({ module_or_path: readFileSync(wasmDir + 'fmt_docx_bg.wasm') });
const FONT = process.env.FONT ?? '/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf';
const cases = [];
for (const f of files) {
  const name = process.env.BO_ROOT ? f.replace(process.env.BO_ROOT + '/', '') : f;
  const c = { name, ir: null, bo: null, err: null };
  try { { const full = JSON.parse(new SheetflyDoc(new Uint8Array(readFileSync(f)), 'docx').toJson()); c.ir = full.ir; c.hr = full.heading_runs; } } catch (e) { c.err = 'ir: ' + e; }
  const out = S + 'batch/bo.json';
  const r = spawnSync(process.env.BO_REF ?? 'bo-reference', [f, FONT, out], { encoding: 'utf8', timeout: 60000 });
  if (r.status === 0) { try { c.bo = JSON.parse(readFileSync(out, 'utf8')); } catch (e) { c.err = (c.err || '') + ' bo-json'; } } else c.err = (c.err || '') + ' bo: ' + (r.stderr || '').split('\n')[0].slice(0, 80);
  cases.push(c);
}
const ok = cases.filter((c) => c.ir && c.bo);
console.log(`files ${cases.length}, ir ok ${cases.filter((c) => c.ir).length}, bo ok ${cases.filter((c) => c.bo).length}, both ${ok.length}`);
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent('<body></body>');
await page.addScriptTag({ content: readFileSync(process.env.BUNDLE ?? S + 'docx-bundle.js', 'utf8') });
const boText = (bo) => bo.pages.map((pg) => {
  const arr = pg.primitives.filter((p) => p.kind === 'glyphRun' || (p.kind === 'text' && p.text)).map((p) => ({ x: p.glyphs?.[0]?.x ?? p.x, y: p.glyphs?.[0]?.y ?? p.baselineY, s: p.text })).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y);
  const lines = []; let cur = null;
  for (const t of arr) { if (!cur || Math.abs(t.y - cur.y) > 2) { cur = { y: t.y, parts: [] }; lines.push(cur); } cur.parts.push(t.s); }
  return lines.map((l) => l.parts.join('').replace(/\s+/g, ''));
});
const results = [];
for (const c of cases) {
  const row = { name: c.name, err: c.err };
  if (c.ir) {
    const r = await page.evaluate(({ ir, hr }) => {
      const D = self.SheetflyDocx; D.setFontOverride('Carlito');
      const m = D.createCanvasMeasurer();
      const t = performance.now();
      try {
        const res = D.layoutDocument(ir, m, { headingRuns: hr });
        return { ms: performance.now() - t, pages: res.pages.map((p) => { const lines = []; let cur = null; for (const it of p.items.filter((i) => i.k === 't' && !i.hf).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y)) { if (!cur || Math.abs(it.y - cur.y) > 2) { cur = { y: it.y, parts: [] }; lines.push(cur); } cur.parts.push(it.s); } return lines.map((l) => l.parts.join('').replace(/\s+/g, '')); }) };
      } catch (e) { return { error: String(e && e.stack || e) }; }
    }, { ir: c.ir, hr: c.hr });
    row.ours = r.error ? null : r.pages.length; row.error = r.error; row.ms = r.ms;
    if (c.bo && !r.error) {
      const bt = boText(c.bo);
      row.bo = bt.length;
      row.pagesMatch = bt.length === r.pages.length;
      const n = Math.min(bt.length, r.pages.length);
      let fm = 0, lm = 0, lineDiff = 0;
      for (let i = 0; i < n; i++) {
        if ((r.pages[i][0] || '') === (bt[i][0] || '')) fm++;
        if ((r.pages[i].at(-1) || '') === (bt[i].at(-1) || '')) lm++;
        lineDiff += Math.abs(r.pages[i].length - bt[i].length);
      }
      row.firstMatch = n ? fm / n : 1; row.lastMatch = n ? lm / n : 1; row.lineDiff = lineDiff;
    }
  }
  results.push(row);
}
await browser.close();
writeFileSync(S + 'batch/results.json', JSON.stringify(results, null, 1));
const both = results.filter((r) => r.bo != null && r.ours != null);
const pm = both.filter((r) => r.pagesMatch).length;
const avg = (k) => (both.reduce((a, r) => a + r[k], 0) / Math.max(1, both.length)).toFixed(3);
console.log(`비교 대상 ${both.length}개: 쪽 수 일치 ${pm} (${(100 * pm / Math.max(1, both.length)).toFixed(1)}%), 첫 줄 일치율 평균 ${avg('firstMatch')}, 끝 줄 일치율 평균 ${avg('lastMatch')}`);
console.log('우리 오류', results.filter((r) => r.error).length, '조판 ms 최대', Math.max(...results.map((r) => r.ms || 0)).toFixed(0));
const bad = both.filter((r) => !r.pagesMatch).sort((a, b) => Math.abs(b.ours - b.bo) - Math.abs(a.ours - a.bo)).slice(0, 12);
console.table(bad.map((r) => ({ name: r.name.slice(-60), ours: r.ours, bo: r.bo, lineDiff: r.lineDiff })));
