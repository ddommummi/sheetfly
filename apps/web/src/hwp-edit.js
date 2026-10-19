// HWP/HWPX 편집 계층(Worker 쪽). 편집을 시작할 때만 불러온다(worker.js가 동적으로 import) — 열기만 하는 사용자는 이 파일을 받지 않는다.
// 문서(HwpDocument)는 worker.js가 갖고 있고, 여기서는 그 위에서 입력·삭제·서식·되돌리기·저장을 rhwp의 편집 API로 수행한다.
// 위치(pos): { s: 구역, p: 본문 문단(칸 안이면 그 칸을 가진 문단), o: 문단 안 글자 위치, path: null | [{controlIndex, cellIndex, cellParaIndex}…] }
//   · 글자 위치·개수는 UTF-16이 아니라 유니코드 글자(code point) 단위다(rhwp 계약) — 이모지 등을 위해 [...s].length로 센다.
//   · 표 칸 안이면 path의 마지막 항목의 cellParaIndex가 칸 안 문단 번호다.
const states = new WeakMap();
const J = JSON.parse;
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
const cellPara = (pos) => pos.path[pos.path.length - 1].cellParaIndex;
const withCellPara = (pos, cp) => ({ ...pos, path: pos.path.map((x, i) => (i === pos.path.length - 1 ? { ...x, cellParaIndex: cp } : x)) });
const pj = (pos) => JSON.stringify(pos.path);
/** 칸 안 위치의 "문단 번호"(정렬·비교용). */
const paraNo = (pos) => (inCell(pos) ? cellPara(pos) : pos.p);
const sameContainer = (a, b) => a.s === b.s && (inCell(a) === inCell(b)) && (!inCell(a) || (a.p === b.p && a.path.length === b.path.length && a.path.every((x, i) => i === a.path.length - 1 || (x.controlIndex === b.path[i].controlIndex && x.cellIndex === b.path[i].cellIndex))));
const cmp = (a, b) => (paraNo(a) - paraNo(b)) || (a.o - b.o);

// ── 문단 정보 ──
function paraLen(doc, pos) { return inCell(pos) ? doc.getCellParagraphLengthByPath(pos.s, pos.p, pj(pos)) : doc.getParagraphLength(pos.s, pos.p); }
function paraCount(doc, pos) { return inCell(pos) ? doc.getCellParagraphCountByPath(pos.s, pos.p, pj(pos)) : doc.getParagraphCount(pos.s); }
/** 캐럿 좌표. 개체만 있는 문단 등 좌표를 구할 수 없는 자리면 null(편집 자체는 이미 적용된 상태이므로 예외로 만들지 않는다). */
function rectOf(doc, pos) {
  try {
    const r = J(inCell(pos) ? doc.getCursorRectByPath(pos.s, pos.p, pj(pos), pos.o) : doc.getCursorRect(pos.s, pos.p, pos.o));
    return { page: r.pageIndex, x: r.x, y: r.y, h: r.height };
  } catch { return null; }
}
function textOf(doc, pos, count) { return inCell(pos) ? doc.getTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, count) : doc.getTextRange(pos.s, pos.p, pos.o, count); }

// ── 변경 기본 동작 (모두 새 위치를 돌려준다) ──
function opInsert(doc, pos, text) {
  const r = J(inCell(pos) ? doc.insertTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, text) : doc.insertText(pos.s, pos.p, pos.o, text));
  return { ...pos, o: r.charOffset ?? pos.o + len(text) };
}
function opDeleteChars(doc, pos, count) {
  if (inCell(pos)) doc.deleteTextInCellByPath(pos.s, pos.p, pj(pos), pos.o, count); else doc.deleteText(pos.s, pos.p, pos.o, count);
  return pos;
}
// splitParagraph는 다른 편집 API와 달리 "논리 오프셋"(글자 + 글자처럼 놓인 개체 하나를 1로 센다)을 받는다. 문단 앞이나 중간에 표·그림 같은
// 개체가 있으면 글자 오프셋 그대로 넘길 때 개체 수만큼 앞에서 잘린다. 그래서 나눈 뒤 앞 문단의 글자 수가 기대와 같은지 보고, 아니면 되돌려 한 칸씩 늘려 다시 해 본다.
function rawSplit(doc, pos, off) {
  return J(inCell(pos) ? doc.splitParagraphInCellByPath(pos.s, pos.p, pj(pos), off) : doc.splitParagraph(pos.s, pos.p, off));
}
function opSplit(doc, pos) {
  const inCellP = inCell(pos);
  const ctrls = inCellP ? 4 : (() => { try { return J(doc.getControlTextPositions(pos.s, pos.p)).length; } catch { return 0; } })();
  let r;
  if (!ctrls) r = rawSplit(doc, pos, pos.o);
  else {
    const snap = doc.saveSnapshot();
    try {
      for (let k = 0; k <= ctrls + 1; k++) {
        r = rawSplit(doc, pos, pos.o + k);
        if (paraLen(doc, pos) === pos.o) break;
        doc.restoreSnapshot(snap); r = null;
      }
      if (!r) throw { code: 'split_failed', message: 'split offset not found' };
    } finally { try { doc.discardSnapshot(snap); } catch { /* ignore */ } }
  }
  return inCellP ? { ...withCellPara(pos, cellPara(pos) + 1), o: 0 } : { ...pos, p: r.paraIdx ?? pos.p + 1, o: 0 };
}
/** pos의 문단을 앞 문단에 합친다(Backspace at start). 합친 지점이 새 위치. 합쳐지지 않으면(표가 든 문단 등) null. */
function opMergeBack(doc, pos) {
  const prev = inCell(pos) ? withCellPara(pos, cellPara(pos) - 1) : { ...pos, p: pos.p - 1 };
  const at = paraLen(doc, { ...prev, o: 0 }), before = paraCount(doc, pos);
  if (inCell(pos)) doc.mergeParagraphInCellByPath(pos.s, pos.p, pj(pos)); else doc.mergeParagraph(pos.s, pos.p);
  if (paraCount(doc, pos) >= before) return null;
  return { ...prev, o: at };
}
function opDeleteRange(doc, a, b) {
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

function charProps(doc, pos) {
  try { return J(inCell(pos) ? doc.getCellCharPropertiesAtByPath(pos.s, pos.p, pj(pos), pos.o) : doc.getCharPropertiesAt(pos.s, pos.p, pos.o)); } catch { return null; }
}
function paraProps(doc, pos) {
  try { return inCell(pos) ? (pos.path.length === 1 ? J(doc.getCellParaPropertiesAt(pos.s, pos.p, pos.path[0].controlIndex, pos.path[0].cellIndex, cellPara(pos))) : null) : J(doc.getParaPropertiesAt(pos.s, pos.p)); } catch { return null; }
}

// ── 문서 서명(저장 점검용): 문단 수·길이·앞 40자 ──
const SIG_CAP = 20000;
function signature(doc) {
  const out = [];
  for (let s = 0; s < doc.getSectionCount(); s++) {
    const n = doc.getParagraphCount(s);
    out.push(`S${n}`);
    for (let p = 0; p < Math.min(n, SIG_CAP); p++) { const l = doc.getParagraphLength(s, p); out.push(l, l ? doc.getTextRange(s, p, 0, Math.min(l, 40)) : ''); }
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
    const r = fn();
    if (r === NOOP) {
      if (pushed) { const e = st.undo.pop(); try { doc.discardSnapshot(e.id); } catch { /* ignore */ } }
      return null;
    }
    st.dirty = true;
    return r;
  };
  switch (m.op) {
    case 'hit': {
      const h = J(doc.hitTest(m.page, m.x, m.y));
      const pos = toPos(h);
      return { pos, rect: pos ? rectOf(doc, pos) : null };
    }
    case 'caret': return { rect: rectOf(doc, m.pos) };
    case 'props': return { char: charProps(doc, m.pos), para: paraProps(doc, m.pos) };
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
      } else if (k === 'home') pos = { ...pos, o: 0 };
      else if (k === 'end') pos = { ...pos, o: paraLen(doc, pos) };
      else if (k === 'up' || k === 'down') {
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
          const json = JSON.stringify(m.fmt);
          if (inCell(at)) doc.applyCharFormatInCellByPath(at.s, at.p, pj(at), at.o, end.o, json); else doc.applyCharFormat(at.s, at.p, at.o, end.o, json);
        }
        return end;
      }, m.group);
      return { pos: r, rect: rectOf(doc, r), ...viewInfo(doc, st) };
    }
    case 'selrects': {
      if (!sameContainer(m.a, m.b)) return { rects: [] };
      const [a, b] = ordered(m.a, m.b);
      const raw = J(inCell(a)
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
      const json = JSON.stringify(m.props);
      mutate(() => eachParaRange(doc, m.a, m.b, (at, from, to) => {
        if (to <= from) return;
        if (inCell(at)) doc.applyCharFormatInCellByPath(at.s, at.p, pj(at), from, to, json); else doc.applyCharFormat(at.s, at.p, from, to, json);
      }), false);
      return { ...viewInfo(doc, st) };
    }
    case 'parafmt': {
      const json = JSON.stringify(m.props);
      mutate(() => eachParaRange(doc, m.a, m.b, (at) => {
        if (inCell(at)) { if (at.path.length === 1) doc.applyParaFormatInCell(at.s, at.p, at.path[0].controlIndex, at.path[0].cellIndex, cellPara(at), json); } else doc.applyParaFormat(at.s, at.p, json);
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
      return { ...viewInfo(doc, st), pos: ent.pos, canUndo: st.undo.length > 0, canRedo: st.redo.length > 0 };
    }
    case 'status': return { canUndo: st.undo.length > 0, canRedo: st.redo.length > 0, dirty: st.dirty };
    case 'clean': st.dirty = false; return {};
    case 'save': {
      const t0 = performance.now();
      const hwpx = m.format === 'hwpx';
      const before = signature(doc);
      const bytes = hwpx ? doc.exportHwpx() : doc.exportHwp();
      const tExport = performance.now() - t0;
      // 저장한 바이트를 같은 엔진으로 다시 열어 본문(문단 수·길이·앞 글자)이 같은지 점검한다. rhwp의 손실 보고서는 믿을 수 없다(docs/phase4/design.md 2.1).
      let verify = { checked: false };
      try {
        const re = new HwpDocument(new Uint8Array(bytes));
        try {
          const after = signature(re);
          const d = diffSignature(before, after);
          verify = { checked: true, ok: d.diffs === 0, diffs: d.diffs, pagesBefore: doc.pageCount(), pagesAfter: re.pageCount() };
        } finally { re.free(); }
      } catch (e) { verify = { checked: true, ok: false, reopenError: String(e && e.message || e).slice(0, 120) }; }
      return { bytes: bytes.buffer ? bytes : new Uint8Array(bytes), verify, exportMs: Math.round(tExport), totalMs: Math.round(performance.now() - t0) };
    }
    default: throw { code: 'unknown', message: `unknown edit op ${m.op}` };
  }
}
