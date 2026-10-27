// Chromium에서 우리 조판의 줄 높이를 재고, GenOffice의 Word 실측 정답(한국어 시험 파일)과 비교한다.
//   GENOFFICE_DIR=… node make-patched.mjs && node prep.mjs && VARIANTS=none,noto,win,win+fix,win+fix+br node run.mjs
// 환경변수: GENOFFICE_DIR(필수), PW_DIR(playwright-core가 설치된 폴더, 기본 apps/web), CHROMIUM(실행 파일, 기본 Playwright 설치본)
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));                 // 이 폴더(page.html)
const OUT = fileURLToPath(new URL('../out/lineheight/', import.meta.url));  // 생성물(ir/, paragraph.patched.js)
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const WEB = ROOT + 'apps/web/';
const FONT = ROOT + 'third_party/rhwp/ttfs/opensource/NotoSansKR-Regular.ttf';   // OFL. scripts/fetch-rhwp.sh가 받는다
const T = (process.env.GENOFFICE_DIR ?? (() => { throw new Error('GENOFFICE_DIR 필요'); })()) + '/packages/docx-engine/tests/fixtures/truths/';
const { chromium } = createRequire((process.env.PW_DIR ?? WEB) + '/package.json')('playwright-core');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.ttf': 'font/ttf' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); let p;
  if (u.pathname === '/page.html') p = HERE + 'page.html';
  else if (u.pathname === '/srcbr/docx/paragraph.js') p = OUT + 'paragraph.patched.js';
  else if (u.pathname.startsWith('/srcbr/')) p = join(WEB, u.pathname.replace('/srcbr/', '/src/'));
  else if (u.pathname.startsWith('/src/')) p = join(WEB, u.pathname);
  else if (u.pathname.startsWith('/fonts/')) p = FONT;
  if (!p || !existsSync(p)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': MIME[extname(p)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(readFileSync(p));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });

// 정답 케이스: truth.json의 linePt 중 단일 줄 문단(block = 문단 순서)
const cases = (dir, file = dir) => JSON.parse(readFileSync(T + dir + '/truth.json')).cases.filter((c) => c.kind === 'linePt').map((c) => ({ ...c, probe: file }));
const ALL = [...cases('malgun-line-pitch-sizes'), ...cases('cjk-face-factors')];

const results = {};
const VARIANTS = (process.env.VARIANTS ?? 'none,noto,win').split(',');
for (const env of VARIANTS) {
  const page = await browser.newPage();
  const [e0, ...flags] = env.split('+'); await page.goto(`${base}/page.html?env=${e0}${flags.includes('fix') ? '&fix=1' : ''}${flags.includes('br') ? '&br=1' : ''}`);
  await page.waitForFunction('window.READY === true', null, { timeout: 30000 });
  const metrics = {
    '맑은 고딕': await page.evaluate(() => window.canvasMetrics('100px "맑은 고딕", "Malgun Gothic", "Apple SD Gothic Neo", "Noto Sans KR", "Noto Sans CJK KR", "NanumGothic", sans-serif')),
    Batang: await page.evaluate(() => window.canvasMetrics('100px "Batang", "바탕", "Noto Serif KR", "Noto Serif CJK KR", "AppleMyungjo", serif')),
  };
  const lines = {};
  for (const probe of new Set(ALL.map((c) => c.probe))) {
    const full = JSON.parse(readFileSync(`${OUT}ir/${probe}.json`));
    lines[probe] = await page.evaluate((f) => window.lineHeights(f), full);
  }
  results[env] = { metrics, lines };
  await page.close();
}
await browser.close(); server.close();

const pt = (px) => px * 0.75;
console.log('=== 캔버스가 주는 한 글자 높이 (글자 크기 100px 기준 ascent+descent = 글자 크기 대비 배수)');
for (const env of Object.keys(results)) console.log(`  ${env.padEnd(5)}`, Object.entries(results[env].metrics).map(([k, v]) => `${k}: ${((v.ascent + v.descent) / 100).toFixed(4)}`).join('   '));
console.log('  (Word 한 줄 높이 배수: 맑은 고딕 1.7292, Batang 1.3)');
const envs = Object.keys(results);
console.log('\n=== 줄 높이(pt): Word 정답과 우리 조판. 괄호는 오차(%)');
console.log('정답 케이스'.padEnd(44), 'Word'.padStart(6), ...envs.map((e) => e.padStart(16)));
const stats = {};
for (const c of ALL) {
  const idx = c.block; const cells = [];
  for (const env of envs) {
    const L = results[env].lines[c.probe].lines;
    // cjk-face-factors는 문단마다 줄바꿈으로 두 줄: 정답은 두 줄의 기준선 간격. 나머지는 한 줄 문단의 줄 높이.
    const v = c.probe === 'cjk-face-factors' ? (L[2 * idx + 1] && L[2 * idx] ? pt(L[2 * idx + 1].y - L[2 * idx].y) : NaN) : (L[idx] ? pt(L[idx].lh) : NaN);
    const d = ((v - c.expect) / c.expect) * 100;
    cells.push(Number.isNaN(v) ? '-'.padStart(16) : `${v.toFixed(2)} (${d >= 0 ? '+' : ''}${d.toFixed(0)})`.padStart(16));
    if (!Number.isNaN(d)) (stats[env] ??= []).push(d);
  }
  console.log(`${c.probe.slice(0, 11)}#${c.block} ${String(c.note).slice(0, 28)}`.padEnd(44), String(c.expect).padStart(6), ...cells);
}
const avgAbs = (a) => (a.reduce((x, y) => x + Math.abs(y), 0) / a.length).toFixed(1), avg = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1);
console.log('\n평균 절대 오차(%)  :', Object.entries(stats).map(([e, a]) => `${e} ${avgAbs(a)}`).join('   '));
console.log('평균 부호 오차(%)  :', Object.entries(stats).map(([e, a]) => `${e} ${avg(a)}`).join('   '), '  (음수 = Word보다 짧음)');
console.log('케이스', ALL.length, '개');
