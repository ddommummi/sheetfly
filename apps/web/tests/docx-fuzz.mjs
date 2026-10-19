// DOCX 변이 시험: 시험이 만든 씨앗 문서를 (1) 숫자 속성 극단값 치환(의미 변형) (2) 바이트 변형(ZIP/XML 손상)으로 망가뜨려
// 파싱→조판→SVG까지 돌려 충돌(WASM trap)·JS 예외·멈춤·과다 출력이 없는지 본다.
//   node tests/docx-fuzz.mjs [--n 600] [--seed 1] [--seeds <디렉터리>]   (먼저 npm run build:wasm)
// 결과: 상태별 개수, 문제 입력 목록(재현 번호 포함). 종료 코드: trap/js_error/hang이 있으면 1.
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
import { rng, mutate, KINDS } from './mutate.mjs';
import { makeDocx, p, pageBreak, table } from './docx-fixtures.mjs';
import { chromiumPath } from './helpers.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const N = Number(arg('--n', 600));
const SEED = Number(arg('--seed', 1));
const SEEDS_DIR = arg('--seeds', '');
const BATCH = 20;
const HANG_MS = 20000;

const KO = '대한민국은 민주공화국이다. 대한민국의 주권은 국민에게 있고, 모든 권력은 국민으로부터 나온다. ';
const sect = (extra = '') => `<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708"/>${extra}</w:sectPr>`;
const SEED_BODIES = [
  p('제목', { heading: 1 }) + p('본문 ' + KO.repeat(6), { align: 'both' }) + p('Hello world '.repeat(40), { size: 28 }),
  table([['가', '나', '다'], ['1', '2', '3'], ['긴 내용 '.repeat(20), 'b', 'c']]) + p('표 아래 문단') + pageBreak + p('다음 쪽'),
  Array.from({ length: 80 }, (_, i) => p(`${i}번째 문단 ${KO}`)).join(''),
  `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr><w:tblGrid><w:gridCol w:w="2000"/><w:gridCol w:w="2000"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vMerge w:val="restart"/></w:tcPr>${p('병합')}</w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p('옆')}</w:tc></w:tr><w:tr><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/><w:vMerge/></w:tcPr>${p('')}</w:tc><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr>${p('아래')}</w:tc></w:tr></w:tbl>`,
  p('들여쓰기 문단 ' + KO.repeat(3)).replace('<w:p>', '<w:p><w:pPr><w:ind w:left="1440" w:right="720" w:hanging="360"/><w:tabs><w:tab w:val="right" w:pos="9000" w:leader="dot"/></w:tabs><w:spacing w:before="240" w:after="120" w:line="360" w:lineRule="auto"/></w:pPr>').replace('<w:pPr><w:ind', '<w:pPr><w:ind'),
];
const EDGE = ['0', '1', '-1', '32767', '65535', '2147483647', '4294967295', '99999999', '-2147483648'];

function semantic(xml, rand) {
  const n = 1 + Math.floor(rand() * 4);
  const nums = [...xml.matchAll(/w:(?:w|h|sz|val|left|right|top|bottom|hanging|firstLine|before|after|line|pos|space|header|footer|gutter)="(-?\d+)"/g)];
  if (!nums.length) return xml;
  let out = xml;
  for (let i = 0; i < n; i++) {
    const m = nums[Math.floor(rand() * nums.length)];
    out = out.replace(m[0], m[0].replace(/"-?\d+"/, `"${EDGE[Math.floor(rand() * EDGE.length)]}"`));
  }
  return out;
}

function makeCase(i) {
  const rand = rng(SEED * 1000003 + i);
  const kind = rand();
  const body = SEED_BODIES[Math.floor(rand() * SEED_BODIES.length)];
  if (kind < 0.55) {
    const bodyM = semantic(body, rand);
    const sectM = semantic(sect(), rand);
    return { label: `semantic#${i}`, buf: makeDocx(bodyM, { sect: sectM }) };
  }
  const buf = makeDocx(body, { sect: sect() });
  const k = KINDS[Math.floor(rand() * KINDS.length)];
  return { label: `${k}#${i}`, buf: mutate(buf, rand, k) };
}

const cases = [];
for (let i = 0; i < N; i++) cases.push(makeCase(i));
if (SEEDS_DIR) {
  for (const f of readdirSync(SEEDS_DIR).filter((x) => /\.docx$/i.test(x)).sort()) {
    const buf = readFileSync(join(SEEDS_DIR, f));
    cases.push({ label: `seed:${f}`, buf });
    const rand = rng(SEED + cases.length);
    for (let k = 0; k < 6; k++) cases.push({ label: `${KINDS[k % KINDS.length]}:${f}`, buf: mutate(buf, rand, KINDS[k % KINDS.length]) });
  }
}

const bundle = await build({ entryPoints: [join(here, 'docx-fuzz-entry.js')], bundle: true, format: 'iife', globalName: 'SheetflyFuzz', write: false, logLevel: 'warning', target: 'es2022' });
const code = bundle.outputFiles[0].text;
const wasm = readFileSync(join(here, '../src/wasm/fmt_docx_bg.wasm')).toString('base64');
const browser = await chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });

async function freshPage() {
  const page = await browser.newPage();
  await page.setContent('<body></body>');
  await page.addScriptTag({ content: code });
  await page.evaluate(async (w) => { const b = Uint8Array.from(atob(w), (c) => c.charCodeAt(0)); await SheetflyFuzz.initEngine(b); }, wasm);
  return page;
}
const runBatch = (page, items) => page.evaluate((arr) => arr.map((b64) => SheetflyFuzz.run(b64)), items);

const results = [];
let page = await freshPage();
const t0 = Date.now();
for (let i = 0; i < cases.length; i += BATCH) {
  const slice = cases.slice(i, i + BATCH);
  const items = slice.map((c) => c.buf.toString('base64'));
  let res;
  try {
    res = await Promise.race([runBatch(page, items), new Promise((_, rej) => setTimeout(() => rej(new Error('hang')), HANG_MS))]);
  } catch (e) {
    // 배치가 멈추거나 페이지가 죽었다: 하나씩 다시 돌려 원인 입력을 찾는다
    await page.close().catch(() => {});
    res = [];
    for (let j = 0; j < slice.length; j++) {
      page = await freshPage();
      try {
        const r = await Promise.race([runBatch(page, [items[j]]), new Promise((_, rej) => setTimeout(() => rej(new Error('hang')), HANG_MS))]);
        res.push(r[0]);
      } catch (e2) {
        res.push({ status: 'hang', pages: 0, ms: HANG_MS, detail: String(e2.message || e2).slice(0, 80) });
        await page.close().catch(() => {});
      }
    }
    page = await freshPage();
  }
  res.forEach((r, j) => results.push({ ...r, label: slice[j].label, idx: i + j }));
  if (res.some((r) => r.status === 'trap')) { await page.close().catch(() => {}); page = await freshPage(); } // trap 뒤의 인스턴스는 믿지 않는다
}
await browser.close();

const count = {};
for (const r of results) count[r.status] = (count[r.status] || 0) + 1;
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const pct = (q) => ms[Math.min(ms.length - 1, Math.floor(ms.length * q))].toFixed(0);
console.log(`입력 ${results.length}개 (${((Date.now() - t0) / 1000).toFixed(0)}초) 상태:`, count);
console.log(`시간 ms: p50 ${pct(0.5)} p95 ${pct(0.95)} p99 ${pct(0.99)} 최대 ${ms.at(-1).toFixed(0)}, 최대 쪽 수 ${Math.max(...results.map((r) => r.pages))}`);
const bad = results.filter((r) => ['trap', 'js_error', 'hang'].includes(r.status));
const slow = results.filter((r) => r.ms > 3000 && r.status !== 'hang');
for (const r of bad) console.log('문제:', r.status, r.label, r.detail);
for (const r of slow.slice(0, 10)) console.log('느림:', Math.round(r.ms), 'ms', r.label, r.status, `${r.pages}쪽`);
mkdirSync(join(here, '../node_modules/.cache/sheetfly-e2e/'), { recursive: true });
writeFileSync(join(here, '../node_modules/.cache/sheetfly-e2e/docx-fuzz.json'), JSON.stringify({ seed: SEED, n: N, count, bad, slow }, null, 1));
process.exit(bad.length ? 1 : 0);
