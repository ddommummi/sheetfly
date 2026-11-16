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
    if (typeof opts.layoutDocument !== 'function') throw new EditError('internal', 'layoutDocument가 필요하다');
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
  #mirror() {
    const rec = this.model.last;
    if (!rec) return null;
    const { removed, added, hint } = rec;
    const ents = removed.map((pv) => this.nodes.get(pv.id));
    if (ents.some((e) => !e || (e.kind !== 'paragraph' && e.kind !== 'heading'))) return null;
    const textOf = (pv) => pv.text ?? pv.all;
    const o = hint?.o ?? 0;
    const A = ents[0];
    // 없어지는 조각마다 지금 IR 상태를 기억해 둔다(되돌리기·다시 하기 때 그대로 되돌리려고)
    removed.forEach((pv, i) => this.snaps.set(pv, { node: ents[i].node, content: ents[i].node.content, parent: ents[i].parent, kind: ents[i].kind }));
    if (added.every((pv) => this.snaps.has(pv))) return this.#restore(rec, ents);
    if (removed.length === 1 && added.length === 1) {
      const node = A.node, old = spansText(node.content), neu = textOf(added[0]);
      const dl = cpLen(neu) - cpLen(old);
      if (dl > 0) node.content = insertSpans(node.content, o, cpSlice(neu, o, o + dl));
      else if (dl < 0) node.content = deleteSpans(node.content, o, o - dl);
      if (spansText(node.content) !== neu) throw new EditError('internal', `IR 거울 글이 모델과 다르다(${JSON.stringify(spansText(node.content)).slice(0, 40)} / ${JSON.stringify(neu).slice(0, 40)})`);
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
      if (parts.some((c, i) => spansText(c) !== textOf(added[i]))) throw new EditError('internal', 'IR 거울 나누기 글이 모델과 다르다');
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
      if (spansText(content) !== neu) throw new EditError('internal', 'IR 거울 합치기 글이 모델과 다르다');
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
      sn.node.content = sn.content; sn.node.pid = pv.id;
      parent.splice(at + i, 0, sn.node);
      this.nodes.set(pv.id, { node: sn.node, parent, kind: sn.kind });
      if (top) this.tops.set(sn.node, top === ents[0].node ? sn.node : top);
    });
    return { top };
  }
  #rekey(oldPv, newPv, ent) { if (oldPv.id !== newPv.id) { this.nodes.delete(oldPv.id); this.nodes.set(newPv.id, ent); } ent.node.pid = newPv.id; }

  /** 편집 뒤: 거울 → 증분 재조판. 어느 단계에서든 못 하면 저장본을 다시 읽어 맞춘다. */
  async #after() {
    if (!this.model.last) return { from: 0, removed: 0, added: 0, changed: [], pageCount: this.pageCount };   // 모델이 바뀐 게 없다(빈 범위 지우기 등)
    let m = null;
    try { m = this.#mirror(); } catch (e) { if (!(e instanceof EditError)) throw e; }
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
    if (!this.readIr) throw new EditError('internal', 'IR을 다시 읽을 수 없다(readIr 없음)');
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
      default: throw new EditError('range', `알 수 없는 이동 ${kind}`);
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
    return { ...b, from: Math.min(a.from, b.from), full: !!(a.full || b.full), reconciled: !!(a.reconciled || b.reconciled), changed: [...new Set([...(a.changed ?? []), ...(b.changed ?? [])])] };
  }
  /**
   * 글 넣기. group이면 직전 입력과 한 되돌리기 묶음(연속 타자). replace > 0이면 pos 뒤의 그만큼을 먼저 지운다(한글 조합 중 글자 바꿔 넣기).
   */
  async insert({ pos, text, group = false, replace = 0 }) {
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
      view = await this.#after();
    }
    const p = Math.min(hint.p, m.paragraphCount - 1), o = Math.min(hint.o, m.length(p));
    return { pos: this.#pos(p, o), rect: this.#rect(p, o), view };
  }
  status() { return { canUndo: this.model.undoStack.length > 0, canRedo: this.model.redoStack.length > 0, dirty: this.model.dirty }; }
  /** 저장한 것으로 표시(변경 표시만 지운다. 되돌리기 기록은 그대로). */
  clean() { this.model.dirty = false; }
  save() { return this.model.save(); }
}
