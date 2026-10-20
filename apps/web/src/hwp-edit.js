// HWP/HWPX 편집 계층(Worker 쪽). 편집을 시작할 때만 불러온다(worker.js가 동적으로 import) — 열기만 하는 사용자는 이 파일을 받지 않는다.
// 문서(HwpDocument)는 worker.js가 갖고 있고, 여기서는 그 위에서 입력·삭제·서식·되돌리기·저장을 rhwp의 편집 API로 수행한다.
// 위치(pos): { s: 구역, p: 본문 문단(칸 안이면 그 칸을 가진 문단), o: 문단 안 글자 위치, path: null | [{controlIndex, cellIndex, cellParaIndex}…] }
//   · 글자 위치·개수는 UTF-16이 아니라 유니코드 글자(code point) 단위다(rhwp 계약) — 이모지 등을 위해 [...s].length로 센다.
//   · 표 칸 안이면 path의 마지막 항목의 cellParaIndex가 칸 안 문단 번호다.
//   · 머리글·바닥글·각주 안이면 hf = {k:'h'|'f'|'n', a: 적용 쪽(0 양쪽·1 짝수·2 홀수), pg: 보고 있는 쪽, bp/c: 각주가 달린 본문 문단·개체 번호}이고, p가 그 안의 문단 번호다(path는 null).
import { ext, tableAt, cellRange, pickObject } from './hwp-ops.js';
const states = new WeakMap();
// 엔진 일부 API(각주 정보 등)는 글 안의 제어 문자(탭·줄바꿈 등)를 JSON으로 이스케이프하지 않는다: 읽기에 실패하면 제어 문자를 이스케이프해 다시 읽는다.
const J = (s) => { try { return JSON.parse(s); } catch (e) { if (typeof s !== 'string') throw e; return JSON.parse(s.replace(/[\u0000-\u001f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`)); } };
const len = (s) => [...s].length;

function state(doc) {
  let s = states.get(doc);
  if (!s) { s = { undo: [], redo: [], dirty: false, savedMark: 0, pageCount: doc.pageCount(), gen: 0 }; states.set(doc, s); }
  return s;
}

// ── 위치 변환 ──
/** hitTest·moveVertical 결과(JSON 객체) → 위치. 편집할 수 없는 곳(머리글·각주·글상자 밖 등)이면 null. */
function toPos(h) {
  if (!h || h.sectionIndex == null) return null;
  if (h.inHeaderFooter || h.isHeaderFooter || h.inFootnote || h.isFootnote) return null;
  if (h.cellPath && h.cellPath.length) return { s: h.sectionIndex, p: h.parentParaIndex, o: h.charOffset, path: h.cellPath.map((x) => ({ controlIndex: x.controlIndex, cellIndex: x.cellIndex, cellParaIndex: x.cellParaIndex })) };
  if (h.parentParaIndex != null && h.controlIndex != null && h.cellIndex != null) {
    return { s: h.sectionIndex, p: h.parentParaIndex, o: h.charOffset, path: [{ controlIndex: h.controlIndex, cellIndex: h.cellIndex, cellParaIndex: h.cellParaIndex ?? 0 }] };
  }
  return { s: h.sectionIndex, p: h.paragraphIndex, o: h.charOffset, path: null };
}
const inCell = (pos) => !!pos.path;
const inHf = (pos) => !!pos.hf;
const isFn = (pos) => pos.hf?.k === 'n';
const isHd = (pos) => pos.hf.k === 'h';
const hfKey = (pos) => (pos.hf ? `${pos.hf.k}${pos.hf.a ?? ''}.${pos.hf.bp ?? ''}.${pos.hf.c ?? ''}` : '');
const cellPara = (pos) => pos.path[pos.path.length - 1].cellParaIndex;
const withCellPara = (pos, cp) => ({ ...pos, path: pos.path.map((x, i) => (i === pos.path.length - 1 ? { ...x, cellParaIndex: cp } : x)) });
const pj = (pos) => JSON.stringify(pos.path);
/** 칸 안 위치의 "문단 번호"(정렬·비교용). */
const paraNo = (pos) => (inCell(pos) ? cellPara(pos) : pos.p);
const sameContainer = (a, b) => a.s === b.s && hfKey(a) === hfKey(b) && (inCell(a) === inCell(b)) && (!inCell(a) || (a.p === b.p && a.path.length === b.path.length && a.path.every((x, i) => i === a.path.length - 1 || (x.controlIndex === b.path[i].controlIndex && x.cellIndex === b.path[i].cellIndex))));
const cmp = (a, b) => (paraNo(a) - paraNo(b)) || (a.o - b.o);

// ── 문단 정보 ──
// ── 머리글·바닥글·각주 안 ──
const fnInfo = (doc, pos) => J(doc.getFootnoteInfo(pos.s, pos.hf.bp, pos.hf.c));
const hfInfo = (doc, pos, p = pos.p) => J(doc.getHeaderFooterParaInfo(pos.s, isHd(pos), pos.hf.a, p));
const hfText = (doc, pos) => (isFn(pos) ? fnInfo(doc, pos).texts[pos.p] : hfInfo(doc, pos).text) ?? '';
/** 각주가 지금 어느 쪽·몇 번째 각주 칸에 있는지(편집으로 쪽이 바뀔 수 있어 매번 찾는다). */
function fnLoc(doc, pos) {
  const h = pos.hf, n = doc.pageCount();
  for (let d = 0; d <= 3; d++) for (const pg of d ? [h.pg - d, h.pg + d] : [h.pg]) {
    if (pg < 0 || pg >= n) continue;
    for (let fi = 0; fi < 40; fi++) {
      let x; try { x = J(doc.getPageFootnoteInfo(pg, fi)); } catch { break; }
      if (!x || x.ok === false) break;
      if (x.sectionIdx === pos.s && x.paraIdx === h.bp && x.controlIdx === h.c) return { pg, fi };
    }
  }
  return null;
}
function hfRect(doc, pos) {
  let r;
  if (isFn(pos)) { const f = fnLoc(doc, pos); if (!f) return null; r = J(doc.getCursorRectInFootnote(f.pg, f.fi, pos.p, pos.o)); }
  else r = J(doc.getCursorRectInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p, pos.o, pos.hf.pg));
  return { page: r.pageIndex, x: r.x, y: r.y, h: r.height };
}
/** 머리글·바닥글·각주 안 편집 API 묶음(위치 pos의 문단 기준). */
const HF = {
  insert: (d, pos, t) => J(isFn(pos) ? d.insertTextInFootnote(pos.s, pos.hf.bp, pos.hf.c, pos.p, pos.o, t) : d.insertTextInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p, pos.o, t)),
  del: (d, pos, n) => (isFn(pos) ? d.deleteTextInFootnote(pos.s, pos.hf.bp, pos.hf.c, pos.p, pos.o, n) : d.deleteTextInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p, pos.o, n)),
  split: (d, pos, o) => J(isFn(pos) ? d.splitParagraphInFootnote(pos.s, pos.hf.bp, pos.hf.c, pos.p, o) : d.splitParagraphInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p, o)),
  merge: (d, pos) => J(isFn(pos) ? d.mergeParagraphInFootnote(pos.s, pos.hf.bp, pos.hf.c, pos.p) : d.mergeParagraphInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p)),
};
function paraLen(doc, pos) { if (inHf(pos)) return [...hfText(doc, pos)].length; return inCell(pos) ? doc.getCellParagraphLengthByPath(pos.s, pos.p, pj(pos)) : doc.getParagraphLength(pos.s, pos.p); }
function paraCount(doc, pos) { if (inHf(pos)) return isFn(pos) ? fnInfo(doc, pos).paraCount : hfInfo(doc, pos, 0).paraCount; return inCell(pos) ? doc.getCellParagraphCountByPath(pos.s, pos.p, pj(pos)) : doc.getParagraphCount(pos.s); }
/** 캐럿 좌표. 개체만 있는 문단 등 좌표를 구할 수 없는 자리면 null(편집 자체는 이미 적용된 상태이므로 예외로 만들지 않는다). */
/** 머리글·바닥글·각주 영역을 누른 자리의 위치. 영역이 아니거나(머리글이 없으면 들어가지 않는다) 못 찾으면 null. */
function hfHit(doc, m) {
  try {
    const t = J(doc.hitTestHeaderFooter(m.page, m.x, m.y));
    if (t.hit && J(doc.getHeaderFooter(t.sectionIndex, t.isHeader, t.applyTo)).exists) {
      const r = J(doc.hitTestInHeaderFooterTarget(m.page, t.sectionIndex, t.isHeader, t.applyTo, m.x, m.y));
      if (r.hit) { const pos = { s: t.sectionIndex, p: r.paraIndex, o: r.charOffset, path: null, hf: { k: t.isHeader ? 'h' : 'f', a: t.applyTo, pg: m.page } }; return { pos, rect: rectOf(doc, pos) }; }
    }
  } catch { /* 머리글·바닥글이 아님 */ }
  try {
    const f = J(doc.hitTestFootnote(m.page, m.x, m.y));
    if (f.hit) {
      const at = J(doc.getPageFootnoteInfo(m.page, f.footnoteIndex)), r = J(doc.hitTestInFootnote(m.page, m.x, m.y));
      if (r.hit) { const pos = { s: at.sectionIdx, p: r.fnParaIndex, o: r.charOffset, path: null, hf: { k: 'n', pg: m.page, bp: at.paraIdx, c: at.controlIdx } }; return { pos, rect: rectOf(doc, pos) }; }
    }
  } catch { /* 각주가 아님 */ }
  return null;
}
function rectOf(doc, pos) {
  try {
    if (inHf(pos)) return hfRect(doc, pos);
    const r = J(inCell(pos) ? doc.getCursorRectByPath(pos.s, pos.p, pj(pos), pos.o) : doc.getCursorRect(pos.s, pos.p, pos.o));
    return { page: r.pageIndex, x: r.x, y: r.y, h: r.height };
  } catch { return null; }
}
function textOf(doc, pos, count) { if (inHf(pos)) return [...hfText(doc, pos)].slice(pos.o, pos.o + count).join(''); return inCell(pos) ? doc.getTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, count) : doc.getTextRange(pos.s, pos.p, pos.o, count); }

// ── 변경 기본 동작 (모두 새 위치를 돌려준다) ──
function opInsert(doc, pos, text) {
  if (inHf(pos)) return { ...pos, o: HF.insert(doc, pos, text).charOffset ?? pos.o + len(text) };
  const r = J(inCell(pos) ? doc.insertTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, text) : doc.insertText(pos.s, pos.p, pos.o, text));
  return { ...pos, o: r.charOffset ?? pos.o + len(text) };
}
function opDeleteChars(doc, pos, count) {
  if (inHf(pos)) { HF.del(doc, pos, count); return pos; }
  if (inCell(pos)) doc.deleteTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, count); else doc.deleteText(pos.s, pos.p, pos.o, count);
  return pos;
}
// splitParagraph는 다른 편집 API와 달리 "논리 오프셋"(글자 + 글자처럼 놓인 개체 하나를 1로 센다)을 받는다. 문단 앞이나 중간에 표·그림 같은
// 개체가 있으면 글자 오프셋 그대로 넘길 때 개체 수만큼 앞에서 잘린다. 그래서 나눈 뒤 앞 문단의 글자 수가 기대와 같은지 보고, 아니면 되돌려 한 칸씩 늘려 다시 해 본다.
function rawSplit(doc, pos, off) {
  return J(inCell(pos) ? doc.splitParagraphInCellByPath(pos.s, pos.p, pj(pos), off) : doc.splitParagraph(pos.s, pos.p, off));
}
function opSplit(doc, pos) {
  if (inHf(pos)) { HF.split(doc, pos, pos.o); return { ...pos, p: pos.p + 1, o: 0 }; }
  const inCellP = inCell(pos);
  const ctrls = inCellP ? 4 : (() => { try { return J(doc.getControlTextPositions(pos.s, pos.p)).length; } catch { return 0; } })();
  let r;
  if (!ctrls) r = rawSplit(doc, pos, pos.o);
  else {
    const snap = doc.saveSnapshot();
    const len0 = paraLen(doc, pos), cnt0 = paraCount(doc, pos);
    try {
      const tried = [];
      for (let k = 0; k <= ctrls + 1; k++) {
        r = rawSplit(doc, pos, pos.o + k);
        const got = paraLen(doc, pos);
        tried.push(got);
        if (got === pos.o) break;
        // 표만 있는 문단의 맨 앞에서 Enter: 엔진은 문단을 나누지 않고 표 뒤에 빈 문단을 만든다(한컴과 같은 동작). 글자 수가 그대로이고 문단이 하나 늘었으면 그것으로 본다.
        if (k === 0 && pos.o === 0 && got === len0 && paraCount(doc, pos) === cnt0 + 1) break;
        doc.restoreSnapshot(snap); r = null;
      }
      if (!r) throw { code: 'split_failed', message: `split offset not found (o=${pos.o}, 첫 문단 글자 수 ${tried.join(',')}, 개체 ${ctrls})` };
    } finally { try { doc.discardSnapshot(snap); } catch { /* ignore */ } }
  }
  return inCellP ? { ...withCellPara(pos, cellPara(pos) + 1), o: 0 } : { ...pos, p: r.paraIdx ?? pos.p + 1, o: 0 };
}
/** pos의 문단을 앞 문단에 합친다(Backspace at start). 합친 지점이 새 위치. 합쳐지지 않으면(표가 든 문단 등) null. */
function opMergeBack(doc, pos) {
  if (inHf(pos)) { const at = paraLen(doc, { ...pos, p: pos.p - 1 }); HF.merge(doc, pos); return { ...pos, p: pos.p - 1, o: at }; }
  const prev = inCell(pos) ? withCellPara(pos, cellPara(pos) - 1) : { ...pos, p: pos.p - 1 };
  const at = paraLen(doc, { ...prev, o: 0 }), before = paraCount(doc, pos);
  if (inCell(pos)) doc.mergeParagraphInCellByPath(pos.s, pos.p, pj(pos)); else doc.mergeParagraph(pos.s, pos.p);
  if (paraCount(doc, pos) >= before) return null;
  return { ...prev, o: at };
}
function opDeleteRange(doc, a, b) {
  if (inHf(a)) {   // 문단 안이면 글자만, 여러 문단이면 가운데 문단 글을 비우고 앞뒤를 지운 다음 문단을 합친다
    const at = (p) => ({ ...a, p, o: 0 });
    for (let p = a.p + 1; p < b.p; p++) { const n = paraLen(doc, at(p)); if (n) HF.del(doc, at(p), n); }
    if (b.p > a.p) { if (b.o) HF.del(doc, at(b.p), b.o); const n = paraLen(doc, a) - a.o; if (n > 0) HF.del(doc, a, n); for (let k = a.p + 1; k <= b.p; k++) HF.merge(doc, at(a.p + 1)); }
    else if (b.o > a.o) HF.del(doc, a, b.o - a.o);
    return a;
  }
  if (inCell(a)) { const r = J(doc.deleteRangeInCellByPath(a.s, a.p, pj(a), cellPara(a), a.o, cellPara(b), b.o)); return { ...withCellPara(a, r.paraIdx ?? cellPara(a)), o: r.charOffset ?? a.o }; }
  const r = J(doc.deleteRange(a.s, a.p, a.o, b.p, b.o));
  return { ...a, p: r.paraIdx ?? a.p, o: r.charOffset ?? a.o };
}

// ── 선택 영역 도우미 ──
function ordered(a, b) { return cmp(a, b) <= 0 ? [a, b] : [b, a]; }
function eachParaRange(doc, a, b, fn) {
  const [s, e] = ordered(a, b);
  for (let n = paraNo(s); n <= paraNo(e); n++) {
    const at = inCell(s) ? withCellPara(s, n) : { ...s, p: n };
    const from = n === paraNo(s) ? s.o : 0;
    const to = n === paraNo(e) ? e.o : paraLen(doc, { ...at, o: 0 });
    fn(at, from, to);
  }
}
function selectionText(doc, a, b) {
  const [s, e] = ordered(a, b);
  const out = [];
  eachParaRange(doc, s, e, (at, from, to) => { out.push(to > from ? textOf(doc, { ...at, o: from }, to - from) : ''); });
  return out.join('\n');
}

/** 화면 쪽 서식 이름을 rhwp 속성으로 바꾼다: fontName → 7개 언어 칸의 글꼴 번호(없으면 문서에 등록). */
function charJson(doc, props) {
  const p = { ...props };
  if (p.fontName) {
    // 글꼴 번호는 언어(한글·영어·한자·일어·기타·기호·사용자)마다 따로 매겨진다: 같은 번호를 7칸에 넣으면 칸마다 다른 글꼴이 된다.
    const ids = [0, 1, 2, 3, 4, 5, 6].map((lang) => doc.findOrCreateFontIdForLang(lang, String(p.fontName)));
    if (ids.every((id) => id >= 0)) p.fontIds = ids;
    delete p.fontName;
  }
  // 켠다고만 하면 선 모양이 "없음"(15)인 글자는 저장 때 선이 사라진다: 선 모양을 실선(0)으로 함께 지정한다.
  if (p.strikethrough === true && p.strikeShape === undefined) p.strikeShape = 0;
  if (p.underline === true) { if (p.underlineShape === undefined) p.underlineShape = 0; if (p.underlineType === undefined) p.underlineType = 'Bottom'; }
  return JSON.stringify(p);
}

/** 캐럿이 있는 줄의 {lineIndex,lineCount,charStart,charEnd}. 못 구하면 null. */
function lineInfo(doc, pos) {
  if (inHf(pos)) return null;
  try {
    const r = inCell(pos) && pos.path.length === 1
      ? J(doc.getLineInfoInCell(pos.s, pos.p, pos.path[0].controlIndex, pos.path[0].cellIndex, cellPara(pos), pos.o))
      : (!inCell(pos) ? J(doc.getLineInfo(pos.s, pos.p, pos.o)) : null);
    return r && r.charEnd >= r.charStart ? r : null;
  } catch { return null; }
}
/** 위치를 지금 문서 안으로 끌어온다(되돌리기 뒤 문단이 짧아졌거나 칸이 없어졌을 수 있다): 문단 번호·글자 위치를 범위 안으로, 칸이 없어졌으면 그 칸을 가진 문단으로. */
function clampPos(doc, pos) {
  if (!pos) return null;
  if (inHf(pos)) { try { const p = Math.max(0, Math.min(pos.p, paraCount(doc, pos) - 1)); return { ...pos, p, o: Math.min(pos.o, paraLen(doc, { ...pos, p })) }; } catch { return null; } }
  try {
    const n = doc.getParagraphCount(pos.s);
    if (pos.p >= n) return { s: pos.s, p: Math.max(0, n - 1), o: 0, path: null };
    if (pos.path) {
      try { return { ...pos, o: Math.min(pos.o, paraLen(doc, pos)) }; } catch { return { s: pos.s, p: pos.p, o: 0, path: null }; }
    }
    return { ...pos, o: Math.min(pos.o, doc.getParagraphLength(pos.s, pos.p)) };
  } catch { return { s: 0, p: 0, o: 0, path: null }; }
}
/** 문단 글. 칸 안이면 칸 문단. */
const paraText = (doc, pos) => { const n = paraLen(doc, pos); return n ? textOf(doc, { ...pos, o: 0 }, n) : ''; };
/** 단어 경계(공백과 글자의 경계)로 한 단어 이동. 문단 끝·처음에서는 이웃 문단으로. */
function wordMove(doc, pos, right) {
  const chars = [...paraText(doc, pos)];
  const isSp = (c) => /\s/.test(c);
  let o = pos.o;
  if (right) {
    if (o >= chars.length) { return paraNo(pos) + 1 < paraCount(doc, pos) ? { ...(inCell(pos) ? withCellPara(pos, cellPara(pos) + 1) : { ...pos, p: pos.p + 1 }), o: 0 } : pos; }
    while (o < chars.length && !isSp(chars[o])) o++;
    while (o < chars.length && isSp(chars[o])) o++;
  } else {
    if (o <= 0) { if (paraNo(pos) <= 0) return pos; const prev = inCell(pos) ? withCellPara(pos, cellPara(pos) - 1) : { ...pos, p: pos.p - 1 }; return { ...prev, o: paraLen(doc, { ...prev, o: 0 }) }; }
    o--;
    while (o > 0 && isSp(chars[o])) o--;
    while (o > 0 && !isSp(chars[o - 1])) o--;
  }
  return { ...pos, o };
}

// ── 되돌리기 ──
const CAP = 60;
const NOOP = Symbol('noop');
// 항목 {id, pos}: pos는 그 편집 직전의 캐럿 — 되돌리면 캐럿이 그 자리로 돌아온다.
function pushUndo(doc, st, pos) {
  const id = doc.saveSnapshot();
  st.undo.push({ id, pos });
  while (st.undo.length > CAP) { try { doc.discardSnapshot(st.undo.shift().id); } catch { /* 이미 없음 */ } }
  for (const r of st.redo) { try { doc.discardSnapshot(r.id); } catch { /* ignore */ } }
  st.redo = [];
}

/** 편집 뒤 화면 갱신에 필요한 정보: 쪽 수·크기(바뀔 때만), 변경 세대. */
function viewInfo(doc, st) {
  st.gen++;
  const n = doc.pageCount();
  const out = { pageCount: n, gen: st.gen, dirty: st.dirty };
  if (n !== st.pageCount) {
    st.pageCount = n;
    const sizes = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { const info = J(doc.getPageInfo(i)); sizes[i * 2] = info.width; sizes[i * 2 + 1] = info.height; }
    out.sizes = sizes;
  }
  return out;
}

/** [from,to) 글자에 글자 서식(JSON)을 입힌다. 각주 안은 엔진에 글자 서식 API가 없어 false. */
function applyChar(doc, at, from, to, json) {
  if (inHf(at)) { if (isFn(at)) return false; doc.applyCharFormatInHeaderFooter(at.s, isHd(at), at.hf.a, at.p, from, at.p, to, json); return true; }
  if (inCell(at)) doc.applyCharFormatInCellByPath(at.s, at.p, pj(at), from, to, json); else doc.applyCharFormat(at.s, at.p, from, to, json);
  return true;
}
function charProps(doc, pos) {
  if (inHf(pos)) { try { return isFn(pos) ? null : J(doc.getCharPropertiesInHeaderFooter(pos.s, isHd(pos), pos.hf.a, pos.p, pos.o)); } catch { return null; } }
  try { return J(inCell(pos) ? doc.getCellCharPropertiesAtByPath(pos.s, pos.p, pj(pos), pos.o) : doc.getCharPropertiesAt(pos.s, pos.p, pos.o)); } catch { return null; }
}
function paraProps(doc, pos) {
  if (inHf(pos)) { try { return isFn(pos) ? J(doc.getParaPropertiesInFootnote(pos.s, pos.hf.bp, pos.hf.c, pos.p)) : null; } catch { return null; } }
  try { return inCell(pos) ? (pos.path.length === 1 ? J(doc.getCellParaPropertiesAt(pos.s, pos.p, pos.path[0].controlIndex, pos.path[0].cellIndex, cellPara(pos))) : null) : J(doc.getParaPropertiesAt(pos.s, pos.p)); } catch { return null; }
}

// ── 문서 서명(저장 점검용): 문단 수·길이·앞 40자 ──
const SIG_CAP = 20000;
function signature(doc) {
  const out = [];
  for (let s = 0; s < doc.getSectionCount(); s++) {
    const n = doc.getParagraphCount(s);
    out.push(`S${n}`);
    for (let p = 0; p < Math.min(n, SIG_CAP); p++) {
      const l = doc.getParagraphLength(s, p);
      out.push(l, l ? doc.getTextRange(s, p, 0, Math.min(l, 40)) : '');
      // 표가 든 문단은 표의 줄·칸 수와 칸 수도 서명에 넣는다(칸 안 글이 아니라 구조 변화를 잡는다)
      let k = 0;
      try { k = J(doc.getControlTextPositions(s, p)).length; } catch { k = 0; }
      for (let c = 0; c < k; c++) { try { const d = J(doc.getTableDimensions(s, p, c)); out.push(`T${d.rowCount}x${d.colCount}/${d.cellCount}`); } catch { /* 표가 아닌 개체 */ } }
    }
  }
  return out;
}
function diffSignature(a, b) {
  let diffs = 0, first = -1;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) { diffs++; if (first < 0) first = i; }
  return { diffs, first };
}

/**
 * 메시지 처리. m.op:
 *   hit {page,x,y}, caret {pos}, move {pos,kind,px}, insert {pos,text,group}, del {pos,dir}, enter {pos}, delrange {a,b},
 *   fmt {a,b,props}, parafmt {a,b,props}, props {pos}, text {a,b}, paste {pos,text}, undo, redo, mark (undo 묶음 경계), save {format}
 */
export function run(doc, HwpDocument, m) {
  const st = state(doc);
  // fn이 NOOP을 돌려주면 문서가 바뀌지 않은 것이다: 방금 만든 되돌리기 항목을 버리고 변경 표시도 하지 않는다.
  const mutate = (fn, group) => {
    const pushed = !(group && st.groupOpen);
    if (pushed) pushUndo(doc, st, m.pos ?? m.a ?? null);
    st.groupOpen = !!group;
    let r;
    try { r = fn(); } catch (e) {
      // 엔진이 거부했거나 중간에 실패했다: 문서를 직전 상태로 되돌리고(방금 만든 스냅샷으로) 그 항목을 버린다
      if (pushed && st.undo.length) {
        const top = st.undo.pop();
        try { doc.restoreSnapshot(top.id); } catch { /* 복원 실패는 원래 오류를 우선 */ }
        try { doc.discardSnapshot(top.id); } catch { /* ignore */ }
        st.groupOpen = false;
      }
      throw e;
    }
    if (r === NOOP) {
      if (pushed) { const e = st.undo.pop(); try { doc.discardSnapshot(e.id); } catch { /* ignore */ } }
      return null;
    }
    st.dirty = true;
    return r;
  };
  switch (m.op) {
    case 'hit': {
      if (m.hf || m.enter) { const r = hfHit(doc, m); if (r) return r; if (m.enter) return { pos: null, rect: null }; }
      const h = J(doc.hitTest(m.page, m.x, m.y));
      // 양식 개체(선택 상자·라디오·입력·콤보·단추)를 누른 것인지
      if (m.objs) { try { const fo = J(doc.getFormObjectAt(m.page, m.x, m.y)); if (fo.found) return { form: fo }; } catch { /* 양식 아님 */ } }
      // 글상자 글 안이 아니면, 클릭한 자리의 그림·도형·수식을 먼저 고른다(개체 선택)
      if (m.objs && !(h && h.isTextBox)) { const obj = pickObject(doc, m.page, m.x, m.y); if (obj) return { obj }; }
      const pos = toPos(h);
      return { pos, rect: pos ? rectOf(doc, pos) : null };
    }
    case 'caret': { const pos = clampPos(doc, m.pos); return { rect: rectOf(doc, pos), pos }; }
    case 'wordat': {   // 두 번 클릭: 위치가 든 단어(또는 문단 전체: whole)의 범위
      const chars = [...paraText(doc, m.pos)];
      if (m.whole) return { a: { ...m.pos, o: 0 }, b: { ...m.pos, o: chars.length } };
      const isSp = (c) => /\s/.test(c);
      let a = Math.min(m.pos.o, chars.length), b = a;
      if (a < chars.length && isSp(chars[a]) && a > 0 && !isSp(chars[a - 1])) a--;
      while (a > 0 && !isSp(chars[a - 1])) a--;
      while (b < chars.length && !isSp(chars[b])) b++;
      return { a: { ...m.pos, o: a }, b: { ...m.pos, o: b } };
    }
    case 'props': return { char: charProps(doc, m.pos), para: paraProps(doc, m.pos), table: inHf(m.pos) ? null : tableAt({ doc, J }, m.pos) };
    case 'text': return { text: selectionText(doc, m.a, m.b) };
    case 'mark': st.groupOpen = false; return {};
    case 'endOf': {
      const p = doc.getParagraphCount(m.s) - 1;
      const pos = { s: m.s, p, o: doc.getParagraphLength(m.s, p), path: null };
      return { pos, rect: rectOf(doc, pos) };
    }
    case 'move': {
      let pos = m.pos;
      const k = m.kind;
      let px = -1;
      if (k === 'left') {
        if (pos.o > 0) pos = { ...pos, o: pos.o - 1 };
        else if (paraNo(pos) > 0) { const prev = inCell(pos) ? withCellPara(pos, cellPara(pos) - 1) : { ...pos, p: pos.p - 1 }; pos = { ...prev, o: paraLen(doc, { ...prev, o: 0 }) }; }
      } else if (k === 'right') {
        if (pos.o < paraLen(doc, pos)) pos = { ...pos, o: pos.o + 1 };
        else if (paraNo(pos) + 1 < paraCount(doc, pos)) pos = { ...(inCell(pos) ? withCellPara(pos, cellPara(pos) + 1) : { ...pos, p: pos.p + 1 }), o: 0 };
      } else if (k === 'home' || k === 'end') {
        // 줄 처음·끝(줄 정보를 못 구하면 문단 처음·끝)
        const L = lineInfo(doc, pos);
        if (k === 'home') pos = { ...pos, o: L ? L.charStart : 0 };
        else pos = { ...pos, o: L ? (L.lineIndex < L.lineCount - 1 ? Math.max(L.charStart, L.charEnd - 1) : L.charEnd) : paraLen(doc, pos) };
      } else if (k === 'docstart') pos = inHf(pos) ? { ...pos, p: 0, o: 0 } : { s: pos.s, p: 0, o: 0, path: null };
      else if (k === 'docend' && inHf(pos)) { const p = paraCount(doc, pos) - 1; pos = { ...pos, p, o: paraLen(doc, { ...pos, p }) }; }
      else if (k === 'docend') { const n = doc.getParagraphCount(pos.s) - 1; pos = { s: pos.s, p: n, o: doc.getParagraphLength(pos.s, n), path: null }; }
      else if (k === 'wordleft' || k === 'wordright') pos = wordMove(doc, pos, k === 'wordright');
      else if ((k === 'up' || k === 'down') && inHf(pos)) {   // 줄 위·아래: 캐럿 위·아래 한 줄 자리를 눌러 본다
        const rc = rectOf(doc, pos);
        if (rc) { const h = hfHit(doc, { page: rc.page, x: m.px >= 0 ? m.px : rc.x, y: rc.y + (k === 'up' ? -rc.h * 0.5 : rc.h * 1.5) }); if (h?.pos && hfKey(h.pos) === hfKey(pos) && (h.pos.p !== pos.p || h.pos.o !== pos.o)) { pos = { ...h.pos, hf: { ...pos.hf, pg: rc.page } }; px = rc.x; } }
      } else if (k === 'up' || k === 'down') {
        const delta = k === 'up' ? -1 : 1;
        const r = J(inCell(pos)
          ? doc.moveVerticalByPath(pos.s, pos.p, pj(pos), pos.o, delta, m.px ?? -1)
          : doc.moveVerticalEx(JSON.stringify({ sectionIdx: pos.s, paraIdx: pos.p, charOffset: pos.o, delta, preferredX: m.px ?? -1 })));
        const np = toPos(r);
        if (np) { pos = np; px = r.preferredX ?? -1; }
      }
      return { pos, rect: rectOf(doc, pos), px };
    }
    case 'insert': {
      // replace: 앞쪽의 이 개수만큼 먼저 지운다(한글 조합 중 글자 바꿔 넣기), fmt: 넣은 글자에 서식을 입힌다(서식 단추를 먼저 누른 경우)
      const r = mutate(() => {
        let at = m.pos;
        if (m.replace > 0) at = opDeleteChars(doc, at, m.replace);
        const end = m.text ? opInsert(doc, at, m.text) : at;
        if (m.fmt && end.o > at.o) {
          const json = charJson(doc, m.fmt);
          applyChar(doc, at, at.o, end.o, json);
        }
        return end;
      }, m.group);
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'selrects': {
      if (!sameContainer(m.a, m.b)) return { rects: [] };
      const [a, b] = ordered(m.a, m.b);
      const raw = J(inHf(a)
        ? (isFn(a) ? (() => { const f = fnLoc(doc, a); return f ? doc.getSelectionRectsInFootnote(f.pg, f.fi, a.p, a.o, b.p, b.o) : '[]'; })() : doc.getSelectionRectsInHeaderFooter(a.s, isHd(a), a.hf.a, a.hf.pg, a.p, a.o, b.p, b.o))
        : inCell(a)
        ? doc.getSelectionRectsInCellByPath(a.s, a.p, pj(a), cellPara(a), a.o, cellPara(b), b.o)
        : doc.getSelectionRects(a.s, a.p, a.o, b.p, b.o));
      return { rects: (Array.isArray(raw) ? raw : raw.rects ?? []).map((r) => ({ page: r.pageIndex, x: r.x, y: r.y, w: r.width, h: r.height })) };
    }
    case 'enter': {
      const r = mutate(() => opSplit(doc, m.pos), false);
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'del': {
      let pos = m.pos;
      const r = mutate(() => {
        if (m.dir === 'back') {
          if (pos.o > 0) { pos = { ...pos, o: pos.o - 1 }; return opDeleteChars(doc, pos, 1); }
          if (paraNo(pos) > 0) return opMergeBack(doc, pos) ?? NOOP;
          return NOOP;
        }
        if (pos.o < paraLen(doc, pos)) return opDeleteChars(doc, pos, 1);
        if (paraNo(pos) + 1 < paraCount(doc, pos)) return opMergeBack(doc, inCell(pos) ? withCellPara(pos, cellPara(pos) + 1) : { ...pos, p: pos.p + 1 }) ? pos : NOOP;
        return NOOP;
      }, m.group);
      if (!r) return { pos: m.pos, rect: rectOf(doc, m.pos), ...viewInfo(doc, st) };
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'delrange': {
      if (!sameContainer(m.a, m.b)) return { pos: m.a, rect: rectOf(doc, m.a), ...viewInfo(doc, st), skipped: true };
      const [s, e] = ordered(m.a, m.b);
      const r = mutate(() => opDeleteRange(doc, s, e), false);
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'paste': {
      // 줄바꿈이 있는 글은 문단을 나눠 넣는다
      const lines = String(m.text).replace(/\r\n?/g, '\n').split('\n');
      const r = mutate(() => {
        let pos = m.pos;
        lines.forEach((ln, i) => { if (i > 0) pos = opSplit(doc, pos); if (ln) pos = opInsert(doc, pos, ln); });
        return pos;
      }, false);
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'fmt': {
      if (!sameContainer(m.a, m.b)) return { skipped: true, ...viewInfo(doc, st) };
      let json, unsupported = false;
      mutate(() => { json = charJson(doc, m.props); eachParaRange(doc, m.a, m.b, (at, from, to) => {
        if (to <= from) return;
        if (!applyChar(doc, at, from, to, json)) unsupported = true;
      }); if (unsupported) return NOOP; }, false);
      return { ...viewInfo(doc, st), unsupported };
    }
    case 'parafmt': {
      const json = JSON.stringify(m.props);
      mutate(() => eachParaRange(doc, m.a, m.b, (at) => {
        if (inHf(at)) { if (isFn(at)) doc.applyParaFormatInFootnote(at.s, at.hf.bp, at.hf.c, at.p, json); else doc.applyParaFormatInHf(at.s, at.hf.k === 'h', at.hf.a, at.p, json); }
        else if (inCell(at)) { if (at.path.length === 1) doc.applyParaFormatInCell(at.s, at.p, at.path[0].controlIndex, at.path[0].cellIndex, cellPara(at), json); } else doc.applyParaFormat(at.s, at.p, json);
      }), false);
      return { ...viewInfo(doc, st) };
    }
    case 'undo': case 'redo': {
      const from = m.op === 'undo' ? st.undo : st.redo, to = m.op === 'undo' ? st.redo : st.undo;
      if (!from.length) return { empty: true, ...viewInfo(doc, st) };
      const cur = doc.saveSnapshot();
      const ent = from.pop();
      doc.restoreSnapshot(ent.id);
      try { doc.discardSnapshot(ent.id); } catch { /* ignore */ }
      to.push({ id: cur, pos: m.pos ?? null });   // 반대쪽에는 "지금의 캐럿"을 남긴다
      st.groupOpen = false; st.dirty = true;
      return { ...viewInfo(doc, st), pos: clampPos(doc, ent.pos), canUndo: st.undo.length > 0, canRedo: st.redo.length > 0 };
    }
    case 'fonts': { try { return { fonts: J(doc.getDocumentInfo()).fontsUsed ?? [] }; } catch { return { fonts: [] }; } }
    case 'view': {   // 보기 옵션: marks 문단 부호, codes 조판 부호, transparent 투명 선
      const f = { marks: ['setShowParagraphMarks', 'getShowParagraphMarks'], codes: ['setShowControlCodes', 'getShowControlCodes'], transparent: ['setShowTransparentBorders', 'getShowTransparentBorders'] }[m.mode];
      if (!f) throw { code: 'unknown', message: `view mode ${m.mode}` };
      doc[f[0]](!!m.on);
      return { ...viewInfo(doc, st), on: !!doc[f[1]]() };
    }
    case 'marks': { doc.setShowParagraphMarks(!!m.on); return { ...viewInfo(doc, st), on: !!doc.getShowParagraphMarks() }; }   // 보기 옵션: 문서를 바꾸지 않는다
    case 'status': return { canUndo: st.undo.length > 0, canRedo: st.redo.length > 0, dirty: st.dirty };
    case 'clean': st.dirty = false; return {};
    case 'save': {
      const t0 = performance.now();
      const fmt = m.format;
      if (fmt === 'txt') {   // 글만 내보내기
        const txt = J(doc.getTextFileUnicode());
        const bytes = new TextEncoder().encode(typeof txt === 'string' ? txt : String(txt));
        return { bytes, verify: { checked: false, text: true }, exportMs: Math.round(performance.now() - t0), totalMs: Math.round(performance.now() - t0) };
      }
      const hwpx = fmt === 'hwpx';
      const before = signature(doc);
      const bytes = m.password ? (hwpx ? doc.exportHwpxWithPassword(m.password) : doc.exportHwpWithPassword(m.password)) : (hwpx ? doc.exportHwpx() : doc.exportHwp());
      const tExport = performance.now() - t0;
      // 저장한 바이트를 같은 엔진으로 다시 열어 본문(문단 수·길이·앞 글자)이 같은지 점검한다. rhwp의 손실 보고서는 믿을 수 없다(docs/phase4/design.md 2.1).
      // 암호를 건 저장본은 같은 암호로 다시 열어 본다.
      let verify = { checked: false };
      try {
        const re = m.password ? HwpDocument.openWithPassword(new Uint8Array(bytes), m.password) : new HwpDocument(new Uint8Array(bytes));
        try {
          const after = signature(re);
          const d = diffSignature(before, after);
          verify = { checked: true, ok: d.diffs === 0, diffs: d.diffs, pagesBefore: doc.pageCount(), pagesAfter: re.pageCount() };
        } finally { re.free(); }
      } catch (e) { verify = { checked: true, ok: false, reopenError: String(e && e.message || e).slice(0, 120) }; }
      return { bytes: bytes.buffer ? bytes : new Uint8Array(bytes), verify, exportMs: Math.round(tExport), totalMs: Math.round(performance.now() - t0) };
    }
    default: return ext({ doc, HwpDocument, st, J, mutate, viewInfo, rectOf, inCell, pj, cellPara, paraNo, paraLen, withCellPara, charJson, NOOP, opInsert, opDeleteRange, ordered, sameContainer }, m);
  }
}
