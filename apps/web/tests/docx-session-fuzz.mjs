// DOCX 편집 세션 퍼저(4-2-2): 합성 문서에 무작위 편집(글 넣기·지우기·Enter·Backspace·Delete·범위 지우기·되돌리기·다시 하기)을 하며 매번 검사한다.
//  ① IR 거울의 문단 글 == 모델의 문단 글  ② 증분 재조판 결과 == 같은 IR을 처음부터 조판한 결과(쪽·항목 모두)
//  ③ 캐럿 좌표 → 히트 테스트 → 같은 위치(왕복)  ④ 선택 영역 사각형이 줄 안에 있고 비어 있지 않다
//  폴더(.docx 코퍼스)를 주면 그 파일들로도 한다(큰 문서는 건너뜀).
//  끝에서 저장 → office_oxide로 다시 읽은 글 목록 == 거울 IR 글 목록.     node tests/docx-session-fuzz.mjs [--seed N] [--docs N] [--ops N]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makeDocx, p, table, run } from './docx-fixtures.mjs';
import { irOf } from './docx-edit-helpers.mjs';
import { rng } from './docx-edit-oracle.mjs';
import { DocxEditSession, spansText } from '../src/docx/edit/session.js';
import { layoutDocument } from '../src/docx/layout.js';
import { createFakeMeasurer } from '../src/docx/measure.js';
import { flattenIr } from '../src/docx/edit/ir.js';
import { EditError } from '../src/docx/edit/model.js';

const argv = process.argv.slice(2), arg = (k, d) => (argv.includes(`--${k}`) ? Number(argv[argv.indexOf(`--${k}`) + 1]) : d);
const ONLY = argv.includes('--only') ? Number(argv[argv.indexOf('--only') + 1]) : -1;
const SEED = arg('seed', 1), DOCS = arg('docs', 40), OPS = arg('ops', 25), CHECK_EVERY = arg('every', 1);
const dir = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const FILE = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null;
const LIMIT = arg('limit', 1e9), MAXB = arg('maxblocks', 500);
const measure = createFakeMeasurer();
const R = rng(SEED);
const WORDS = ['가나다라', 'Hello', 'World', '문단', '긴 문장이 길게 이어지면 줄이 바뀌고 쪽도 넘어갑니다 ', 'abc def ghi', '한글과 English 섞어서 ', '😀', '※'];
const w = () => WORDS[Math.floor(R() * WORDS.length)];
const long = () => Array.from({ length: 1 + Math.floor(R() * 14) }, w).join('');
const BLOCKS = [
  () => p(long()), () => p(long()), () => p(long()), () => p(w(), { heading: 1 }), () => p(long(), { align: 'center' }), () => p(long(), { align: 'right' }),
  () => `<w:p>${run(w())}<w:r><w:rPr><w:b/></w:rPr><w:t>${w()}</w:t></w:r><w:r><w:t xml:space="preserve"> ${w()}</w:t></w:r></w:p>`,
  () => `<w:p><w:r><w:t>${w()}</w:t><w:tab/><w:t>${w()}</w:t><w:br/><w:t>${w()}</w:t></w:r></w:p>`,
  () => '<w:p/>', () => '<w:p/>',
  () => p('   ' + w() + '   '),
  () => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(long())}</w:p>`,
  () => table([[long(), w()], ['', long()], [w(), '']]),
  () => `<w:p><w:r><w:rPr><w:caps/></w:rPr><w:t>${w()}</w:t></w:r></w:p>`,
  () => '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
];
const POOL = ['a', 'Z', '한', '글', ' ', 'Hello', '세계', '😀', '가나다라 마바사', 'x'.repeat(30), '  ', '\t', long()];

const canon = (pages) => JSON.stringify(pages.map((pg) => ({ w: pg.width, h: pg.height, no: pg.no, items: pg.items })));
const fails = []; let docs = 0, ops = 0, skipped = 0; const kinds = {}, stats = { relayout: 0, full: 0, reconcile: 0 };

async function one(bytes, rand, label) {
  const full = irOf(bytes);
  let s;
  try { s = await DocxEditSession.open(bytes, full, measure, { readIr: async (b) => irOf(b) }); } catch (e) { if (e instanceof EditError) { skipped++; return; } throw e; }
  const m = s.model;
  const checkMirror = () => {
    for (let q = 0; q < m.paragraphCount; q++) {
      const pv = m.paras[q], ent = s.nodes.get(pv.id);
      if (ent && spansText(ent.node.content) !== (pv.text ?? pv.all)) throw new Error(`거울 글 불일치 문단 ${q}: IR ${JSON.stringify(spansText(ent.node.content)).slice(0, 50)} 모델 ${JSON.stringify(pv.text ?? pv.all).slice(0, 50)}`);
    }
  };
  const checkLeak = () => {   // IR의 문단 노드는 모두 살아 있는 문단 조각의 것이어야 한다(없어진 문단의 노드가 남으면 안 된다)
    const live = new Set(m.paras.map((pv) => pv.id));
    for (const b of flattenIr({ ir: s.ir })) if (b.node && b.node.pid !== undefined && (!live.has(b.node.pid) || s.nodes.get(b.node.pid)?.node !== b.node)) throw new Error(`IR에 없어진 문단의 노드가 남았다(live=${live.has(b.node.pid)} 같은 노드=${s.nodes.get(b.node.pid)?.node === b.node} 맵에 있음=${s.nodes.has(b.node.pid)}) pid=${b.node.pid} 글=${JSON.stringify(spansText(b.node.content ?? [])).slice(0, 40)}`);
  };
  const checkLayout = () => {
    const ref = layoutDocument(s.ir, measure, { track: true, headingRuns: s.full.heading_runs ?? {} });
    if (canon(s.pages) !== canon(ref.pages)) {
      let i = 0; while (i < s.pages.length && i < ref.pages.length && canon([s.pages[i]]) === canon([ref.pages[i]])) i++;
      let d = '';
      if (i < s.pages.length && i < ref.pages.length) { const a = s.pages[i].items, b = ref.pages[i].items; let k = 0; while (k < a.length && k < b.length && JSON.stringify(a[k]) === JSON.stringify(b[k])) k++; d = ` 항목 ${k}/${a.length}·${b.length} 증분 ${JSON.stringify(a[k])?.slice(0, 150)} 전체 ${JSON.stringify(b[k])?.slice(0, 150)}`; }
      throw new Error(`증분 조판 ≠ 전체 조판 (쪽 ${s.pages.length} vs ${ref.pages.length}, 처음 다른 쪽 ${i})${d}`);
    }
  };
  const checkGeom = () => {
    // 줄이 있는 문단 몇 개에서 위치 → 캐럿 → 히트 → 캐럿 왕복
    const nav = []; for (let q = 0; q < m.paragraphCount; q++) if (s.navigable(q)) nav.push(q);
    for (let t = 0; t < 4 && nav.length; t++) {
      const q = nav[Math.floor(rand() * nav.length)], len = m.length(q), o = Math.floor(rand() * (len + 1));
      const c = s.caret({ pos: { s: 0, p: q, o, path: null } }).rect;
      if (!c) throw new Error(`문단 ${q} 위치 ${o}의 캐럿이 없다`);
      // 칸 밖으로 넘친 글이 이웃 칸 글과 겹치는 곳은 어느 쪽을 가리켜야 할지 정할 수 없다: 건너뛴다
      const ext = (l) => { const sg = [...l.items, ...(l.trailing ?? [])].filter((i) => i.o0 !== undefined); return sg.length ? [l.x + sg[0].x, l.x + sg.at(-1).x + sg.at(-1).w] : [l.x, l.x]; };
      const mine = s.geo.pageLines(c.page).filter((l) => Math.abs(l.y - c.y) < 0.5 && l.pid === m.paras[q].id).map(ext);
      if (s.geo.pageLines(c.page).some((l) => l.pid !== m.paras[q].id && l.y < c.y + c.h && l.y + l.h > c.y && mine.some(([a, b]) => { const [x0, x1] = ext(l); return x0 < b + 0.5 && x1 > a - 0.5; }))) continue;
      const h = s.hit({ page: c.page, x: c.x + 0.01, y: c.y + c.h / 2 });
      if (!h.pos) throw new Error(`히트 테스트 실패 쪽 ${c.page} (${c.x},${c.y})`);
      const c2 = s.caret({ pos: h.pos }).rect;
      if (process.env.DBG && Math.abs(c2.x - c.x) > 0.6) for (const pp of [q, h.pos.p]) console.log('P', pp, JSON.stringify((s.geo.linesOf(m.paras[pp].id) ?? []).map((x) => ({ pi: x.pi, x: x.ln.x, y: x.ln.y, w: x.ln.w, ls: x.ln.ls, items: x.ln.items.map((i) => [i.k, +i.x.toFixed(1), +i.w.toFixed(1), i.o0, i.o1]), tr: (x.ln.trailing ?? []).map((i) => [i.k, +i.x.toFixed(1), +i.w.toFixed(1), i.o0, i.o1]) }))));
      if (Math.abs(c2.x - c.x) > 0.6 || Math.abs(c2.y - c.y) > 0.6 || c2.page !== c.page) throw new Error(`캐럿 왕복이 다르다 문단 ${q} o=${o} 글=${JSON.stringify(m.text(q)).slice(0, 30)} 맞은편=${JSON.stringify(m.text(h.pos.p)).slice(0, 30)}: (${c.page},${c.x.toFixed(1)},${c.y.toFixed(1)}) → p=${h.pos.p} o=${h.pos.o} (${c2.page},${c2.x.toFixed(1)},${c2.y.toFixed(1)})`);
    }
    if (nav.length) {
      const a = nav[Math.floor(rand() * nav.length)], b = nav[Math.floor(rand() * nav.length)];
      const A = { s: 0, p: Math.min(a, b), o: 0, path: null }, B = { s: 0, p: Math.max(a, b), o: m.length(Math.max(a, b)), path: null };
      const r = s.selrects({ a: A, b: B }).rects;
      if (!r.length && (m.length(A.p) > 0 || A.p !== B.p)) throw new Error(`선택 사각형이 없다 A=${A.p}:${A.o} B=${B.p}:${B.o} lenA=${m.length(A.p)} 문단 ${JSON.stringify(m.text(A.p)).slice(0, 40)} lines=${JSON.stringify((s.geo.linesOf(m.paras[A.p].id) ?? []).map((x) => [x.pi, x.ln.li, x.ln.items.length, (x.ln.trailing ?? []).length]))}`);
      for (const q of r) if (!(q.w > 0 && q.h > 0 && Number.isFinite(q.x) && Number.isFinite(q.y))) throw new Error(`선택 사각형이 이상하다 ${JSON.stringify(q)}`);
      const t = s.text({ a: A, b: B }).text;
      let want = ''; for (let q = A.p; q <= B.p; q++) want += (q > A.p ? '\n' : '') + m.text(q);
      if (t !== want) throw new Error('선택 글이 문단 글을 이은 것과 다르다');
    }
  };
  const check = () => { checkMirror(); checkLeak(); checkLayout(); checkGeom(); };
  try { check(); } catch (e) { fails.push(`${label}: 처음 검사 ${e.message}`); return; }
  for (let i = 0; i < OPS; i++) {
    const nav = []; for (let q = 0; q < m.paragraphCount; q++) if (s.navigable(q) && m.canEdit(q)) nav.push(q);
    if (!nav.length) break;
    const q = nav[Math.floor(rand() * nav.length)], len = m.length(q), k = rand();
    const pos = (o) => ({ s: 0, p: q, o, path: null });
    try {
      let kind;
      if (k < 0.34) { kind = 'insert'; await s.insert({ pos: pos(Math.floor(rand() * (len + 1))), text: POOL[Math.floor(rand() * POOL.length)] }); }
      else if (k < 0.46) { kind = 'delrange'; const a = Math.floor(rand() * (len + 1)), b = Math.min(len, a + 1 + Math.floor(rand() * 6)); await s.delrange({ a: pos(a), b: pos(b) }); }
      else if (k < 0.58) { kind = 'enter'; await s.enter({ pos: pos(Math.floor(rand() * (len + 1))) }); }
      else if (k < 0.7) { kind = 'backspace'; await s.del({ pos: pos(Math.floor(rand() * (len + 1))), dir: 'back' }); }
      else if (k < 0.78) { kind = 'delete'; await s.del({ pos: pos(Math.floor(rand() * (len + 1))), dir: 'fwd' }); }
      else if (k < 0.86) {
        kind = 'cross'; let z = q; while (z + 1 < m.paragraphCount && z - q < 3 && m.canEdit(z + 1) && s.navigable(z + 1)) z++;
        if (z > q) await s.delrange({ a: pos(Math.floor(rand() * (len + 1))), b: { s: 0, p: z, o: Math.floor(rand() * (m.length(z) + 1)), path: null } });
      } else if (k < 0.93) { kind = 'undo'; await s.undo(); }
      else { kind = 'redo'; await s.redo(); }
      if (process.env.DBGOPS) console.log(`op ${i} ${kind} q=${q} k=${k.toFixed(2)} ids=${m.paras.map((x) => x.id).join(',')} last=${JSON.stringify({ rem: m.last?.removed.map((x) => x.id), add: m.last?.added.map((x) => x.id), hint: m.last?.hint })}`);
      kinds[kind] = (kinds[kind] ?? 0) + 1; ops++;
    } catch (e) { if (e instanceof EditError && (e.code === 'locked' || e.code === 'not_sibling')) continue; fails.push(`${label}: 편집 ${i} 예외 ${String(e.stack ?? e).slice(0, 300)}`); return; }
    if (i % CHECK_EVERY === 0) { try { check(); } catch (e) { fails.push(`${label}: 편집 ${i}(${[...Object.keys(kinds)].length ? '' : ''}) ${e.message}`); return; } }
  }
  // 저장 → 다시 읽기: 글 목록이 거울 IR과 같아야 한다
  try {
    check();
    const out = await s.save();
    const after = flattenIr(irOf(out)).filter((b) => b.text).map((b) => b.text);
    const mirror = flattenIr({ ir: s.ir }).filter((b) => b.text).map((b) => b.text);
    if (after.length !== mirror.length || after.some((t, j) => t !== mirror[j])) {
      let j = 0; while (j < after.length && after[j] === mirror[j]) j++;
      throw new Error(`저장 뒤 글이 거울 IR과 다르다(블록 ${j}): 읽은 ${JSON.stringify(after[j])?.slice(0, 60)} / 거울 ${JSON.stringify(mirror[j])?.slice(0, 60)} (개수 ${after.length}/${mirror.length})`);
    }
  } catch (e) { fails.push(`${label}: 끝 검사 ${e.message}`); return; }
  docs++;
  stats.relayout += s.stats.relayout; stats.full += s.stats.full; stats.reconcile += s.stats.reconcile;
}

for (let d = 0; d < (dir ? 0 : DOCS); d++) {
  const n = 5 + Math.floor(R() * 40);
  const body = Array.from({ length: n }, () => BLOCKS[Math.floor(R() * BLOCKS.length)]()).join('');
  if (ONLY >= 0 && d !== ONLY) continue;
  await one(new Uint8Array(makeDocx(body)), rng(SEED * 7919 + d), `문서 ${d}`);
}
if (dir) {
  const files = [];
  const walk = (x) => { for (const f of readdirSync(x)) { const q = join(x, f); if (statSync(q).isDirectory()) walk(q); else if (/\.docx$/i.test(f)) files.push(q); } };
  walk(dir); files.sort();
  let k = 0;
  for (const f of files) {
    if (k >= LIMIT) break;
    if (FILE && !f.includes(FILE)) continue;
    let bytes; try { bytes = new Uint8Array(readFileSync(f)); if (flattenIr(irOf(bytes)).length > MAXB) continue; } catch { continue; }
    k++;
    const h = [...f].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    await one(bytes, rng(SEED * 131 + h), f.split('/').slice(-2).join('/'));
  }
}
console.log(`세션 퍼저 seed=${SEED}: 문서 ${docs}개(건너뜀 ${skipped}), 편집 ${ops}회 ${JSON.stringify(kinds)}, 증분 ${stats.relayout}·전체 ${stats.full}·조정 ${stats.reconcile}, 실패 ${fails.length}`);
for (const f of fails.slice(0, 8)) console.log('  ✗', f);
process.exitCode = fails.length ? 1 : 0;
