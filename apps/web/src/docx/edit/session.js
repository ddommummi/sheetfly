// DOCX 편집 세션(4-2-2): 편집 모델(문서 XML) + IR 거울(조판의 입력) + 조판(줄 기록 포함) + 질의(캐럿·히트 테스트·선택)를 한데 묶는다.
// 글 넣기·지우기·나누기·합치기·되돌리기는 모델에서 하고, 같은 편집을 IR 문단에 되풀이한 다음 바뀐 요소가 든 쪽만 다시 조판한다.
// 거울로 따라 하지 못하는 편집(목록 문단 나누기 등)은 저장본을 다시 읽어 IR을 맞춘다("조정").
import { DocxEditModel, EditError } from './model.js';
import { Geometry, wordStep, wordRange } from './geom.js';
import { cpLen, cpSlice } from './xml.js';

// ── IR 문단 글 조각(span) 연산 ────────────────────────────────────────
const spanLen = (s) => (s.type === 'text' ? cpLen(s.text) : s.type === 'line_break' ? 1 : 0);
/** IR 문단의 글(편집 모델이 보는 글과 같다: 줄바꿈은 \n). */
export const spansText = (content) => (content ?? []).map((c) => (c.type === 'text' ? c.text : c.type === 'line_break' ? '\n' : '')).join('');

/** o 위치에서 둘로 가른다([앞 조각들, 뒤 조각들]). 글 조각이 위치에 걸치면 둘로 쪼갠다. */
export function splitSpans(content, o) {
  const before = [], after = [];
  let at = 0;
  for (const s of content ?? []) {
    const n = spanLen(s);
    if (n === 0) (at < o ? before : after).push(s);
    else if (at + n <= o) before.push(s);
    else if (at >= o) after.push(s);
    else { const t = cpSlice(s.text, 0, o - at), u = cpSlice(s.text, o - at); if (t) before.push({ ...s, text: t }); after.push({ ...s, text: u }); }
    at += n;
  }
  return [before, after];
}
/** 글 넣기: 앞 글자가 든 글 조각에 잇는다(XML 쪽 규칙과 같다: 위치 앞 글자의 서식을 잇고, 문단 맨 앞이면 첫 글 조각). */
export function insertSpans(content, o, str) {
  const out = (content ?? []).map((s) => s);
  let at = 0, target = -1, first = -1;
  out.forEach((s, i) => {
    const n = spanLen(s), real = s.type === 'text' && s.text !== '\t';
    if (real && first < 0 && at === o) first = i;
    if (real && target < 0 && at < o && o <= at + n) target = i;
    at += n;
  });
  if (target >= 0) { const s = out[target], k = o - spanStart(out, target); out[target] = { ...s, text: cpSlice(s.text, 0, k) + str + cpSlice(s.text, k) }; return out; }
  if (first >= 0) { out[first] = { ...out[first], text: str + out[first].text }; return out; }
  // 글 조각이 없거나 앞뒤가 줄바꿈·탭뿐: 가까운 글 조각의 서식으로 새 조각
  const near = out.find((s) => s.type === 'text' && s.text !== '\t');
  const { text: _t, ...fmt } = near ?? { type: 'text' };
  let idx = 0, pos = 0;
  while (idx < out.length && pos + spanLen(out[idx]) <= o) { pos += spanLen(out[idx]); idx++; }
  out.splice(idx, 0, { ...fmt, type: 'text', text: str });
  return out;
}
const spanStart = (arr, i) => { let at = 0; for (let k = 0; k < i; k++) at += spanLen(arr[k]); return at; };
/** 범위 지우기 [a, b): 비게 된 글 조각은 없앤다. */
export function deleteSpans(content, a, b) {
  const [pre, rest] = splitSpans(content, a);
  const [, post] = splitSpans(rest, b - a);
  return [...pre, ...post].filter((s) => s.type !== 'text' || s.text !== '');
}

// ── 서식: 편집기 속성 ↔ IR ─────────────────────────────────────────────
const rgb = (h) => { const m = /^#?([0-9a-f]{6})$/i.exec(h ?? ''); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : null; };
/** 글자 서식 props(편집기 모양) → IR 글 조각에 덮어쓸 값(undefined면 그 속성을 지운다). */
function irChar(props) {
  const o = {};
  if ('bold' in props) o.bold = !!props.bold;       // 끄기도 명시한다(제목 스타일이 굵게를 주는 글에서 끌 수 있도록 false를 남긴다)
  if ('italic' in props) o.italic = !!props.italic;
  if ('strikethrough' in props) o.strikethrough = props.strikethrough ? true : undefined;
  if ('underline' in props) o.underline = props.underline ? 'single' : undefined;
  if ('fontSize' in props) { o.font_size_half_pt = Math.max(2, Math.min(1638, Math.round(props.fontSize))); o._sz = true; }
  if ('color' in props) o.color = rgb(props.color) ?? undefined;
  if ('fontName' in props && props.fontName) { o.font_name = props.fontName; o._font = true; }
  if ('highlight' in props) o.highlight = rgb(props.highlight) ?? undefined;
  return o;
}
/** [from, to) 글에 서식을 입힌 새 글 조각 목록(글 조각을 위치에서 쪼갠다). */
export function formatSpans(content, from, to, props) {
  const patch = irChar(props), [pre, rest] = splitSpans(content, from), [mid, post] = splitSpans(rest, to - from);
  const out = mid.map((sp) => {
    if (sp.type !== 'text') return sp;
    const n = { ...sp, ...patch };
    for (const k of Object.keys(patch)) if (n[k] === undefined) delete n[k];
    return n;
  });
  return [...pre, ...out, ...post];
}
const PARA_KEYS = ['alignment', 'indent_left_twips', 'indent_right_twips', 'first_line_indent_twips', 'space_before_twips', 'space_after_twips', 'line_spacing'];
const paraSnap = (node) => PARA_KEYS.map((k) => node[k]);
const paraRestore = (node, snap) => { PARA_KEYS.forEach((k, i) => { if (snap[i] === undefined) delete node[k]; else node[k] = snap[i]; }); node.ver = (node.ver ?? 0) + 1; };
/** 문단 서식 props(편집기 모양) → IR 문단에 덮어쓸 값. */
function irPara(props) {
  const o = {};
  if ('alignment' in props) o.alignment = props.alignment;
  if ('indentLeft' in props) o.indent_left_twips = Math.max(0, Math.round(props.indentLeft));
  if ('firstLine' in props) o.first_line_indent_twips = Math.round(props.firstLine);
  if ('spaceBefore' in props) o.space_before_twips = Math.max(0, Math.round(props.spaceBefore));
  if ('spaceAfter' in props) o.space_after_twips = Math.max(0, Math.round(props.spaceAfter));
  if ('lineSpacing' in props) o.line_spacing = { auto: Math.round(Math.max(24, Math.min(5760, props.lineSpacing * 2.4))) };
  return o;
}

const KIDS = ['content', 'rows', 'cells', 'items', 'nested'];

export class DocxEditSession {
  /**
   * @param {Uint8Array} bytes .docx
   * @param {{ir:object, heading_runs?:object}} full office_oxide IR
   * @param measure 글자 폭 측정기
   * @param {{layoutDocument: Function, readIr?: (bytes: Uint8Array) => Promise<object>}} opts layoutDocument: 조판 함수(읽기 화면과 코드를 나눠 쓰려고 받는다 — 편집 묶음에 조판 엔진을 또 넣지 않는다), readIr: 저장본의 IR을 다시 읽는 함수(조정에 쓴다)
   */
  static async open(bytes, full, measure, opts = {}) {
    const model = await DocxEditModel.open(bytes, full);
    const s = new DocxEditSession(model, full, measure, opts);
    s.#attachIr(full);
    s.#layoutAll();
    return s;
  }
  constructor(model, full, measure, opts) {
    if (typeof opts.layoutDocument !== 'function') throw new EditError('internal', 'layoutDocument required');
    this.model = model; this.full = full; this.ir = full.ir; this.measure = measure; this.readIr = opts.readIr ?? null; this.layoutDocument = opts.layoutDocument;
    this.groupOpen = false;     // 직전 입력이 되돌리기 묶음에 이어 붙을 수 있는가(연속 타자·한글 조합)
    this.nodes = new Map();     // 문단 id → { node, parent, kind }
    this.tops = new Map();      // IR 문단 노드 → 그것이 든 최상위 요소
    this.snaps = new WeakMap(); // 문단 조각(pv) → 그 조각이었을 때의 IR 문단 { node, content, parent, kind }: 되돌리기·다시 하기가 서식까지 그대로 복원한다
    this.stats = { relayout: 0, full: 0, reconcile: 0 };
    this.bundleSeq = 0;
    this.geo = new Geometry(() => this.lay.pages, measure);
  }

  // ── IR과 모델 잇기 ──────────────────────────────────────────────────
  #attachIr(full) {
    this.full = full; this.ir = full.ir;
    this.nodes.clear(); this.tops.clear();
    const m = this.model;
    m.paras.forEach((pv) => {
      if (pv.block < 0) return;
      const b = m.blocks[pv.block];
      if (!b || !b.node) return;
      b.node.pid = pv.id;
      this.nodes.set(pv.id, { node: b.node, parent: b.parent, kind: b.kind });
    });
    this.#ghosts();
    for (const sec of this.ir.sections ?? []) for (const el of sec.elements ?? []) this.#walk(el, el);
  }
  #walk(n, top) {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { for (const x of n) this.#walk(x, top); return; }
    if ((n.type === 'paragraph' || n.type === 'heading') && !this.tops.has(n)) this.tops.set(n, top);
    for (const k of KIDS) if (n[k]) this.#walk(n[k], top);
  }
  /** 빈 문단 중 글을 넣을 수 있는 것(IR에는 없다)을 편집 중에만 IR에 빈 문단으로 둔다: 그래야 줄이 생겨 캐럿을 놓을 수 있다. */
  #ghosts() {
    const m = this.model, items = m.items, at = new Map();
    items.forEach((it, i) => { if (typeof it !== 'string') at.set(it, i); });
    const boundary = new RegExp(`<\\/?(?:[\\w.-]+:)?(?:tc|tr|tbl|tcPr|sdt|sdtContent|txbxContent|AlternateContent|Choice|Fallback|hyperlink|ins|del)(?=[\\s>\\/])`);
    const lastAfter = new Map();
    m.paras.forEach((pv, p) => {
      if (!pv.ghost || this.nodes.has(pv.id)) return;
      const anchor = pv.ghostAnchor;
      const ent = anchor >= 0 ? this.nodes.get(m.paras[anchor].id) : null;
      if (anchor >= 0 && (!ent || (ent.kind !== 'paragraph' && ent.kind !== 'heading'))) return;
      // 닻과 이 문단 사이(또는 문서 시작과 이 문단 사이)에 표·칸·묶음 경계가 있으면 어느 부모에 넣을지 알 수 없다
      const from = anchor >= 0 ? at.get(m.paras[anchor]) : 0, to = at.get(pv);
      if (from === undefined || to === undefined) return;
      for (let i = from + 1; i < to; i++) { const s = items[i]; if (typeof s === 'string' && boundary.test(s)) return; }
      if (anchor < 0 && boundary.test(items[0])) return;
      const node = { type: 'paragraph', content: [], pid: pv.id };
      let parent, idx;
      const prevGhost = lastAfter.get(anchor);
      if (anchor >= 0) { parent = ent.parent; idx = parent.indexOf(prevGhost ?? ent.node); if (idx < 0) return; idx++; }
      else { parent = this.ir.sections?.[0]?.elements; if (!parent) return; idx = prevGhost ? parent.indexOf(prevGhost) + 1 : 0; }
      parent.splice(idx, 0, node);
      lastAfter.set(anchor, node);
      this.nodes.set(pv.id, { node, parent, kind: 'paragraph', ghost: true });
    });
  }
  #layoutAll() {
    this.lay = this.layoutDocument(this.ir, this.measure, { track: true, headingRuns: this.full.heading_runs ?? {} });
    this.geo.invalidate();
    this.stats.full++;
  }
  sizes() { const a = new Float32Array(this.lay.pages.length * 2); this.lay.pages.forEach((p, i) => { a[i * 2] = p.width; a[i * 2 + 1] = p.height; }); return a; }
  get pages() { return this.lay.pages; }
  get pageCount() { return this.lay.pages.length; }

  // ── 모델 편집을 IR 거울에 되풀이 ─────────────────────────────────────
  /** model.last(방금 한 쪼개기·합치기·글 바꾸기)를 IR에 옮긴다. { top: 바뀐 최상위 요소 }를 돌려주고, 못 하면 null. */
  #mirror(strict = false) {
    const rec = this.model.last;
    if (!rec) return null;
    const { removed, added, hint } = rec;
    const ents = removed.map((pv) => this.nodes.get(pv.id));
    if (ents.some((e) => !e || (e.kind !== 'paragraph' && e.kind !== 'heading'))) return null;
    const textOf = (pv) => pv.text ?? pv.all;
    const o = hint?.o ?? 0;
    const A = ents[0];
    // 없어지는 조각마다 지금 IR 상태를 기억해 둔다(되돌리기·다시 하기 때 그대로 되돌리려고)
    removed.forEach((pv, i) => this.snaps.set(pv, { node: ents[i].node, content: ents[i].node.content, para: paraSnap(ents[i].node), parent: ents[i].parent, kind: ents[i].kind }));
    if (added.every((pv) => this.snaps.has(pv))) return this.#restore(rec, ents);
    if (strict) return null;   // 서식 기록을 되돌리는데 그때의 IR 기억이 없다(저장본을 다시 읽은 뒤): 글 차이로는 서식을 되돌릴 수 없으니 다시 읽어 맞춘다
    if (rec.fmt && removed.length === 1 && added.length === 1) return this.#mirrorFmt(rec.fmt, A.node);
    if (removed.length === 1 && added.length === 1) {
      const node = A.node, old = spansText(node.content), neu = textOf(added[0]);
      const dl = cpLen(neu) - cpLen(old);
      if (dl > 0) node.content = insertSpans(node.content, o, cpSlice(neu, o, o + dl));
      else if (dl < 0) node.content = deleteSpans(node.content, o, o - dl);
      if (spansText(node.content) !== neu) throw new EditError('internal', 'mirror text differs');
      this.#rekey(removed[0], added[0], A);
      return { top: this.tops.get(node) ?? null };
    }
    if (removed.length === 1 && added.length >= 2) {   // 나누기, 그리고 여러 문단에 걸친 지우기를 되돌린 것
      const node = A.node, idx = A.parent.indexOf(node);
      if (idx < 0) return null;
      const parts = [];
      let rest = node.content;
      for (let i = 0; i < added.length - 1; i++) { const [pre, post] = splitSpans(rest, cpLen(textOf(added[i]))); parts.push(pre); rest = post; }
      parts.push(rest);
      if (parts.some((c, i) => spansText(c) !== textOf(added[i]))) throw new EditError('internal', 'mirror split differs');
      const top = this.tops.get(node) ?? null;
      node.content = parts[0];
      this.#rekey(removed[0], added[0], A);
      for (let i = 1; i < added.length; i++) {
        const twin = { ...node, content: parts[i] }; twin.pid = added[i].id;
        A.parent.splice(idx + i, 0, twin);
        this.nodes.set(added[i].id, { node: twin, parent: A.parent, kind: A.kind });
        if (top) this.tops.set(twin, top === node ? twin : top);   // 최상위 문단이면 새 문단 자신이 최상위 요소다
      }
      return { top };
    }
    if (removed.length >= 2 && added.length === 1) {
      if (ents.some((e) => e.parent !== A.parent)) return null;
      const node = A.node, Z = ents[ents.length - 1].node, neu = textOf(added[0]), suf = cpLen(neu) - o;
      const zl = cpLen(spansText(Z.content));
      const content = [...splitSpans(node.content, o)[0], ...splitSpans(Z.content, zl - suf)[1]];
      if (spansText(content) !== neu) throw new EditError('internal', 'mirror merge differs');
      node.content = content;
      for (let i = 1; i < ents.length; i++) {
        const j = A.parent.indexOf(ents[i].node);
        if (j < 0) return null;
        A.parent.splice(j, 1); this.nodes.delete(removed[i].id); this.tops.delete(ents[i].node);
      }
      this.#rekey(removed[0], added[0], A);
      return { top: this.tops.get(node) ?? null };
    }
    return null;
  }
  /** 되돌리기·다시 하기: 기억해 둔 IR 문단(내용 그대로)으로 바꿔 놓는다. */
  #restore({ removed, added }, ents) {
    const parent = ents[0].parent;
    if (ents.some((e) => e.parent !== parent)) return null;
    const top = this.tops.get(ents[0].node) ?? null, at = parent.indexOf(ents[0].node);
    if (at < 0) return null;
    for (const e of ents) { const j = parent.indexOf(e.node); if (j < 0) return null; parent.splice(j, 1); this.tops.delete(e.node); }
    for (const pv of removed) this.nodes.delete(pv.id);
    added.forEach((pv, i) => {
      const sn = this.snaps.get(pv);
      sn.node.content = sn.content; sn.node.pid = pv.id; paraRestore(sn.node, sn.para);
      parent.splice(at + i, 0, sn.node);
      this.nodes.set(pv.id, { node: sn.node, parent, kind: sn.kind });
      if (top) this.tops.set(sn.node, top === ents[0].node ? sn.node : top);
    });
    return { top };
  }
  /** 서식 편집을 IR 문단에 입힌다(글 조각을 쪼개거나 문단 속성을 바꾸고, 문단 조판 캐시를 무효로 한다). */
  #mirrorFmt(f, node) {
    if (f.kind === 'char') node.content = formatSpans(node.content, f.from, f.to, f.props);
    else { const patch = irPara(f.props); Object.assign(node, patch); for (const k of Object.keys(patch)) if (node[k] === undefined) delete node[k]; }
    node.ver = (node.ver ?? 0) + 1;
    return { top: this.tops.get(node) ?? null };
  }
  #rekey(oldPv, newPv, ent) { if (oldPv.id !== newPv.id) { this.nodes.delete(oldPv.id); this.nodes.set(newPv.id, ent); } ent.node.pid = newPv.id; }

  /** 편집 뒤: 거울 → 증분 재조판. 어느 단계에서든 못 하면 저장본을 다시 읽어 맞춘다. */
  async #after(strict = false) {
    if (!this.model.last) return { from: 0, removed: 0, added: 0, changed: [], pageCount: this.pageCount };   // 모델이 바뀐 게 없다(빈 범위 지우기 등)
    let m = null;
    try { m = this.#mirror(strict); } catch (e) { if (!(e instanceof EditError)) throw e; }
    if (m) {
      const r = m.top ? this.lay.session.relayout(m.top) : null;
      if (r) { this.stats.relayout++; this.geo.invalidate(); return r; }
      this.#layoutAll();
      return { from: 0, removed: 0, added: this.pageCount, changed: this.lay.pages.map((_, i) => i), pageCount: this.pageCount, full: true };
    }
    return this.#reconcile();
  }
  /** 저장본을 다시 읽어 IR과 짝·조판을 새로 만든다(구조 편집을 거울이 따라 하지 못할 때). */
  async #reconcile() {
    if (!this.readIr) throw new EditError('internal', 'readIr missing');
    const bytes = await this.model.save();
    const full = await this.readIr(bytes);
    this.model.attach(full);
    this.snaps = new WeakMap();   // 새 IR 노드와 짝이 안 맞는 예전 기억은 버린다(되돌리기는 글 차이로 다시 맞춘다)
    this.#attachIr(full);
    this.#layoutAll();
    this.stats.reconcile++;
    return { from: 0, removed: 0, added: this.pageCount, changed: this.lay.pages.map((_, i) => i), pageCount: this.pageCount, full: true, reconciled: true };
  }

  // ── 위치 ────────────────────────────────────────────────────────────
  #pid(p) { return this.model.paras[p]?.id; }
  #pos(p, o, aff = 0) { return { s: 0, p, o, path: null, ...(aff ? { aff } : {}) }; }
  #rect(p, o, aff = 0) { const pid = this.#pid(p); return pid === undefined ? null : this.geo.caret(pid, o, aff); }
  /** 줄이 있는(캐럿을 놓을 수 있는) 문단인가 */
  navigable(p) { const pid = this.#pid(p); return pid !== undefined && this.geo.has(pid); }
  #clamp(pos) { const len = this.model.length(pos.p); return { ...pos, o: Math.max(0, Math.min(len, pos.o)) }; }
  #cmp(a, b) { return a.p - b.p || a.o - b.o; }

  // ── 질의 ────────────────────────────────────────────────────────────
  /** 쪽 좌표 → 글 위치. */
  hit({ page, x, y }) {
    const r = this.geo.hit(page, x, y);
    if (!r) return { pos: null };
    const p = this.model.indexOfId(r.pid);
    if (p < 0) return { pos: null };
    return { pos: this.#pos(p, r.o, r.aff), rect: r.rect, locked: this.model.lock(p) };
  }
  caret({ pos }) { const q = this.#clamp(pos); return { rect: this.#rect(q.p, q.o, q.aff), pos: q }; }
  /** kind: left right up down home end wordleft wordright docstart docend. px는 위·아래 이동 때 유지할 가로 위치(쪽 좌표, -1이면 지금 위치). */
  move({ pos, kind, px = -1 }) {
    const m = this.model, q = this.#clamp(pos), n = m.paragraphCount;
    const nav = (p, dir) => { for (let i = p + dir; i >= 0 && i < n; i += dir) if (this.navigable(i)) return i; return -1; };
    const out = (p, o, aff = 0, extra = {}) => ({ pos: this.#pos(p, o, aff), rect: this.#rect(p, o, aff), ...extra });
    switch (kind) {
      case 'left': {
        if (q.o > 0) return out(q.p, q.o - 1);
        const p = nav(q.p, -1); return p < 0 ? out(q.p, 0) : out(p, m.length(p));
      }
      case 'right': {
        if (q.o < m.length(q.p)) return out(q.p, q.o + 1);
        const p = nav(q.p, 1); return p < 0 ? out(q.p, q.o) : out(p, 0);
      }
      case 'home': case 'end': {
        const e = this.geo.lineEnds(this.#pid(q.p), q.o, q.aff);
        if (!e) return out(q.p, kind === 'home' ? 0 : m.length(q.p));
        return kind === 'home' ? out(q.p, e.a) : out(q.p, e.b, e.ambiguous && !e.last ? 1 : 0);
      }
      case 'up': case 'down': {
        const r = this.geo.vertical(this.#pid(q.p), q.o, q.aff, kind === 'up' ? -1 : 1, px);
        if (!r) return { pos: q, rect: this.#rect(q.p, q.o, q.aff), px };
        const p = m.indexOfId(r.pid);
        return { pos: this.#pos(p, r.o, r.aff), rect: r.rect, px: r.px };
      }
      case 'wordleft': case 'wordright': {
        const dir = kind === 'wordleft' ? -1 : 1, len = m.length(q.p);
        if (dir < 0 && q.o === 0) { const p = nav(q.p, -1); return p < 0 ? out(q.p, 0) : out(p, wordStep(m.text(p), m.length(p), -1)); }
        if (dir > 0 && q.o >= len) { const p = nav(q.p, 1); return p < 0 ? out(q.p, len) : out(p, 0); }
        return out(q.p, wordStep(m.text(q.p), q.o, dir));
      }
      case 'docstart': { const p = this.navigable(0) ? 0 : nav(0, 1); return p < 0 ? out(q.p, q.o) : out(p, 0); }
      case 'docend': { const p = this.navigable(n - 1) ? n - 1 : nav(n - 1, -1); return p < 0 ? out(q.p, q.o) : out(p, m.length(p)); }
      default: throw new EditError('range', `unknown move ${kind}`);
    }
  }
  /** 선택 영역의 줄별 사각형(HWP의 selrects와 같은 모양). */
  selrects({ a, b }) {
    if (this.#cmp(a, b) > 0) [a, b] = [b, a];
    const rects = [];
    for (let p = a.p; p <= b.p; p++) {
      const pid = this.#pid(p);
      if (pid === undefined || !this.geo.has(pid)) continue;
      rects.push(...this.geo.rects(pid, p === a.p ? a.o : 0, p === b.p ? b.o : Infinity, p < b.p));
    }
    return { rects };
  }
  /** 선택한 글(문단 사이는 줄바꿈). */
  text({ a, b }) {
    if (this.#cmp(a, b) > 0) [a, b] = [b, a];
    const m = this.model, parts = [];
    for (let p = a.p; p <= b.p; p++) parts.push(cpSlice(m.text(p), p === a.p ? a.o : 0, p === b.p ? b.o : undefined));
    return { text: parts.join('\n') };
  }
  wordat({ pos, whole = false }) {
    const q = this.#clamp(pos), len = this.model.length(q.p);
    const [x, y] = whole ? [0, len] : wordRange(this.model.text(q.p), q.o);
    return { a: this.#pos(q.p, x), b: this.#pos(q.p, y) };
  }
  lock(p) { return this.model.lock(p); }

  // ── 편집 ────────────────────────────────────────────────────────────
  /** 연속 입력의 되돌리기 묶음: 방금 한 편집 k개(+ 묶음이 이어지면 직전 것)를 한 항목으로 합친다. */
  #join(k, cont) {
    const m = this.model;
    if (k > 1 && !m.mergeTail(k)) return;
    if (cont) m.mergeTail(2);
  }
  /** 두 보기(바뀐 쪽 정보)를 하나로 합친다. */
  static #union(a, b) {
    if (!a) return b;
    if (!b) return a;
    return { ...b, from: Math.min(a.from, b.from), full: a.full || b.full, reconciled: a.reconciled || b.reconciled };
  }
  /**
   * 글 넣기. group이면 직전 입력과 한 되돌리기 묶음(연속 타자). replace > 0이면 pos 뒤의 그만큼을 먼저 지운다(한글 조합 중 글자 바꿔 넣기).
   */
  async insert({ pos, text, group = false, replace = 0, fmt = null }) {
    const cont = group && this.groupOpen, m = this.model, n0 = m.undoStack.length;
    this.groupOpen = true;   // 이 입력은 뒤따르는 연속 입력(group)이 이어 붙일 수 있다(묶음의 첫 글자도 같은 항목이다)
    let view = null;
    if (replace > 0) {
      m.last = null;
      const to = Math.min(m.length(pos.p), pos.o + replace);
      if (to > pos.o) { m.deleteRange({ p: pos.p, o: pos.o }, { p: pos.p, o: to }); view = await this.#after(); }
    }
    m.last = null;
    const r = m.insertText(pos.p, pos.o, text);
    view = DocxEditSession.#union(view, await this.#after());
    if (fmt && text && Object.keys(fmt).length) {   // 서식 단추를 먼저 눌러 둔 경우: 넣은 글에 그 서식을 입힌다(되돌리기는 입력과 한 항목)
      m.last = null; m.formatRange({ p: r.p, o: pos.o }, { p: r.p, o: r.o }, fmt);
      view = DocxEditSession.#union(view, await this.#after());
    }
    this.#join(m.undoStack.length - n0, cont);
    return { pos: this.#pos(r.p, r.o), rect: this.#rect(r.p, r.o), view };
  }
  /** 여러 줄 붙여넣기: 글을 줄마다 넣고 문단을 나눈다. 되돌리기 한 묶음이고, 화면은 저장본을 다시 읽어 맞춘다(구조가 크게 바뀌므로). */
  async paste({ pos, text }) {
    this.groupOpen = false;
    const lines = String(text).replace(/\r\n?/g, '\n').split('\n'), m = this.model;
    if (lines.length === 1) return this.insert({ pos, text: lines[0] });
    m.last = null; m.curBundle = ++this.bundleSeq;
    let at = { p: pos.p, o: pos.o };
    try {
      lines.forEach((ln, i) => { if (i > 0) at = m.splitParagraph(at.p, at.o); if (ln) at = m.insertText(at.p, at.o, ln); });
    } catch (e) {
      // 중간에 거부됐다(잠금 등): 여기까지 한 것을 되돌려 문서를 처음 상태로 둔다
      m.curBundle = undefined;
      const b = this.bundleSeq;
      while (m.undoStack.length && m.undoStack.at(-1).bundle === b) m.undo();
      m.redoStack.length = 0;
      throw e;
    } finally { m.curBundle = undefined; }
    const view = await this.#reconcile();
    return { pos: this.#pos(at.p, at.o), rect: this.#rect(at.p, at.o), view };
  }
  /** 서식 편집 공통: 여러 문단이면 한 묶음이고 화면은 전체를 다시 조판한다(문단마다 줄 정보가 바뀌므로). */
  async #formatted(n0, multi) {
    const m = this.model, recs = m.undoStack.slice(n0);
    if (!recs.length) return null;
    if (!multi && recs.length === 1) return this.#after();
    for (const r of recs) {   // 문단마다 IR 거울에 서식을 입히고(되돌리기용 기억도 남긴다) 한 번에 다시 조판한다
      const ent = this.nodes.get(r.removed[0].id);
      if (!ent || (ent.kind !== 'paragraph' && ent.kind !== 'heading')) return this.#reconcile();
      this.snaps.set(r.removed[0], { node: ent.node, content: ent.node.content, para: paraSnap(ent.node), parent: ent.parent, kind: ent.kind });
      this.#mirrorFmt(r.fmt, ent.node);
    }
    this.#layoutAll();
    return { from: 0, removed: 0, added: this.pageCount, changed: this.lay.pages.map((_, i) => i), pageCount: this.pageCount, full: true };
  }
  /** 서식 편집 공통(글자: 굵게·기울임·밑줄·취소선·크기·색·글꼴·형광펜을 [a, b)에, 문단: 정렬·들여쓰기·문단 간격·줄 간격을 a.p ~ b.p에). 여러 문단이면 되돌리기 한 번. */
  async #fmtOp(a, b, props, para) {
    this.groupOpen = false;
    if (this.#cmp(a, b) > 0) [a, b] = [b, a];
    const m = this.model, n0 = m.undoStack.length, multi = a.p !== b.p;
    m.last = null; m.curBundle = multi ? ++this.bundleSeq : undefined;
    try { if (para) m.formatParagraphs(a, b, props); else m.formatRange(a, b, props); } finally { m.curBundle = undefined; }
    // 문단 서식은 저장본을 다시 읽어 화면을 맞춘다: office_oxide는 문단에 직접 쓴 간격·들여쓰기가 있는지에 따라 스타일 값을 다르게 풀어 읽으므로, 거울로 따라 하면 "지금 보이는 것"과 "다시 열었을 때 보이는 것"이 달라진다.
    const view = !para ? await this.#formatted(n0, multi) : m.undoStack.length > n0 ? await this.#reconcile() : null;
    return { pos: b, rect: this.#rect(b.p, b.o, b.aff), view };
  }
  fmt({ a, b, props }) { return this.#fmtOp(a, b, props, false); }
  parafmt({ a, b, props }) { return this.#fmtOp(a, b, props, true); }
  /** 위치의 글자·문단 서식(IR에서 읽는다): 캐럿 앞 글자(문단 맨 앞이면 첫 글자)의 서식. 제목 문단은 조판이 제목 스타일을 입히므로(flow.js withHeadingStyle) 직접 정하지 않은 값은 제목 스타일의 값이다. */
  props({ pos }) {
    const q = this.#clamp(pos), n = this.nodes.get(this.#pid(q.p))?.node, lock = this.model.lock(q.p);
    if (!n) return { char: null, para: null, lock };
    let at = 0, sp;
    for (const c of n.content ?? []) { const l = spanLen(c); if (c.type === 'text' && c.text !== '\t') { sp ??= c; if (at < q.o && q.o <= at + l) { sp = c; break; } } at += l; }
    const h = n.type === 'heading' && this.full.heading_runs?.[n.level], e = sp && h ? { ...sp, bold: sp.bold ?? h.bold, italic: sp.italic ?? h.italic, color: sp.color ?? h.color, ...(sp._sz ? {} : { font_size_half_pt: h.font_size_half_pt }), ...(sp._font ? {} : { font_name: h.font_name }) } : sp;
    const hex = (c) => c && `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    return {
      char: e && { bold: !!e.bold, italic: !!e.italic, underline: !!e.underline && e.underline !== 'none', strikethrough: !!e.strikethrough, fontSize: (e.font_size_half_pt ?? 22) * 50, textColor: hex(e.color), fontFamily: e.font_name },
      para: { alignment: n.alignment === 'distribute' ? 'justify' : n.alignment ?? 'left', lineSpacing: n.line_spacing?.auto && Math.round(n.line_spacing.auto / 2.4), marginLeft: (n.indent_left_twips ?? 0) / 15 },
      lock,
    };
  }

  // ── 찾기·바꾸기 ─────────────────────────────────────────────────────
  /** 문단 글 안 query가 나타나는 자리들(code point 번호, 겹치지 않게 왼쪽부터). */
  #occurrences(p, query, cs) {
    const t = this.model.text(p);
    let hay = t, needle = query;
    if (!cs) { const h = t.toLowerCase(); if (h.length === t.length) { hay = h; needle = query.toLowerCase(); } }   // 소문자로 바꾸면 길이가 달라지는 글은 대소문자를 구분해 찾는다
    if (!needle) return [];
    const out = [];
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + needle.length)) out.push(cpLen(t.slice(0, i)));
    return out;
  }
  /** 찾기: pos에서 dir(1 앞으로·-1 뒤로) 방향의 다음 일치(문단 안만, 끝에 닿으면 반대쪽부터 한 바퀴). 없으면 { a: null, b: null }. total은 문서 전체의 일치 개수. */
  find({ pos, query, caseSensitive = false, dir = 1 }) {
    const ql = cpLen(query ?? ''), st = this.#clamp(pos), all = [];
    if (ql) for (let p = 0; p < this.model.paragraphCount; p++) for (const o of this.#occurrences(p, query, caseSensitive)) all.push([p, o]);
    let i = dir > 0 ? all.findIndex(([p, o]) => p > st.p || (p === st.p && o >= st.o)) : all.findLastIndex(([p, o]) => p < st.p || (p === st.p && o + ql <= st.o));
    const wrapped = i < 0 && all.length > 0;
    if (wrapped) i = dir > 0 ? 0 : all.length - 1;
    if (i < 0) return { a: null, b: null, total: 0 };
    const [p, o] = all[i];
    return { a: this.#pos(p, o), b: this.#pos(p, o + ql), wrapped, total: all.length };
  }
  /** 모델에서 [o, o+qlen) 글을 text로 바꾼다: 바뀌는 글의 첫 글자 서식을 잇도록 첫 글자 뒤에 새 글을 넣고 나머지를 지운다. step이 있으면 편집마다 불러 화면(IR)을 맞춘다. */
  async #swap(p, o, qlen, text, step) {
    const m = this.model, n = cpLen(text);
    let view = null;
    const go = async (fn) => { if (step) m.last = null; fn(); if (step) view = DocxEditSession.#union(view, await step()); };
    await go(() => m.insertText(p, o + 1, text));
    if (qlen > 1) await go(() => m.deleteRange({ p, o: o + 1 + n }, { p, o: o + n + qlen }));
    await go(() => m.deleteRange({ p, o }, { p, o: o + 1 }));
    return { pos: { p, o: o + n }, view };
  }
  /** 일치 하나 바꾸기(되돌리기 한 항목). */
  async replace({ a, b, text }) {
    this.groupOpen = false;
    if (this.#cmp(a, b) > 0) [a, b] = [b, a];
    if (a.p !== b.p) throw new EditError('range', 'replace across paragraphs');
    const m = this.model, n0 = m.undoStack.length;
    const { pos: r, view } = await this.#swap(a.p, a.o, b.o - a.o, text, () => this.#after());
    this.#join(m.undoStack.length - n0, false);
    return { pos: this.#pos(r.p, r.o), rect: this.#rect(r.p, r.o), view };
  }
  /** 모두 바꾸기: 편집할 수 있는 문단의 일치를 모두 바꾼다(되돌리기 한 번). 편집할 수 없는 문단의 일치는 세어서 알린다. */
  async replaceAll({ query, text, caseSensitive = false }) {
    this.groupOpen = false;
    const m = this.model, qlen = cpLen(query ?? '');
    let count = 0, skipped = 0;
    if (!qlen) return { count, skipped, view: null };
    m.last = null; m.curBundle = ++this.bundleSeq;
    const n0 = m.undoStack.length;
    try {
      for (let p = 0; p < m.paragraphCount; p++) {
        const occ = this.#occurrences(p, query, caseSensitive);
        if (!occ.length) continue;
        if (m.lock(p)) skipped += occ.length;
        else for (let i = occ.length - 1; i >= 0; i--) { await this.#swap(p, occ[i], qlen, text); count++; }   // 뒤에서부터: 앞의 위치가 밀리지 않는다
      }
    } catch (e) {
      while (m.undoStack.length > n0) m.undo();   // 중간에 거부됐다: 지금까지 한 것을 되돌려 문서를 그대로 둔다
      m.redoStack.length = 0;
      throw e;
    } finally { m.curBundle = undefined; }
    if (!count) return { count, skipped, view: null };
    const view = await this.#reconcile();
    return { count, skipped, view };
  }

  /** 되돌리기 묶음 경계(연속 입력을 여기서 끊는다). */
  mark() { this.groupOpen = false; }
  async delrange({ a, b }) {
    this.groupOpen = false;
    this.model.last = null;
    if (this.#cmp(a, b) > 0) [a, b] = [b, a];
    const r = this.model.deleteRange(a, b);
    const view = await this.#after();
    return { pos: this.#pos(r.p, r.o), rect: this.#rect(r.p, r.o), view };
  }
  async enter({ pos }) {
    this.groupOpen = false;
    this.model.last = null;
    const r = this.model.splitParagraph(pos.p, pos.o);
    const view = await this.#after();
    return { pos: this.#pos(r.p, r.o), rect: this.#rect(r.p, r.o), view };
  }
  /** dir: 'back' | 'fwd'. */
  async del({ pos, dir }) {
    this.groupOpen = false;
    this.model.last = null;
    const m = this.model, len = m.length(pos.p);
    let r;
    if (dir === 'back') {
      if (pos.o > 0) r = m.deleteRange({ p: pos.p, o: pos.o - 1 }, { p: pos.p, o: pos.o });
      else if (pos.p > 0) r = m.mergeBack(pos.p);
      else return { pos, rect: this.#rect(pos.p, pos.o), view: null };
    } else if (pos.o < len) r = m.deleteRange({ p: pos.p, o: pos.o }, { p: pos.p, o: pos.o + 1 });
    else if (pos.p + 1 < m.paragraphCount) { m.mergeBack(pos.p + 1); r = { p: pos.p, o: pos.o }; }
    else return { pos, rect: this.#rect(pos.p, pos.o), view: null };
    const view = await this.#after();
    return { pos: this.#pos(r.p, r.o), rect: this.#rect(r.p, r.o), view };
  }
  async undo() { return this.#undoRedo('undo'); }
  async redo() { return this.#undoRedo('redo'); }
  async #undoRedo(dir) {
    this.groupOpen = false;
    const m = this.model, stack = dir === 'undo' ? m.undoStack : m.redoStack, top = stack.at(-1);
    if (!top) return { pos: null };
    m.last = null;
    let hint, view;
    if (top.bundle !== undefined) {   // 붙여넣기 같은 묶음: 한 항목처럼 모두 되돌리고 화면은 한 번 다시 맞춘다
      const b = top.bundle;
      while (stack.at(-1)?.bundle === b) hint = dir === 'undo' ? m.undo() : m.redo();
      view = await this.#reconcile();
    } else {
      hint = dir === 'undo' ? m.undo() : m.redo();
      view = await this.#after(!!top.fmt);
    }
    const p = Math.min(hint.p, m.paragraphCount - 1), o = Math.min(hint.o, m.length(p));
    return { pos: this.#pos(p, o), rect: this.#rect(p, o), view };
  }
  status() { return { canUndo: this.model.undoStack.length > 0, canRedo: this.model.redoStack.length > 0, dirty: this.model.dirty }; }
  /** 저장한 것으로 표시(변경 표시만 지운다. 되돌리기 기록은 그대로). */
  clean() { this.model.dirty = false; }
  save() { return this.model.save(); }
}
