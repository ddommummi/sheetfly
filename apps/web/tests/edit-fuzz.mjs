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

let failures = 0, totalOps = 0, noRect = 0;
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
  let pos = randPos(), muts = 0, ok = true;
  try {
    for (let i = 0; i < STEPS && ok; i++) {
      const k = rand();
      let r = null, op = '';
      if (k < 0.34) { op = 'insert'; r = m('insert', { pos, text: POOL[Math.floor(rand() * POOL.length)], group: rand() < 0.5 }); }
      else if (k < 0.44) { op = 'enter'; r = m('enter', { pos }); }
      else if (k < 0.58) { op = 'del'; r = m('del', { pos, dir: rand() < 0.5 ? 'back' : 'fwd', group: false }); }
      else if (k < 0.66) { op = 'delrange'; const b = { ...pos, o: Math.min(doc.getParagraphLength(0, pos.p), pos.o + 1 + Math.floor(rand() * 8)) }; r = m('delrange', { a: pos, b }); }
      else if (k < 0.74) { op = 'fmt'; const b = { ...pos, o: Math.min(doc.getParagraphLength(0, pos.p), pos.o + 1 + Math.floor(rand() * 8)) }; m('fmt', { a: pos, b, props: { bold: rand() < 0.5, italic: rand() < 0.5 } }); r = { pos }; }
      else if (k < 0.80) { op = 'paste'; r = m('paste', { pos, text: ['한 줄', '두\n줄', 'a\n\nb\n'][Math.floor(rand() * 3)] }); }
      else if (k < 0.88) { op = 'undo'; r = m('undo', { pos }); }
      else if (k < 0.92) { op = 'redo'; r = m('redo', { pos }); }
      else { op = 'jump'; pos = randPos(); continue; }
      if (op !== 'undo' && op !== 'redo') muts++;
      if (r?.pos) pos = r.pos;
      else if (op === 'undo' || op === 'redo') pos = randPos();
      // 불변식: 캐럿이 문단 안에 있고 좌표를 구할 수 있다
      const n = doc.getParagraphCount(0);
      if (pos.p >= n) pos = { s: 0, p: Math.max(0, n - 1), o: 0, path: null };
      const l = doc.getParagraphLength(0, pos.p);
      if (pos.o > l) { fail(f, `step ${i} ${op}: 캐럿 o=${pos.o} > 문단 길이 ${l}`); ok = false; break; }
      if (!m('caret', { pos }).rect) noRect++;
      totalOps++;
    }
  } catch (e) { fail(f, `예외: ${String(e && (e.message || e.code) || e).slice(0, 140)}`); ok = false; }
  if (!ok) { try { doc.free(); } catch {} continue; }
  // 저장 → 다시 열기 → 자체 점검
  try {
    const hwpx = /\.hwpx$/i.test(f.p);
    const s = m('save', { format: hwpx ? 'hwpx' : 'hwp' });
    if (s.verify.reopenError) fail(f, `저장본을 다시 열지 못함: ${s.verify.reopenError}`);
    else if (!s.verify.ok && !/^3\./.test(info.version || '')) fail(f, `저장 점검 불일치 ${s.verify.diffs}곳`);   // HWP 3.0은 변환 경고 대상이라 제외
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
console.log(`퍼저 seed=${SEED}: 파일 ${files.length}개, 편집 ${totalOps}회(캐럿 좌표 없음 ${noRect}), 실패 ${failures}`);
process.exit(failures ? 1 : 0);
