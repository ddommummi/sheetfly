// DOCX 편집 입력 지연 측정(4-2-2): 문단 N개 문서에서 글 입력·Enter·지우기 한 번의 처리 시간(편집 모델 + IR 거울 + 증분 재조판 + 캐럿 좌표 + 바뀐 쪽 SVG).
// 글자 폭은 결정적 가짜 측정기(실제 브라우저는 Canvas 측정이라 첫 측정이 더 느리다). 예산: 문단 1,000개 이하에서 p95 ≤ 50ms.   node tests/docx-session-perf.mjs [--n 300,1000,3000] [--ops 300]
import { makeDocx, p } from './docx-fixtures.mjs';
import { irOf } from './docx-edit-helpers.mjs';
import { rng } from './docx-edit-oracle.mjs';
import { DocxEditSession } from '../src/docx/edit/session.js';
import { layoutDocument } from '../src/docx/layout.js';
import { pageToSvg } from '../src/docx/svg.js';
import { createFakeMeasurer } from '../src/docx/measure.js';

const argv = process.argv.slice(2), arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const NS = String(arg('n', '300,1000,3000')).split(',').map(Number), OPS = Number(arg('ops', 300)), LIMIT = Number(arg('limit', 50));
const measure = createFakeMeasurer();
const pct = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const R = rng(7);
let bad = 0;
for (const n of NS) {
  const body = Array.from({ length: n }, (_, i) => p(`문단 ${i} 가나다라마바사 아자차카타파하 ` + 'lorem ipsum dolor sit amet '.repeat(1 + (i % 6)))).join('');
  const bytes = new Uint8Array(makeDocx(body)), full = irOf(bytes);
  const t0 = performance.now();
  const s = await DocxEditSession.open(bytes, full, measure, { readIr: async (b) => irOf(b) });
  const openMs = performance.now() - t0;
  const tFull0 = performance.now(); layoutDocument(s.ir, measure, { track: true, headingRuns: s.full.heading_runs ?? {} }); const fullMs = performance.now() - tFull0;
  const typing = [], enter = [], del = [], render = [], model = [];
  // 한 문단 안에서 이어 입력(가장 흔한 경우)과 흩어진 문단 입력 섞기
  let p0 = Math.floor(R() * n), o = 3;
  for (let i = 0; i < OPS; i++) {
    if (i % 25 === 0) { p0 = Math.floor(R() * s.model.paragraphCount); o = Math.floor(R() * 10); }
    const t = performance.now();
    const r = await s.insert({ pos: { s: 0, p: p0, o, path: null }, text: i % 7 === 0 ? '한' : 'a' });
    o = r.pos.o;
    const t1 = performance.now();
    for (const pi of r.view.changed.slice(0, 2)) pageToSvg(s.pages[pi], measure);
    render.push(performance.now() - t1);
    typing.push(performance.now() - t);
  }
  for (let i = 0; i < 40; i++) {
    const q = Math.floor(R() * s.model.paragraphCount), len = s.model.length(q);
    let t = performance.now(); await s.enter({ pos: { s: 0, p: q, o: Math.floor(R() * (len + 1)), path: null } }); enter.push(performance.now() - t);
    t = performance.now(); await s.del({ pos: { s: 0, p: q + 1, o: 0, path: null }, dir: 'back' }); del.push(performance.now() - t);
  }
  const row = (a) => `p50 ${pct(a, 0.5).toFixed(1)} p95 ${pct(a, 0.95).toFixed(1)} max ${Math.max(...a).toFixed(1)}ms`;
  console.log(`문단 ${n}(${s.pageCount}쪽): 열기 ${openMs.toFixed(0)}ms, 전체 조판 ${fullMs.toFixed(0)}ms`);
  console.log(`  글 입력   ${row(typing)}  (그중 바뀐 쪽 SVG 만들기 ${row(render)})`);
  console.log(`  Enter     ${row(enter)}   Backspace(합치기) ${row(del)}   증분 ${s.stats.relayout}·전체 ${s.stats.full}·조정 ${s.stats.reconcile}`);
  if (n <= 1000 && pct(typing, 0.95) > LIMIT) { bad++; console.log(`  ✗ 글 입력 p95 ${pct(typing, 0.95).toFixed(1)}ms가 예산 ${LIMIT}ms를 넘는다`); }
  void model;
}
process.exitCode = bad ? 1 : 0;
