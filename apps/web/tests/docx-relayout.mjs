// 증분 재조판 시험: 무작위로 IR 문단을 고친 뒤 session.relayout()한 결과가 처음부터 다시 조판한 결과와 쪽·항목까지 같은지 본다.
//   node tests/docx-relayout.mjs [폴더(.docx 코퍼스)] [--seed N] [--edits N] [--limit N] [--synth N]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeDocx, p, table } from './docx-fixtures.mjs';
import { irOf } from './docx-edit-helpers.mjs';
import { layoutDocument } from '../src/docx/layout.js';
import { createFakeMeasurer } from '../src/docx/measure.js';
import { flattenIr } from '../src/docx/edit/ir.js';
import { rng } from './docx-edit-oracle.mjs';

const argv = process.argv.slice(2), arg = (k, d) => (argv.includes(`--${k}`) ? Number(argv[argv.indexOf(`--${k}`) + 1]) : d);
const SEED = arg('seed', 1), EDITS = arg('edits', 6), LIMIT = arg('limit', 1e9), SYNTH = arg('synth', 60);
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const dir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const measure = createFakeMeasurer();

/** 쪽 목록의 비교용 문자열(추적용 덧붙임 제외). */
const canon = (pages) => JSON.stringify(pages.map((pg) => ({ w: pg.width, h: pg.height, no: pg.no, items: pg.items })));
function whereDiff(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i], y = b[i];
    if (!x || !y) return `쪽 ${i} 없음`;
    for (let k = 0; k < Math.max(x.items.length, y.items.length); k++) { const u = JSON.stringify(x.items[k]), v = JSON.stringify(y.items[k]); if (u !== v) return `쪽 ${i} 항목 ${k}/${x.items.length}·${y.items.length}\n   증분 ${u?.slice(0, 160)}\n   전체 ${v?.slice(0, 160)}`; }
    if (x.no !== y.no) return `쪽 ${i} 번호 ${x.no} vs ${y.no}`;
  }
  return '?';
}
const WORDS = ['가나다라', 'Hello', 'World', '문단', '긴 문장이 길게 이어지면 줄이 바뀌고 쪽도 넘어갑니다 ', 'abc def ghi', '한글과 English 섞어서 '];

function topOf(ir) {   // 문단 노드 → 그것이 든 최상위 요소
  const m = new Map();
  for (const sec of ir.sections) for (const el of sec.elements ?? []) {
    const mark = (n) => { if (!n || typeof n !== 'object') return; if ((n.type === 'paragraph' || n.type === 'heading') && !m.has(n)) m.set(n, el); for (const k of ['content', 'rows', 'cells', 'items', 'nested']) { const v = n[k]; if (Array.isArray(v)) v.forEach(mark); else if (v) mark(v); } };
    mark(el);
  }
  return m;
}
function check(ir, R, edits, label) {
  const lay = layoutDocument(ir, measure, { track: true });
  const flat = flattenIr({ ir });
  flat.forEach((b, i) => { if (b.node && (b.kind === 'paragraph' || b.kind === 'heading' || b.kind === 'list')) b.node.pid = i + 1; });
  // pid를 단 뒤 다시 처음부터 조판해 기준 상태로 삼는다
  let cur = layoutDocument(ir, measure, { track: true });
  let n = 0, incr = 0, fall = 0;
  for (let e = 0; e < edits; e++) {
    const tops = topOf(ir);
    // 각주·미주 참조가 든 문단은 편집 모델이 잠그므로 시험에서도 건드리지 않는다(각주 번호가 바뀌는 편집은 없다)
    const nodes = flat.filter((b) => b.node && tops.has(b.node) && b.node.content && !b.node.content.some((s) => s.type === 'footnote_ref' || s.type === 'endnote_ref'));
    if (!nodes.length) break;
    const b = nodes[Math.floor(R() * nodes.length)], node = b.node, top = tops.get(node);
    const kind = R();
    const spans = node.content;
    const textSpans = spans.filter((s) => s.type === 'text');
    if (kind < 0.55 || !textSpans.length) {          // 글 넣기(가끔 아주 길게: 쪽이 넘치게)
      const s = textSpans[Math.floor(R() * textSpans.length)];
      const add = WORDS[Math.floor(R() * WORDS.length)].repeat(R() < 0.15 ? 40 : 1 + Math.floor(R() * 3));
      if (s) { const at = Math.floor(R() * ([...s.text].length + 1)); const cps = [...s.text]; s.text = cps.slice(0, at).join('') + add + cps.slice(at).join(''); }
      else spans.push({ type: 'text', text: add });
    } else if (kind < 0.8) {                          // 글 지우기
      const s = textSpans[Math.floor(R() * textSpans.length)], cps = [...s.text];
      const a = Math.floor(R() * (cps.length + 1)), z = Math.min(cps.length, a + 1 + Math.floor(R() * Math.max(1, cps.length)));
      s.text = cps.slice(0, a).join('') + cps.slice(z).join('');
    } else if (kind < 0.92 && node === top) {         // 문단 나누기: 같은 문단을 뒤에 하나 더(최상위일 때)
      const sec = ir.sections.find((x) => x.elements.includes(top));
      const twin = structuredClone(node); twin.pid = 100000 + e;
      sec.elements.splice(sec.elements.indexOf(top) + 1, 0, twin);
      flat.push({ node: twin, kind: 'paragraph' });
    } else if (node === top && ir.sections.some((x) => x.elements.indexOf(top) > 0)) {   // 문단 합치기: 앞에 요소가 있는 최상위 문단 하나를 없앤다(합치기는 뒤 문단이 사라진다)
      const sec = ir.sections.find((x) => x.elements.includes(top));
      const at = sec.elements.indexOf(top); sec.elements.splice(at, 1);
      const i = flat.findIndex((f) => f.node === node); if (i >= 0) flat.splice(i, 1);
      // 이 문단이 없어진 자리의 앞 요소를 바뀐 요소로 삼는다
      const prev = sec.elements[at - 1];
      if (!prev) continue;
      const r = cur.session.relayout(prev);
      const ref = layoutDocument(ir, measure, { track: true });
      n++; if (r) incr++; else fall++;
      if (r ? canon(cur.pages) !== canon(ref.pages) : false) return `${label}: 편집 ${e}(문단 지우기) 증분 ≠ 전체 (쪽 ${cur.pages.length} vs ${ref.pages.length}, from=${r.from} removed=${r.removed} added=${r.added}) ${whereDiff(cur.pages, ref.pages)}`;
      if (!r) cur = ref;
      continue;
    }
    node.ver = (node.ver ?? 0) + 1;   // 내용 배열은 그대로 두고 글만 고쳤으므로 문단 조판 캐시를 무효로 알린다(편집 거울은 새 배열을 대입한다)
    const r = cur.session.relayout(top);
    const ref = layoutDocument(ir, measure, { track: true });
    n++;
    if (r) { incr++; if (canon(cur.pages) !== canon(ref.pages)) return `${label}: 편집 ${e}(종류 ${kind.toFixed(2)}) 증분 ≠ 전체 (쪽 ${cur.pages.length} vs ${ref.pages.length}, from=${r.from} removed=${r.removed} added=${r.added}) ${whereDiff(cur.pages, ref.pages)}`; }
    else { fall++; cur = ref; }
  }
  void lay;
  return { n, incr, fall };
}

let total = 0, incr = 0, fall = 0; const fails = [];
const R = rng(SEED);
// 합성 문서: 문단 수를 달리해 쪽 넘김이 여러 번 일어나게
for (let d = 0; d < SYNTH; d++) {
  const n = 20 + Math.floor(R() * 220);
  const body = Array.from({ length: n }, (_, i) => (R() < 0.08 ? p(`제목 ${i}`, { heading: 1 }) : R() < 0.05 ? table([[`셀${i}`, '다른 셀'], ['', '값']]) : p(`문단 ${i} ${WORDS[Math.floor(R() * WORDS.length)].repeat(1 + Math.floor(R() * 8))}`))).join('');
  const full = irOf(makeDocx(body));
  const r = check(structuredClone(full.ir), rng(SEED * 31 + d), EDITS, `합성 ${d}`);
  if (typeof r === 'string') fails.push(r); else { total += r.n; incr += r.incr; fall += r.fall; }
}
if (dir) {
  const files = [];
  const walk = (x) => { for (const f of readdirSync(x)) { const q = join(x, f); if (statSync(q).isDirectory()) walk(q); else if (/\.docx$/i.test(f)) files.push(q); } };
  walk(dir); files.sort();
  let k = 0;
  for (const f of files) {
    if (k >= LIMIT) break;
    if (ONLY && !f.includes(ONLY)) continue;
    let full; try { full = irOf(readFileSync(f)); } catch { continue; }
    if (flattenIr(full).length > 4000) continue;   // 아주 큰 문서는 건너뜀(시험 시간)
    k++;
    const h = [...f].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const r = check(structuredClone(full.ir), rng(SEED * 131 + h), EDITS, f.split('/').slice(-2).join('/'));
    if (typeof r === 'string') fails.push(r); else { total += r.n; incr += r.incr; fall += r.fall; }
  }
}
console.log(`증분 재조판 seed=${SEED}: 편집 ${total}회(증분 ${incr}, 전체로 물러남 ${fall}), 실패 ${fails.length}`);
for (const f of fails.slice(0, 8)) console.log('  ✗', f);
process.exitCode = fails.length ? 1 : 0;
