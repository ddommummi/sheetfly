// 우리 조판 vs BetterOffice(정답 기준) 비교. 사용: node compare.mjs <ir.json> <bo-displaylist.json> <outPrefix> [font]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../apps/web/', import.meta.url).pathname);
const { chromium } = require('playwright-core');
const [, , irPath, boPath, outPrefix, font = 'Carlito'] = process.argv;
const S = (process.env.OUT ?? '/tmp/docx-compare') + '/';
const ir = JSON.parse(readFileSync(irPath, 'utf8'));
const bo = JSON.parse(readFileSync(boPath, 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent('<body></body>');
await page.addScriptTag({ content: readFileSync(process.env.BUNDLE ?? S + 'docx-bundle.js', 'utf8') });
const res = await page.evaluate(({ ir, font }) => {
  const D = self.SheetflyDocx;
  if (font) D.setFontOverride(font);
  const m = D.createCanvasMeasurer();
  const t = performance.now();
  const r = D.layoutDocument(ir, m, { headingRuns: ir.__heading_runs });
  const ms = performance.now() - t;
  return { ms, warnings: r.warnings, pages: r.pages.map((p) => ({ width: p.width, height: p.height, svg: D.pageToSvg(p, m), body: p.items.filter((i) => i.k === 't' && !i.hf).sort((a, b) => a.y - b.y || a.x - b.x).map((i) => ({ x: i.x, y: i.y, s: i.s })) })) };
}, { ir, font });
// BetterOffice 쪽별 본문 글자
const boPages = bo.pages.map((pg) => pg.primitives.filter((p) => p.kind === 'glyphRun' || (p.kind === 'text' && p.text)).map((p) => ({ x: p.glyphs?.[0]?.x ?? p.x, y: p.glyphs?.[0]?.y ?? p.baselineY, s: p.text })).sort((a, b) => Math.abs(a.y - b.y) < 2 ? a.x - b.x : a.y - b.y));
const joinText = (arr) => {
  const lines = []; let cur = null;
  for (const t of arr) { if (!cur || Math.abs(t.y - cur.y) > 2) { cur = { y: t.y, parts: [] }; lines.push(cur); } cur.parts.push(t.s); }
  return lines.map((l) => l.parts.join(''));
};
console.log(`ours: ${res.pages.length} pages (${res.ms.toFixed(0)} ms)  BetterOffice: ${boPages.length} pages`, res.warnings);
const rows = [];
for (let i = 0; i < Math.max(res.pages.length, boPages.length); i++) {
  const a = res.pages[i] ? joinText(res.pages[i].body) : [];
  const b = boPages[i] ? joinText(boPages[i]) : [];
  const nz = (x) => (x || '').replace(/\s+/g, ''); const same = a.length && b.length && nz(a[0]) === nz(b[0]);
  rows.push({ page: i + 1, ourLines: a.length, boLines: b.length, firstMatch: same, ourFirst: nz(a[0]).slice(0, 30), boFirst: nz(b[0]).slice(0, 30), ourLast: nz(a[a.length - 1]).slice(0, 30), boLast: nz(b[b.length - 1]).slice(0, 30), lastMatch: nz(a[a.length - 1]) === nz(b[b.length - 1]) });
}
console.table(rows);
for (const [i, p] of res.pages.entries()) {
  writeFileSync(`${outPrefix}-p${i}.svg`, p.svg);
  if (i < 2) {
    await page.setViewportSize({ width: Math.ceil(p.width), height: Math.ceil(p.height) });
    await page.setContent(`<body style="margin:0"><img src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(p.svg)}"></body>`);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outPrefix}-p${i}.png` });
  }
}
await browser.close();
