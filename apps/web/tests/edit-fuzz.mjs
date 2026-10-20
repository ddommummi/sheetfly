// 편집 퍼저: 샘플 문서에 무작위 편집 열(입력·줄바꿈·삭제·범위 삭제·서식·붙여넣기·되돌리기·다시 실행)을 가하며
//  1) 어떤 편집도 예외·멈춤 없이 끝나고, 편집 뒤 캐럿 위치가 항상 유효하며(글자 수 이내, 좌표 계산 가능),
//  2) 이어서 저장하면 다시 열리고 자체 점검(verify)을 통과하며,
//  3) 변경 편집을 전부 되돌리면 원래 문서의 문단 구조(수·길이·앞 40자)로 돌아오는지 본다.
// 편집기가 Worker에서 쓰는 코드(src/hwp-edit.js)를 그대로 부른다. 같은 --seed는 같은 편집 열을 만든다.
//   node tests/edit-fuzz.mjs [--seed 1] [--files 12] [--steps 40] [--max-kb 400]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/hwp-edit.js';
import { rng } from './mutate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = resolve(here, '../src/wasm') + '/';
const samples = resolve(here, '../../../third_party/rhwp/samples');
const { default: init, HwpDocument } = await import(wasmDir + 'rhwp.js');
await init({ module_or_path: readFileSync(wasmDir + 'rhwp_bg.wasm') });

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const SEED = Number(arg('seed', 1));
const FILES = Number(arg('files', 12));
const STEPS = Number(arg('steps', 40));
const MAX_KB = Number(arg('max-kb', 400));
const OBJP = Number(arg('obj', 0)) > 0;       // 개체(그림·도형·수식) 편집을 섞는다
const OBJR = Number(arg('obj', 0));
const PAGER = Number(arg('page', 0));        // 쪽·머리글·각주 편집을 섞는다
const PAGEP = PAGER > 0;
const MISCR = Number(arg('misc', 0));        // 링크·책갈피·필드·스타일·번호·찾아 바꾸기·붙여넣기를 섞는다
const MISCP = MISCR > 0;
const HFR = Number(arg('hf', 0));          // 머리글·바닥글·각주 안(제자리) 편집 묶음을 섞는다
const TBLP = Number(arg('tbl', 0));        // 편집 한 번이 표 구조 편집일 확률(0이면 기본 비율)

/** 머리글·바닥글·각주 안 편집 묶음: 그 안에서 입력·줄바꿈·지우기·서식·이동을 무작위로 하고, 본문이 바뀌지 않았는지·엔진이 거부한 편집 뒤 그 안이 그대로인지 본다. 어긋나면 문장, 아니면 'ok'/'rejected'. */
const safeJ = (x) => { try { return JSON.parse(x); } catch { return JSON.parse(x.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)); } };   // 엔진이 각주 정보의 제어 문자를 이스케이프하지 않는다
function hfOp(doc, m, rand, at) {
  const kind = ['h', 'f', 'n'][Math.floor(rand() * 3)];
  const pg = m('caret', { pos: at }).rect?.page ?? 0;
  let pos;
  try {
    if (kind === 'n') {
      const r = m('api', { fn: 'insertFootnote', args: [0, at.p, at.o] }).result;
      m('fnset', { s: 0, p: r.paraIdx, ctrl: r.controlIdx, lines: ['각주 하나', '둘째 줄'] });
      pos = { s: 0, p: 0, o: 0, path: null, hf: { k: 'n', pg, bp: r.paraIdx, c: r.controlIdx } };
    } else {
      m('hfset', { s: 0, header: kind === 'h', applyTo: 0, lines: ['머리글 가나다', '둘째 줄'] });
      pos = { s: 0, p: 0, o: 0, path: null, hf: { k: kind, a: 0, pg } };
    }
  } catch { return 'rejected'; }
  const body = JSON.stringify(paras(doc));
  const text = () => { const t = pos.hf; return JSON.stringify(t.k === 'n' ? safeJ(doc.getFootnoteInfo(0, t.bp, t.c)).texts : [0, 1, 2, 3, 4, 5].map((i) => { try { return JSON.parse(doc.getHeaderFooterParaInfo(0, t.k === 'h', 0, i)).text; } catch { return null; } })); };
  const len = (q) => [...(pos.hf.k === 'n' ? safeJ(doc.getFootnoteInfo(0, pos.hf.bp, pos.hf.c)).texts[q.p] : JSON.parse(doc.getHeaderFooterParaInfo(0, pos.hf.k === 'h', 0, q.p)).text)].length;
  let res = 'ok', mk = '';
  for (let i = 0; i < 10; i++) {
    const before = text(), k = rand();
    try {
      let r;
      if (k < 0.35) r = m('insert', { pos, text: POOL[Math.floor(rand() * POOL.length)], group: false });
      else if (k < 0.45) r = m('enter', { pos });
      else if (k < 0.6) r = m('del', { pos, dir: rand() < 0.5 ? 'back' : 'fwd', group: false });
      else if (k < 0.7) { const b = { ...pos, o: Math.min(len(pos), pos.o + 1 + Math.floor(rand() * 8)) }; r = m('delrange', { a: pos, b }); }
      else if (k < 0.8) { const b = { ...pos, o: Math.min(len(pos), pos.o + 1 + Math.floor(rand() * 8)) }; m('fmt', { a: pos, b, props: { bold: rand() < 0.5, textColor: '#ff0000' } }); r = { pos }; }
      else if (k < 0.85) { m('parafmt', { a: pos, b: pos, props: { alignment: ['left', 'center', 'right'][Math.floor(rand() * 3)] } }); r = { pos }; }
      else { mk = ['left', 'right', 'up', 'down', 'home', 'end', 'wordleft', 'wordright', 'docstart', 'docend'][Math.floor(rand() * 10)]; r = m('move', { pos, kind: mk, px: -1 }); }
      if (r?.pos) pos = r.pos;
      const lp = len(pos);
      if (pos.o > lp) return `캐럿 o=${pos.o} > 안쪽 문단 길이 ${lp} (${k.toFixed(2)} ${mk} ${JSON.stringify(pos.hf)} p=${pos.p})`;
      m('selrects', { a: { ...pos, o: 0 }, b: pos });
    } catch (e) {
      res = 'rejected';
      if (text() !== before) return `엔진이 거부한 안쪽 편집 뒤 내용이 바뀌어 있다: ${String(e && (e.message || e.code) || e).slice(0, 80)}`;
      pos = { ...pos, p: 0, o: 0 };
    }
    if (JSON.stringify(paras(doc)) !== body) return '머리글·바닥글·각주 편집이 본문을 바꿨다';
  }
  return res;
}

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(hwp|hwpx)$/i.test(e.name)) yield p;
  }
}
const all = [...walk(samples)].map((p) => ({ p, rel: relative(samples, p), size: statSync(p).size })).filter((f) => f.size <= MAX_KB * 1024 && f.size > 2000).sort((a, b) => a.rel.localeCompare(b.rel));
const rand = rng(SEED);
// 시드로 고정된 부분 집합: 파일 목록을 섞어 앞에서 고른다
const pick = [...all];
for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
const files = pick.slice(0, FILES);

const POOL = ['a', 'Z', '한', '글', ' ', 'Hello', '세계', '😀', 'ab\ncd', '\n', '𠮷', '가나다라마바사', 'x'.repeat(200)];
const paras = (d) => { const out = []; for (let s = 0; s < d.getSectionCount(); s++) { const n = d.getParagraphCount(s); out.push(`S${n}`); for (let p = 0; p < Math.min(n, 20000); p++) { const l = d.getParagraphLength(s, p); out.push(l, l ? d.getTextRange(s, p, 0, Math.min(l, 40)) : ''); } } return out; };

/** 문서의 최상위 표 목록 [{p, ctrl, rows, cols}] */
function findTables(doc) {
  const out = [];
  const n = doc.getParagraphCount(0);
  for (let p = 0; p < Math.min(n, 3000); p++) {
    let k = 0;
    try { k = JSON.parse(doc.getControlTextPositions(0, p)).length; } catch { k = 0; }
    for (let c = 0; c < k; c++) { try { const d = JSON.parse(doc.getTableDimensions(0, p, c)); out.push({ p, ctrl: c, rows: d.rowCount, cols: d.colCount }); } catch { /* 표 아님 */ } }
  }
  return out;
}
const checkPos = (doc, pos) => pos.p < doc.getParagraphCount(0);
/** 표 하나에 무작위 구조 편집. 엔진이 거부하면 'rejected'(문서는 그대로여야 한다), 로직 오류(wasm trap)면 예외를 그대로 던진다. */
function tableOp(doc, m, T, rand) {
  const ri = (n) => Math.floor(rand() * n);
  const row = ri(T.rows), col = ri(T.cols);
  const a = [0, T.p, T.ctrl];
  const kinds = [
    () => m('api', { fn: 'insertTableRow', args: [...a, row, rand() < 0.5] }),
    () => m('api', { fn: 'insertTableColumn', args: [...a, col, rand() < 0.5] }),
    () => T.rows > 1 && m('api', { fn: 'deleteTableRow', args: [...a, row] }),
    () => T.cols > 1 && m('api', { fn: 'deleteTableColumn', args: [...a, col] }),
    () => { const r2 = Math.min(T.rows - 1, row + ri(2)), c2 = Math.min(T.cols - 1, col + ri(2)); return m('api', { fn: 'mergeTableCells', args: [...a, row, col, r2, c2] }); },
    () => m('api', { fn: 'splitTableCellInto', args: [...a, row, col, 1 + ri(2), 1 + ri(3), rand() < 0.5, false] }),
    () => m('api', { fn: 'setCellProperties', args: [...a, ri(Math.max(1, T.rows * T.cols)), JSON.stringify({ fillType: 'solid', fillColor: '#aabbcc', verticalAlign: ri(3), borderLeft: { type: 1 + ri(3), width: ri(8), color: '#112233' } })] }),
    () => m('api', { fn: 'setCellZoneProperties', args: [...a, row, col, Math.min(T.rows - 1, row + 1), Math.min(T.cols - 1, col + 1), JSON.stringify({ borderTop: { type: 1, width: 2, color: '#ff0000' } })] }),
    () => m('api', { fn: 'setTableProperties', args: [...a, JSON.stringify({ repeatHeader: rand() < 0.5, pageBreak: ri(3), cellSpacing: ri(3) * 50 })] }),
    () => m('api', { fn: 'resizeTableCells', args: [...a, JSON.stringify([{ cellIdx: 0, widthDelta: ri(300) - 150 }])] }),
    () => m('api', { fn: 'transposeTableCellsInPlace', args: a }),
    () => T.rows > 1 && m('api', { fn: 'splitTable', args: [...a, 1 + ri(T.rows - 1)] }),
    () => m('api', { fn: 'mergeTableWithNext', args: a }),
    () => rand() < 0.15 && m('api', { fn: 'deleteTableControl', args: a }),
  ];
  try { const r = kinds[ri(kinds.length)](); return r ? 'ok' : 'skipped'; } catch (e) {
    const msg = String(e && (e.message || e) || e);
    if (/RuntimeError|unreachable|memory access|out of bounds|stack/i.test(msg) && !/범위|index|인덱스|찾을 수 없|없습니다|invalid|잘못/i.test(msg)) throw e;
    return 'rejected';
  }
}

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64'));
/** 문서의 최상위 개체(그림·도형·수식…) 목록 [{type,s,p,ctrl}] */
function findObjects(doc) {
  const out = [], seen = new Set();
  for (let pg = 0; pg < Math.min(doc.pageCount(), 60); pg++) {
    let list; try { list = JSON.parse(doc.getPageControlLayout(pg)).controls; } catch { continue; }
    for (const c of list) { if (c.type === 'table' || c.cellIdx !== undefined) continue; const k = `${c.secIdx}/${c.paraIdx}/${c.controlIdx}`; if (!seen.has(k)) { seen.add(k); out.push({ type: c.type, s: c.secIdx, p: c.paraIdx, ctrl: c.controlIdx }); } }
  }
  return out;
}
const rejectOk = (e) => {
  const msg = String(e && (e.message || e) || e);
  if (/RuntimeError|unreachable|memory access|stack/i.test(msg) && !/범위|index|인덱스|찾을 수 없|없습니다|invalid|잘못|그림이 아닙니다|도형|컨트롤/i.test(msg)) throw e;
  return 'rejected';
};
function objectOp(doc, m, rand, pos) {
  const ri = (n) => Math.floor(rand() * n);
  const objs = findObjects(doc);
  const O = objs.length ? objs[ri(objs.length)] : null;
  const kinds = [
    () => m('api', { fn: 'insertPicture', args: [0, pos.p, pos.o, '', PNG, 3000 + ri(9000), 2000 + ri(6000), 1, 1, 'png', 'f'] }),
    () => m('api', { fn: 'createShapeControl', args: [JSON.stringify({ sectionIdx: 0, paraIdx: pos.p, charOffset: pos.o, shapeType: ['rectangle', 'ellipse', 'line', 'arc', 'textbox', 'polygon'][ri(6)], width: 3000 + ri(9000), height: 2000 + ri(6000), treatAsChar: rand() < 0.3, textWrap: 'InFrontOfText', horzOffset: ri(20000), vertOffset: ri(20000), polygonPoints: [{ x: 100, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }] })] }),
    () => m('api', { fn: 'insertEquation', args: [0, pos.p, pos.o, ['a over b', 'sqrt{x}', 'x ^2 + y ^2'][ri(3)], 1000, 0] }),
    () => O && m('api', { fn: O.type === 'image' ? 'setPictureProperties' : 'setShapeProperties', args: [O.s, O.p, O.ctrl, JSON.stringify({ width: 2000 + ri(9000), height: 2000 + ri(9000), treatAsChar: rand() < 0.4, textWrap: ['Square', 'InFrontOfText', 'TopAndBottom', 'BehindText'][ri(4)], horzFlip: rand() < 0.3, rotationAngle: ri(360), description: 'd' })] }),
    () => O && m('api', { fn: 'changeShapeZOrder', args: [O.s, O.p, O.ctrl, ['front', 'back', 'forward', 'backward'][ri(4)]] }),
    () => O && rand() < 0.4 && m('api', { fn: O.type === 'image' ? 'deletePictureControl' : O.type === 'equation' ? 'deleteEquationControl' : 'deleteShapeControl', args: [O.s, O.p, O.ctrl] }),
    () => O && O.type === 'group' && m('api', { fn: 'ungroupShape', args: [O.s, O.p, O.ctrl] }),
    () => { const same = objs.filter((x) => O && x.s === O.s); const T = [O, same[ri(same.length || 1)]].filter(Boolean); return T.length >= 2 && T[0] !== T[1] && m('api', { fn: 'groupShapes', args: [JSON.stringify({ sectionIdx: O.s, targets: T.map((x) => ({ paraIdx: x.p, controlIdx: x.ctrl })) })] }); },
    () => O && O.type === 'shape' && O.s === 0 && m('api', { fn: 'setTextBoxAt', args: [O.p, O.ctrl, rand() < 0.7] }),   // 글상자 붙이기·떼기(엔진 API가 구역을 받지 않아 첫 구역만)
  ];
  try { const r = kinds[ri(kinds.length)](); return r ? 'ok' : 'skipped'; } catch (e) { return rejectOk(e); }
}
function pageOp(doc, m, rand, pos) {
  const ri = (n) => Math.floor(rand() * n);
  const kinds = [
    () => m('api', { fn: 'setPageDef', args: [0, JSON.stringify({ width: [59528, 84188, 41953][ri(3)], height: [84188, 59528, 119055][ri(3)], landscape: rand() < 0.4, marginLeft: 2000 + ri(8000), marginRight: 2000 + ri(8000), marginTop: 2000 + ri(8000), marginBottom: 2000 + ri(8000) })] }),
    () => m('api', { fn: 'setColumnDef', args: [0, 1 + ri(3), ri(3), ri(2), ri(3000)] }),
    () => m('api', { fn: 'insertPageBreak', args: [0, pos.p, pos.o] }),
    () => m('api', { fn: 'insertColumnBreak', args: [0, pos.p, pos.o] }),
    () => m('api', { fn: 'setPageBorderFill', args: [0, JSON.stringify({ borderLeft: { type: ri(3), width: ri(8), color: '#123456' }, fillType: rand() < 0.5 ? 'solid' : 'none', fillColor: '#ddeeff' })] }),
    () => m('api', { fn: 'setPageHide', args: [0, pos.p, rand() < 0.5, rand() < 0.5, false, rand() < 0.5, false, rand() < 0.5] }),
    () => m('api', { fn: 'insertNewNumber', args: [0, pos.p, pos.o, ri(50)] }),
    () => m('hfset', { s: 0, header: rand() < 0.5, applyTo: ri(3), lines: rand() < 0.2 ? [] : ['머리 {쪽}', '두번째', '끝 {전체쪽}'].slice(0, 1 + ri(3)), alignment: ['left', 'center', 'right'][ri(3)] }),
    () => m('api', { fn: rand() < 0.5 ? 'insertFootnote' : 'insertEndnote', args: [0, pos.p, pos.o] }),
    () => { const f = m('fnat', { pos: { s: 0, p: pos.p, o: pos.o, path: null } }).fn; return f && m('fnset', { s: 0, p: pos.p, ctrl: f.ctrl, lines: ['각주', '둘째'].slice(0, 1 + ri(2)) }); },
    () => { const f = m('fnat', { pos: { s: 0, p: pos.p, o: pos.o, path: null } }).fn; return f && rand() < 0.5 && m('api', { fn: 'deleteFootnote', args: [0, pos.p, f.ctrl] }); },
  ];
  try { const r = kinds[ri(kinds.length)](); return r ? 'ok' : 'skipped'; } catch (e) { return rejectOk(e); }
}
function miscOp(doc, m, rand, pos) {
  const ri = (n) => Math.floor(rand() * n);
  const len = doc.getParagraphLength(0, pos.p);
  const o1 = Math.min(len, pos.o), o2 = Math.min(len, o1 + 1 + ri(4));
  const kinds = [
    () => m('hlinsert', { a: { s: 0, p: pos.p, o: o1, path: null }, b: { s: 0, p: pos.p, o: o2, path: null }, uri: 'https://example.com/' + ri(100), text: '' }),
    () => m('hlinsert', { a: { s: 0, p: pos.p, o: o1, path: null }, b: { s: 0, p: pos.p, o: o1, path: null }, uri: 'https://e.org', text: '링크' + ri(9) }),
    () => m('api', { fn: 'addBookmark', args: [0, pos.p, o1, 'bm' + ri(1000)] }),
    () => { const bs = JSON.parse(doc.getBookmarks()); return bs.length && m('api', { fn: rand() < 0.5 ? 'deleteBookmark' : 'renameBookmark', args: rand() < 0.5 ? [bs[0].sec, bs[0].para, bs[0].ctrlIdx] : [bs[0].sec, bs[0].para, bs[0].ctrlIdx, 'r' + ri(1000)] }); },
    () => m('api', { fn: 'insertClickHereField', args: [0, pos.p, o1, '안내', '메모', 'f' + ri(1000), true] }),
    () => { const fl = JSON.parse(doc.getFieldList()).filter((x) => x.fieldType === 'clickhere'); return fl.length && m('api', { fn: 'setFieldValue', args: [fl[ri(fl.length)].fieldId, '값' + ri(9)] }); },
    () => m('api', { fn: 'applyStyle', args: [0, pos.p, ri(8)] }),
    () => m('api', { fn: 'createStyle', args: [JSON.stringify({ name: 's' + ri(1000), englishName: 's', type: 0, nextStyleId: 0 })] }),
    () => m('parafmt', { a: { s: 0, p: pos.p, o: 0, path: null }, b: { s: 0, p: pos.p, o: 0, path: null }, props: { headType: ['None', 'Number', 'Bullet'][ri(3)], numberingId: 1, paraLevel: ri(3) } }),
    () => m('replall', { query: ['a', '한', 'Hello'][ri(3)], text: ['', 'ZZ', '가나'][ri(3)], caseSensitive: rand() < 0.5 }),
    () => { const f = m('find', { query: '한', forward: rand() < 0.5, caseSensitive: false, from: { s: 0, p: pos.p, o: o1 } }); return f.found && m('repl', { a: f.a, b: f.b, text: '바꿈' }); },
    () => { const cs = m('copysel', { a: { s: 0, p: pos.p, o: o1, path: null }, b: { s: 0, p: pos.p, o: o2, path: null } }); return m('pasterich', { pos: { s: 0, p: pos.p, o: o2, path: null }, text: cs.text, html: cs.html }); },
    () => m('view', { mode: ['marks', 'codes', 'transparent'][ri(3)], on: rand() < 0.5 }),
  ];
  try { const r = kinds[ri(kinds.length)](); return r ? 'ok' : 'skipped'; } catch (e) { return rejectOk(e); }
}
let failures = 0, totalOps = 0, noRect = 0, miscOps = 0, pageOps = 0, objOps = 0, tblOps = 0, rejected = 0, apiOps = 0, zoneOps = 0;
const fail = (f, msg) => { failures++; console.log('  ✗', f.rel, msg); };

for (const f of files) {
  let doc;
  try { doc = new HwpDocument(new Uint8Array(readFileSync(f.p))); } catch { continue; }
  let info; try { info = JSON.parse(doc.getDocumentInfo()); } catch { continue; }
  if (info.encrypted) continue;
  const m = (op, x = {}) => run(doc, HwpDocument, { op, ...x });
  const orig = paras(doc);
  const n0 = doc.getParagraphCount(0);
  if (!n0) continue;
  const randPos = () => {
    const p = Math.floor(rand() * Math.min(n0, doc.getParagraphCount(0)));
    const l = doc.getParagraphLength(0, p);
    return { s: 0, p, o: Math.floor(rand() * (l + 1)), path: null };
  };
  let pos = randPos(), muts = 0, ok = true, lastOp = '';
  try {
    for (let i = 0; i < STEPS && ok; i++) {
      const k = HFR && rand() < HFR ? 0.9951 : TBLP && rand() < TBLP ? 0.95 : (OBJR && rand() < OBJR ? 0.98 : (PAGER && rand() < PAGER ? 0.99 : (MISCR && rand() < MISCR ? 0.995 : rand())));
      let r = null, op = ''; lastOp = '';
      if (k < 0.34) { op = lastOp = 'insert'; r = m('insert', { pos, text: POOL[Math.floor(rand() * POOL.length)], group: rand() < 0.5 }); }
      else if (k < 0.44) { op = lastOp = 'enter'; r = m('enter', { pos }); }
      else if (k < 0.58) { op = 'del'; r = m('del', { pos, dir: rand() < 0.5 ? 'back' : 'fwd', group: false }); }
      else if (k < 0.66) { op = 'delrange'; const b = { ...pos, o: Math.min(doc.getParagraphLength(0, pos.p), pos.o + 1 + Math.floor(rand() * 8)) }; r = m('delrange', { a: pos, b }); }
      else if (k < 0.74) { op = 'fmt'; const b = { ...pos, o: Math.min(doc.getParagraphLength(0, pos.p), pos.o + 1 + Math.floor(rand() * 8)) }; const FMTS = [{ bold: rand() < 0.5, italic: rand() < 0.5 }, { fontName: ['맑은 고딕', '바탕', 'Arial', '새글꼴'][Math.floor(rand() * 4)] }, { strikethrough: rand() < 0.5, underline: rand() < 0.5 },
          { shadeColor: ['#ffff00', '#ffffff', '#00ff00'][Math.floor(rand() * 3)], textColor: '#ff0000' }, { spacings: Array(7).fill(Math.floor(rand() * 21) - 10), ratios: Array(7).fill(60 + Math.floor(rand() * 100)) }, { fontSize: 800 + 100 * Math.floor(rand() * 20) }];
        m('fmt', { a: pos, b, props: FMTS[Math.floor(rand() * FMTS.length)] }); r = { pos }; }
      else if (k < 0.77) { op = 'parafmt'; const b = { ...pos, p: Math.min(doc.getParagraphCount(0) - 1, pos.p + Math.floor(rand() * 3)), o: 0 };
        m('parafmt', { a: pos, b, props: [{ lineSpacing: [100, 160, 250][Math.floor(rand() * 3)], lineSpacingType: 'Percent' }, { marginLeft: 2000 * Math.floor(rand() * 5) }, { alignment: ['left', 'center', 'right', 'justify'][Math.floor(rand() * 4)] }][Math.floor(rand() * 3)] }); r = { pos }; }
      else if (k < 0.80) { op = 'paste'; r = m('paste', { pos, text: ['한 줄', '두\n줄', 'a\n\nb\n'][Math.floor(rand() * 3)] }); }
      else if (k < 0.88) { op = 'undo'; r = m('undo', { pos }); }
      else if (k < 0.92) { op = 'redo'; r = m('redo', { pos }); }
      else if (k < 0.97) {
        op = 'table';
        const t = findTables(doc);
        if (!t.length) { const pp = randPos(); m('api', { fn: 'createTable', args: [0, pp.p, pp.o, 2 + Math.floor(rand() * 3), 2 + Math.floor(rand() * 3)] }); pos = { s: 0, p: pp.p, o: 0, path: null }; r = null; muts++; apiOps++; tblOps++; if (!checkPos(doc, pos)) { pos = randPos(); } continue; }
        const T = t[Math.floor(rand() * t.length)];
        const before = JSON.stringify(paras(doc));
        const res = tableOp(doc, m, T, rand);
        if (res === 'rejected') { rejected++; if (JSON.stringify(paras(doc)) !== before) { fail(f, `step ${i}: 엔진이 거부한 표 편집 뒤 문서가 바뀌어 있다`); ok = false; break; } }
        else { muts++; tblOps++; }
        pos = { s: 0, p: Math.min(doc.getParagraphCount(0) - 1, T.p), o: 0, path: null };
        continue;
      }
      else if (HFR && k >= 0.995) {
        op = 'zone';
        const res = hfOp(doc, m, rand, { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0, path: null });
        if (res !== 'ok' && res !== 'rejected') { fail(f, `step ${i}: ${res}`); ok = false; break; }
        if (res === 'rejected') rejected++; else { muts += 12; zoneOps++; }   // 한 묶음이 되돌리기 항목을 여러 개 만든다
        pos = { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0, path: null };
        continue;
      }
      else if (MISCP && k >= 0.99) {
        op = 'misc';
        const before = JSON.stringify(paras(doc));
        const res = miscOp(doc, m, rand, { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: pos.o });
        if (res === 'rejected') { rejected++; if (JSON.stringify(paras(doc)) !== before) { fail(f, `step ${i}: 엔진이 거부한 편집 뒤 문서가 바뀌어 있다`); ok = false; break; } }
        else { muts++; miscOps++; }
        pos = { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0, path: null };
        continue;
      }
      else if (PAGEP && k >= 0.985) {
        op = 'page';
        const before = JSON.stringify(paras(doc));
        const res = pageOp(doc, m, rand, { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: Math.min(pos.o, doc.getParagraphLength(0, Math.min(pos.p, doc.getParagraphCount(0) - 1))) });
        if (res === 'rejected') { rejected++; if (JSON.stringify(paras(doc)) !== before) { fail(f, `step ${i}: 엔진이 거부한 쪽 편집 뒤 문서가 바뀌어 있다`); ok = false; break; } }
        else { muts++; pageOps++; }
        pos = { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0, path: null };
        continue;
      }
      else if (OBJP && k >= 0.97) {
        op = 'object';
        const before = JSON.stringify(paras(doc));
        const res = objectOp(doc, m, rand, { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0 });
        if (res === 'rejected') { rejected++; if (JSON.stringify(paras(doc)) !== before) { fail(f, `step ${i}: 엔진이 거부한 개체 편집 뒤 문서가 바뀌어 있다`); ok = false; break; } }
        else { muts++; objOps++; }
        pos = { s: 0, p: Math.min(pos.p, doc.getParagraphCount(0) - 1), o: 0, path: null };
        continue;
      }
      else { op = 'jump'; pos = randPos(); continue; }
      if (op !== 'undo' && op !== 'redo') muts++;
      if (r?.pos && !r.pos.hf) pos = r.pos;   // 되돌리기가 머리글·각주 안 위치를 돌려줄 수 있다(본문 위치가 아니므로 쓰지 않는다)
      else if (op === 'undo' || op === 'redo') pos = randPos();
      // 불변식: 캐럿이 문단 안에 있고 좌표를 구할 수 있다
      const n = doc.getParagraphCount(0);
      if (pos.p >= n) pos = { s: 0, p: Math.max(0, n - 1), o: 0, path: null };
      if (pos.path) { if (!m('caret', { pos }).rect) pos = { s: 0, p: pos.p, o: 0, path: null }; else { m('caret', { pos }); totalOps++; continue; } }   // 칸 안 위치는 캐럿 좌표가 나오면 유효
      const l = doc.getParagraphLength(0, pos.p);
      if (pos.o > l) { fail(f, `step ${i} ${op}: 캐럿 o=${pos.o} > 문단 길이 ${l}`); ok = false; break; }
      if (!m('caret', { pos }).rect) noRect++;
      totalOps++;
    }
  } catch (e) { fail(f, `예외(${lastOp} ${JSON.stringify(pos)} len=${(() => { try { return doc.getParagraphLength(0, pos.p); } catch { return '?'; } })()}): ${String(e && (e.message || e.code) || e).slice(0, 140)}`); ok = false; }
  if (!ok) { try { doc.free(); } catch {} continue; }
  // 저장 → 다시 열기 → 자체 점검
  try {
    const hwpx = /\.hwpx$/i.test(f.p);
    const s = m('save', { format: hwpx ? 'hwpx' : 'hwp' });
    if (s.verify.reopenError) fail(f, `저장본을 다시 열지 못함: ${s.verify.reopenError}`);
    else if (!s.verify.ok && !/^3\./.test(info.version || '')) {
      const a = paras(doc), b = paras(new HwpDocument(new Uint8Array(s.bytes))), dd = [];
      for (let i = 0; i < Math.max(a.length, b.length) && dd.length < 3; i++) if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) dd.push(`#${i} ${JSON.stringify(a[i])} → ${JSON.stringify(b[i])}`);
      fail(f, `저장 점검 불일치 ${s.verify.diffs}곳 ${dd.join(' | ')}`);
    }   // HWP 3.0은 변환 경고 대상이라 제외
  } catch (e) { fail(f, `저장 예외: ${String(e && (e.message || e.code) || e).slice(0, 140)}`); }
  // 전부 되돌리면 원래 구조
  try {
    for (let i = 0; i < 200; i++) { const r = m('undo', { pos }); if (r.empty) break; }
    const now = paras(doc);
    // 되돌리기 보관은 60개까지라 그보다 많이 편집했으면 처음으로 돌아갈 수 없다(설계된 한도)
    if (muts < 55 && JSON.stringify(now) !== JSON.stringify(orig)) fail(f, `되돌리기 뒤 문서 구조가 원본과 다름 (편집 ${muts}회)`);
  } catch (e) { fail(f, `되돌리기 예외: ${String(e && (e.message || e.code) || e).slice(0, 140)}`); }
  try { doc.free(); } catch {}
}
console.log(`퍼저 seed=${SEED}: 파일 ${files.length}개, 편집 ${totalOps}회(캐럿 좌표 없음 ${noRect}, 표 편집 ${tblOps}·개체 편집 ${objOps}·쪽 편집 ${pageOps}·기타 편집 ${miscOps}·머리글·각주 안 편집 ${zoneOps}·엔진 거부 ${rejected}), 실패 ${failures}`);
process.exit(failures ? 1 : 0);
