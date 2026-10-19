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
import { makeDocx, p, pageBreak, table, fieldSimple, fieldComplex, run, footerPara } from './docx-fixtures.mjs';
import { makeRtf, rp, rpage, rtable, pageField, numPagesField, u } from './rtf-fixtures.mjs';
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

// 바닥글 필드(쪽 번호) 씨앗: 어댑터가 ZIP을 다시 묶는 경로를 시험에 포함한다
const FOOTER = footerPara(run('쪽 ') + fieldSimple('PAGE', '1') + run(' / ') + fieldSimple('NUMPAGES', '9')) + footerPara(run('p. ') + fieldComplex('PAGE \\* roman', '1') + run(' ') + fieldComplex('SECTIONPAGES', '1'));

function makeCase(i) {
  const rand = rng(SEED * 1000003 + i);
  const kind = rand();
  const body = SEED_BODIES[Math.floor(rand() * SEED_BODIES.length)];
  if (kind < 0.55) {
    const bodyM = semantic(body, rand);
    const sectM = semantic(sect(), rand);
    return { label: `semantic#${i}`, buf: makeDocx(bodyM, { sect: sectM, footer: rand() < 0.5 ? FOOTER : null }) };
  }
  const buf = makeDocx(body, { sect: sect(), footer: rand() < 0.5 ? FOOTER : null });
  const k = KINDS[Math.floor(rand() * KINDS.length)];
  return { label: `${k}#${i}`, buf: mutate(buf, rand, k) };
}

// ── RTF·DOC ──
const RTF_BODIES = [
  rp('제목', '\\qc\\b\\fs36') + rp('본문 ' + KO.repeat(6), '\\qj\\fi360\\li720\\sb120\\sa120\\sl360\\slmult1') + rp('Hello '.repeat(40), '\\cf2\\fs28\\i'),
  rtable([['가', '나', '다'], ['1', '2', '3'], ['긴 내용 '.repeat(20), 'b', 'c']], [2000, 2000, 2000]) + rp('표 아래') + rpage + rp('다음 쪽'),
  Array.from({ length: 80 }, (_, i) => rp(`${i}번째 문단 ${KO}`)).join(''),
  '{\\footnote ' + u('각주 내용') + '}' + rp('각주가 있는 문단') + '\\pard\\tqr\\tldot\\tx9000 Label\\tab 12\\par\n' + '\\pard\\f1 \\\'b0\\\'a1\\\'b3\\\'aa\\par\n',
];
const RTF_HF = { footer: u('쪽 ') + pageField('1') + ' / ' + numPagesField('9'), header: u('머리글') };
// 의미 변형: 제어어의 숫자를 극단값으로 바꾸고, 괄호를 지우거나 늘리고, 그룹을 복제한다
function rtfSemantic(buf, rand) {
  let s = buf.toString('latin1');
  const nums = [...s.matchAll(/\\[a-z]+(-?\d+)/g)];
  const n = 1 + Math.floor(rand() * 5);
  for (let i = 0; i < n && nums.length; i++) {
    const m = nums[Math.floor(rand() * nums.length)];
    s = s.replace(m[0], m[0].replace(/-?\d+$/, EDGE[Math.floor(rand() * EDGE.length)]));
  }
  const r = rand();
  if (r < 0.2) { const k = s.indexOf('}'); if (k > 0) s = s.slice(0, k) + s.slice(k + 1); }
  else if (r < 0.4) { const k = Math.floor(rand() * s.length); s = s.slice(0, k) + '{'.repeat(1 + Math.floor(rand() * 400)) + s.slice(k); }
  else if (r < 0.5) { const k = Math.floor(rand() * s.length); s = s.slice(0, k) + '\\bin99999999 ' + s.slice(k); }
  else if (r < 0.6) { s = s.replace('\\trowd', '\\trowd\\cellx0\\cellx0\\cellx-5\\cellx99999999'); }
  return Buffer.from(s, 'latin1');
}
const DOC_SEED = readFileSync(join(here, 'fixtures/sample.doc'));
function makeRtfCase(i) {
  const rand = rng(SEED * 7000019 + i);
  const body = RTF_BODIES[Math.floor(rand() * RTF_BODIES.length)];
  const base = makeRtf(body, rand() < 0.5 ? RTF_HF : {});
  if (rand() < 0.5) return { label: `rtf-semantic#${i}`, kind: 'rtf', buf: rtfSemantic(base, rand) };
  const k = KINDS[Math.floor(rand() * KINDS.length)];
  return { label: `rtf-${k}#${i}`, kind: 'rtf', buf: mutate(base, rand, k) };
}
function makeDocCase(i) {
  const rand = rng(SEED * 9000011 + i);
  const k = KINDS[Math.floor(rand() * KINDS.length)];
  return { label: `doc-${k}#${i}`, kind: 'doc', buf: mutate(DOC_SEED, rand, k) };
}

const cases = [];
for (let i = 0; i < N; i++) cases.push(makeCase(i));
for (let i = 0; i < Math.ceil(N * 0.5); i++) cases.push(makeRtfCase(i));
for (let i = 0; i < Math.ceil(N * 0.25); i++) cases.push(makeDocCase(i));
cases.push({ label: 'doc-seed', kind: 'doc', buf: DOC_SEED });
// ── XLSX·XLS·PPTX: 파일 바이트 변형(업스트림 파서) + 정상 문서의 IR 숫자 변형(우리 어댑터·조판) ──
const OFFICE_SEEDS = [['xlsx', 'sample.xlsx'], ['xls', 'sample.xls'], ['pptx', 'sample.pptx']].map(([kind, f]) => ({ kind, buf: readFileSync(join(here, 'fixtures', f)) }));
for (let i = 0; i < Math.ceil(N * 0.3); i++) {
  const rand = rng(SEED * 5000011 + i);
  const seed = OFFICE_SEEDS[Math.floor(rand() * OFFICE_SEEDS.length)];
  const k = KINDS[Math.floor(rand() * KINDS.length)];
  cases.push({ label: `${seed.kind}-${k}#${i}`, kind: seed.kind, buf: mutate(seed.buf, rand, k) });
}
for (let i = 0; i < Math.ceil(N * 0.3); i++) {
  const rand = rng(SEED * 6000011 + i);
  const seed = OFFICE_SEEDS[Math.floor(rand() * OFFICE_SEEDS.length)];
  cases.push({ label: `ir-${seed.kind}#${i}`, kind: `ir-${seed.kind}`, buf: seed.buf, seed: Math.floor(rand() * 2 ** 31) });
}
for (const s of OFFICE_SEEDS) cases.push({ label: `${s.kind}-seed`, kind: s.kind, buf: s.buf });
if (SEEDS_DIR) {
  for (const f of readdirSync(SEEDS_DIR).filter((x) => /\.(docx|doc|rtf)$/i.test(x)).sort()) {
    const buf = readFileSync(join(SEEDS_DIR, f));
    const kind = /\.rtf$/i.test(f) || buf.subarray(0, 5).toString() === '{\\rtf' ? 'rtf' : /\.doc$/i.test(f) && buf[0] === 0xd0 ? 'doc' : 'docx';
    cases.push({ label: `seed:${f}`, kind, buf });
    const rand = rng(SEED + cases.length);
    for (let k = 0; k < 6; k++) cases.push({ label: `${KINDS[k % KINDS.length]}:${f}`, kind, buf: mutate(buf, rand, KINDS[k % KINDS.length]) });
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
const runBatch = (page, items) => page.evaluate((arr) => arr.map(([b64, kind, seed]) => SheetflyFuzz.run(b64, 60, kind, seed)), items);

const results = [];
let page = await freshPage();
const t0 = Date.now();
for (let i = 0; i < cases.length; i += BATCH) {
  const slice = cases.slice(i, i + BATCH);
  const items = slice.map((c) => [c.buf.toString('base64'), c.kind ?? 'docx', c.seed ?? 0]);
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
// DOC 읽기는 office_oxide 코드뿐이라(우리 어댑터는 그대로 넘긴다) DOC 변형에서 나온 trap은 업스트림 결함으로 따로 센다 (docs/phase3/doc-rtf.md).
const isUpstream = (r) => r.status === 'trap' && /^(doc|xls|xlsx|ppt|pptx)-/.test(r.label);
const upstream = results.filter(isUpstream);
const bad = results.filter((r) => ['trap', 'js_error', 'hang'].includes(r.status) && !isUpstream(r));
for (const r of upstream) console.log('업스트림(DOC) trap:', r.label, r.detail);
const slow = results.filter((r) => r.ms > 3000 && r.status !== 'hang');
for (const r of bad) console.log('문제:', r.status, r.label, r.detail);
for (const r of slow.slice(0, 10)) console.log('느림:', Math.round(r.ms), 'ms', r.label, r.status, `${r.pages}쪽`);
mkdirSync(join(here, '../node_modules/.cache/sheetfly-e2e/'), { recursive: true });
writeFileSync(join(here, '../node_modules/.cache/sheetfly-e2e/docx-fuzz.json'), JSON.stringify({ seed: SEED, n: N, count, bad, upstream, slow }, null, 1));
process.exit(bad.length ? 1 : 0);
