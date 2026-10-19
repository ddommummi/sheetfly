// 편집 왕복 코퍼스 시험: 샘플 HWP·HWPX를 편집(입력·줄바꿈·삭제·서식·되돌리기) → 저장 → 다시 열어
// "편집하지 않은 본문이 그대로인가"를 문서마다 판정한다. 편집기가 Worker에서 쓰는 코드(src/hwp-edit.js)를 그대로 부른다.
//   node tests/edit-corpus.mjs [--limit N] [--min-pass 0.95] [--max-mb 12] [--out result.json]
// 통과(bodySame): 저장 자체 점검 통과 + 다시 열림 + 입력한 글자가 들어 있음 + 편집한 문단을 뺀 모든 문단의 길이·앞 40자가 원본과 같음.
// 열 수 없거나(손상·암호) 너무 큰 문서는 모수에서 제외하고 따로 센다. 통과율이 --min-pass 미만이면 실패(종료 코드 1).
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/hwp-edit.js';

const here = dirname(fileURLToPath(import.meta.url));
const wasmDir = resolve(here, '../src/wasm') + '/';
const samples = resolve(here, '../../../third_party/rhwp/samples');
const { default: init, HwpDocument } = await import(wasmDir + 'rhwp.js');
await init({ module_or_path: readFileSync(wasmDir + 'rhwp_bg.wasm') });

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('limit', 0));
const MIN_PASS = Number(arg('min-pass', 0.95));
const MAX_BYTES = Number(arg('max-mb', 12)) * 1048576;
const OUT = arg('out', '');
const VERBOSE = process.argv.includes('--verbose');
// 열기·조판만 수 분 걸리는 알려진 병리 문서(docs/phase1/report.md, docs/phase2/report.md). 글자마다 전체를 다시 조판하는 편집은 이 문서들에서 쓸 수 없는 수준이라(편집기는 열기가 느렸던 문서에서 경고한다) 모수에서 뺀다.
const SLOW = /issue2063_huge_cellbreak_table|1130000-.*시장구조조사/;

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(hwp|hwpx)$/i.test(e.name)) yield p;
  }
}
let files = [...walk(samples)].map((p) => ({ p, rel: relative(samples, p), size: statSync(p).size })).sort((a, b) => a.rel.localeCompare(b.rel));
if (LIMIT) files = files.slice(0, LIMIT);

const paras = (d, s = 0) => {
  const out = [];
  const n = d.getParagraphCount(s);
  for (let p = 0; p < Math.min(n, 20000); p++) { const l = d.getParagraphLength(s, p); out.push([l, l ? d.getTextRange(s, p, 0, Math.min(l, 40)) : '']); }
  return out;
};
const T1 = 'EDIT한글ok';

const rows = [];
for (const f of files) {
  const row = { f: f.rel };
  if (VERBOSE) console.error(`[${rows.length + 1}/${files.length}] ${f.rel} (${Math.round(f.size / 1024)}KB)`);
  if (f.size > MAX_BYTES) { row.skip = 'big'; rows.push(row); continue; }
  if (SLOW.test(f.rel) && !process.argv.includes('--include-slow')) { row.skip = 'slow'; rows.push(row); continue; }
  let doc;
  try { doc = new HwpDocument(new Uint8Array(readFileSync(f.p))); } catch (e) { row.skip = 'open'; rows.push(row); continue; }
  try {
    const info = JSON.parse(doc.getDocumentInfo());
    if (info.encrypted) { row.skip = 'encrypted'; rows.push(row); continue; }
    const orig = paras(doc);
    // 본문 첫 글자 있는 문단(최상위)
    let P = orig.findIndex(([l]) => l > 0);
    if (P < 0) P = 0;
    let pos = { s: 0, p: P, o: 0, path: null };
    const m = (op, x = {}) => run(doc, HwpDocument, { op, ...x });
    pos = m('insert', { pos, text: T1, group: true }).pos;
    const split = m('enter', { pos });                                   // 줄바꿈 → 새 문단 P+1
    pos = split.pos;
    pos = m('insert', { pos, text: 'second', group: true }).pos;
    m('fmt', { a: { ...pos, o: 0 }, b: pos, props: { bold: true, strikethrough: true, underline: true, fontName: '맑은 고딕', spacings: Array(7).fill(-3) } });    // 서식
    m('parafmt', { a: pos, b: pos, props: { lineSpacing: 200, lineSpacingType: 'Percent', marginLeft: 2000 } });
    const del = m('del', { pos, dir: 'back', group: false }); pos = del.pos ?? pos;
    m('undo', { pos }); m('redo', { pos });                              // 되돌리기·다시 실행이 문서를 깨뜨리지 않는지
    // 저장
    const hwpx = /\.hwpx$/i.test(f.p);
    const saved = m('save', { format: hwpx ? 'hwpx' : 'hwp' });
    row.verifyOk = !!saved.verify.ok; row.reopenError = saved.verify.reopenError;
    row.pages = `${saved.verify.pagesBefore}→${saved.verify.pagesAfter}`;
    row.exportMs = saved.exportMs;
    const re = new HwpDocument(new Uint8Array(saved.bytes));
    try {
      const after = paras(re);
      row.inserted = re.getTextRange(0, P, 0, T1.length) === T1;
      // 새 문단(P+1)을 빼고, 편집한 문단 P는 제외하고 비교
      const rest = after.filter((_, i) => i !== P + 1);
      let diffs = rest.length === orig.length ? 0 : Math.abs(rest.length - orig.length) + 1;
      for (let i = 0; i < Math.min(rest.length, orig.length); i++) if (i !== P && (rest[i][0] !== orig[i][0] || rest[i][1] !== orig[i][1])) diffs++;
      row.diffs = diffs;
      // 서식이 저장본에 남았는지(본문 동일 판정과는 별도로 센다)
      try {
        const c = JSON.parse(re.getCharPropertiesAt(0, P + 1, 1)), pp = JSON.parse(re.getParaPropertiesAt(0, P + 1));
        row.fmtKept = c.bold === true && c.strikethrough === true && c.underline === true && c.fontFamily === '맑은 고딕' && c.spacings[0] === -3 && Math.round(pp.lineSpacing) === 200 && pp.marginLeft > 10;
      } catch { row.fmtKept = false; }
      row.sections = `${doc.getSectionCount()}→${re.getSectionCount()}`;
    } finally { re.free(); }
    row.bodySame = row.verifyOk && !row.reopenError && row.inserted && row.diffs === 0;
  } catch (e) {
    row.error = String(e && e.message || e).slice(0, 160);
  } finally { try { doc.free(); } catch { /* ignore */ } }
  rows.push(row);
}

const tested = rows.filter((r) => !r.skip);
const pass = tested.filter((r) => r.bodySame);
const skipped = (k) => rows.filter((r) => r.skip === k).length;
const ms = tested.map((r) => r.exportMs).filter((x) => typeof x === 'number').sort((a, b) => a - b);
console.log(`파일 ${rows.length}개 (제외: 열 수 없음 ${skipped('open')}, 암호 ${skipped('encrypted')}, ${MAX_BYTES / 1048576}MB 초과 ${skipped('big')}, 열기가 수 분 걸리는 병리 문서 ${skipped('slow')})`);
console.log(`편집→저장→다시 열기 본문 동일: ${pass.length}/${tested.length} = ${(pass.length / Math.max(1, tested.length) * 100).toFixed(1)}%  (기준 ${MIN_PASS * 100}%)`);
const fk = pass.filter((r) => r.fmtKept).length;
console.log(`서식(글꼴·굵게·취소선·자간·줄 간격·여백)이 저장본에 남음: ${fk}/${pass.length}`);
if (ms.length) console.log(`저장(내보내기) ms: p50 ${ms[Math.floor(ms.length / 2)]}, p95 ${ms[Math.floor(ms.length * 0.95)]}, 최대 ${ms.at(-1)}`);
const bad = tested.filter((r) => !r.bodySame);
for (const r of bad.slice(0, 40)) console.log('  ✗', r.f, r.error ?? JSON.stringify({ verifyOk: r.verifyOk, reopenError: r.reopenError, inserted: r.inserted, diffs: r.diffs, pages: r.pages, sections: r.sections }));
if (OUT) writeFileSync(OUT, JSON.stringify({ total: rows.length, tested: tested.length, pass: pass.length, rows }, null, 1));
process.exit(pass.length / Math.max(1, tested.length) >= MIN_PASS ? 0 : 1);
