// DOCX 편집 모델 시험의 공통 "검증기": 문서 하나에 무작위 편집 열을 적용하고, 모델과 JS 문자열 그림자가 같은지, 저장 뒤 office_oxide가
// 다시 읽은 글이 기대와 같은지(= 엉뚱한 문단이 고쳐지지 않았는지), 바뀌지 않아야 할 ZIP 부품이 그대로인지, XML 문단 태그 짝이 맞는지 본다.
import { DocxEditModel, EditError } from '../src/docx/edit/model.js';
import { readZip } from '../src/docx/edit/zip.js';
import { flattenIr } from '../src/docx/edit/ir.js';
import { irOf } from './docx-edit-helpers.mjs';

export function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
export const hashSeed = (seed, name) => seed * 100003 + [...name].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
const POOL = ['a', 'Z', '한', '글', ' ', 'Hello', '세계', '😀', '&', '<b>', '"q"', "'", '\t', '가나다라', 'x'.repeat(40), '  '];
const cps = (s) => [...s];
const sl = (s, a, b) => cps(s).slice(a, b).join('');

/** @returns {Promise<{status:'skip'|'ok'|'fail', why?:string, stats?:object, applied:number, opKinds:object, failure?:string}>} */
export async function checkDocx(bytes, rand, OPS = 10, V = false) {
  const opKinds = {};
  let full, m;
  try { full = irOf(bytes); } catch { return { status: 'skip', why: 'IR 실패', applied: 0, opKinds }; }
  try { m = await DocxEditModel.open(bytes, full); } catch (e) { return { status: 'skip', why: e instanceof EditError ? e.code : `열기 실패:${String(e.message).slice(0, 30)}`, applied: 0, opKinds }; }
  const stats = m.stats();
  const origBlocks = flattenIr(full);
  const blockToOrig = new Map(); for (let p = 0; p < m.paragraphCount; p++) { const b = m.blockOf(p); if (b >= 0) blockToOrig.set(b, m.paras[p].orig); }
  const mk = (text, from) => ({ text, orig: from.orig, ghost: from.ghost, anchor: from.anchor });
  const S = Array.from({ length: m.paragraphCount }, (_, p) => ({ text: m.text(p), orig: m.paras[p].orig, ghost: !!m.paras[p].ghost, anchor: m.paras[p].ghostAnchor }));
  const candidates = () => { const c = []; for (let p = 0; p < m.paragraphCount; p++) if (S[p].text && m.canEdit(p)) c.push(p); return c; };
  const ghosts = () => { const c = []; for (let p = 0; p < m.paragraphCount; p++) if (S[p].ghost && !S[p].text && m.canEdit(p)) c.push(p); return c; };
  let applied = 0;
  const note = (k) => { opKinds[k] = (opKinds[k] ?? 0) + 1; applied++; if (V) console.log('  op', k); };
  try {
    for (let i = 0; i < OPS; i++) {
      const g = ghosts();
      if (g.length && rand() < 0.25) { const p = g[Math.floor(rand() * g.length)], str = POOL[Math.floor(rand() * POOL.length)]; if (str) { m.insertText(p, 0, str); S[p].text = str; note('ghost-insert'); } continue; }
      const c = candidates(); if (!c.length) break;
      const p = c[Math.floor(rand() * c.length)], len = cps(S[p].text).length, k = rand();
      if (V) console.log(`  → p=${p} len=${len} k=${k.toFixed(2)} text=${JSON.stringify(S[p].text).slice(0, 40)} orig=${S[p].orig}`);
      if (k < 0.4) { const o = Math.floor(rand() * (len + 1)), s = POOL[Math.floor(rand() * POOL.length)]; m.insertText(p, o, s); S[p].text = sl(S[p].text, 0, o) + s + sl(S[p].text, o); note('insert'); }
      else if (k < 0.55) { const a = Math.floor(rand() * (len + 1)), b = Math.min(len, a + 1 + Math.floor(rand() * 6)); m.deleteRange({ p, o: a }, { p, o: b }); S[p].text = sl(S[p].text, 0, a) + sl(S[p].text, b); note('delete'); }
      else if (k < 0.7) { const o = Math.floor(rand() * (len + 1)); m.splitParagraph(p, o); S.splice(p, 1, mk(sl(S[p].text, 0, o), S[p]), mk(sl(S[p].text, o), S[p])); note('split'); }
      else if (k < 0.82) { if (p > 0 && m.canEdit(p - 1)) { try { m.mergeBack(p); } catch (e) { if (e.code === 'not_sibling') continue; throw e; } S.splice(p - 1, 2, mk(S[p - 1].text + S[p].text, S[p - 1])); note('merge'); } }
      else if (k < 0.92) {
        let q = p; while (q + 1 < m.paragraphCount && q - p < 3 && m.canEdit(q + 1)) q++;
        if (q > p) { const a = Math.floor(rand() * (len + 1)), lq = cps(S[q].text).length, b = Math.floor(rand() * (lq + 1)); try { m.deleteRange({ p, o: a }, { p: q, o: b }); } catch (e) { if (e.code === 'not_sibling') continue; throw e; } S.splice(p, q - p + 1, mk(sl(S[p].text, 0, a) + sl(S[q].text, b), S[p])); note('cross-delete'); }
      } else if (m.undo()) { m.redo(); note('undo-redo'); }
      if (S.length !== m.paragraphCount) throw new Error(`문단 수 불일치 모델 ${m.paragraphCount} 그림자 ${S.length}`);
      for (let q = Math.max(0, p - 1); q <= Math.min(S.length - 1, p + 1); q++) if (m.text(q) !== S[q].text) throw new Error(`문단 ${q} 글 불일치: 모델 ${JSON.stringify(m.text(q)).slice(0, 50)} 그림자 ${JSON.stringify(S[q].text).slice(0, 50)}`);
    }
    if (applied === 0) return { status: 'ok', stats, applied, opKinds };
    const out = await m.save();
    const z0 = readZip(bytes), z1 = readZip(out);
    for (const e of z0.entries) { if (e.name === 'word/document.xml') continue; const g = z1.entries.find((x) => x.name === e.name); if (!g || g.localLen !== e.localLen || !bytes.subarray(e.localOff, e.localOff + e.localLen).every((v, j) => v === out[g.localOff + j])) throw new Error(`${e.name} 부품이 바뀌었다`); }
    const xml = m.xml(), opens = (xml.match(/<w:p(?=[\s>\/])/g) ?? []).length, selfs = (xml.match(/<w:p(\s[^>]*)?\/>/g) ?? []).length, closes = (xml.match(/<\/w:p>/g) ?? []).length;
    if (m.px === 'w' && opens - selfs !== closes) throw new Error(`w:p 태그 짝이 안 맞는다 ${opens}-${selfs} vs ${closes}`);
    const expected = [];
    const ghostText = (anchor) => { for (const s of S) if (s.ghost && s.anchor === anchor && s.text) expected.push(s.text); };
    ghostText(-1);
    origBlocks.forEach((b, i) => {
      if (b.text === null) return;
      if (!blockToOrig.has(i)) { if (b.text) expected.push(b.text); return; }
      const orig = blockToOrig.get(i);
      for (const s of S) if (s.orig === orig && !s.ghost && s.text) expected.push(s.text);
      ghostText(orig);
    });
    const after = flattenIr(irOf(out)).filter((b) => b.text).map((b) => b.text);
    if (V) { console.log('  S:', JSON.stringify(S.map((x) => [x.orig, x.text.slice(0, 20)]))); console.log('  expected', JSON.stringify(expected.map((x) => x.slice(0, 25)))); console.log('  after   ', JSON.stringify(after.map((x) => x.slice(0, 25)))); }
    if (after.length !== expected.length || after.some((t, j) => t !== expected[j])) {
      let j = 0; while (j < after.length && after[j] === expected[j]) j++;
      throw new Error(`저장 뒤 글 불일치(블록 ${j}): 읽은 ${JSON.stringify(after[j])?.slice(0, 70)} / 기대 ${JSON.stringify(expected[j])?.slice(0, 70)} (개수 ${after.length}/${expected.length})`);
    }
  } catch (e) { return { status: 'fail', failure: String(e.message ?? e).slice(0, 200), stats, applied, opKinds }; }
  return { status: 'ok', stats, applied, opKinds };
}
