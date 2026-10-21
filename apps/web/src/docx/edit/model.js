// DOCX 편집 모델(4-2-1): document.xml을 "문단 조각 목록"으로 들고, 문단 단위로 글을 고치고, 저장 때 ZIP의 그 부품만 바꿔 쓴다.
// 위치: p = 문서 전체 문단 번호(표 칸·글상자 안 문단도 평평하게 센다), o = 문단 글 안 code point 번호.
// 편집은 "일반 문단"(필드·변경 추적·내용 컨트롤·도형 등이 없고 IR과 짝지어진 문단)만 된다. 그 밖은 잠금이고 이유를 돌려준다.
import { readZip, hasEncrypted, partText, readPart, rewriteZip } from './zip.js';
import { indexParagraphs, wPrefix, cpLen, cpSlice } from './xml.js';
import { insertText as pInsert, deleteRange as pDelete, splitParagraph as pSplit, mergeParagraphs as pMerge, paraText } from './para.js';
import { flattenIr, alignBlocks } from './ir.js';

const te = new TextEncoder();
export class EditError extends Error { constructor(code, message) { super(message); this.code = code; } }
const WS = /^\s*$/;

export class DocxEditModel {
  /**
   * @param {Uint8Array} bytes .docx
   * @param {{ir:object}|null} full office_oxide IR(없으면 짝 맞추기를 건너뛰고 XML 규칙만으로 잠금을 정한다)
   */
  static async open(bytes, full = null) {
    const zip = readZip(bytes);
    if (hasEncrypted(zip)) throw new EditError('encrypted', '암호가 걸린 ZIP 항목이 있다');
    const doc = zip.entries.find((e) => e.name === 'word/document.xml');
    if (!doc) throw new EditError('no_document', 'word/document.xml이 없다');
    const raw = await readPart(bytes, doc);
    const bom = raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf;
    if ((raw[0] === 0xff && raw[1] === 0xfe) || (raw[0] === 0xfe && raw[1] === 0xff)) throw new EditError('encoding', 'UTF-16 문서는 편집하지 않는다');
    const xml = new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw).replace(/^﻿/, '');
    const m = new DocxEditModel();
    m.bytes = bytes; m.docName = doc.name; m.bom = bom; m.px = wPrefix(xml);
    m.docLock = m.px === null ? '문서의 이름 공간을 읽지 못했다' : null;
    const settings = zip.entries.find((e) => e.name === 'word/settings.xml');
    if (settings && !m.docLock) {
      const st = await partText(bytes, settings);
      if (/<w:trackRevisions(\s[^>]*)?\/?>/.test(st) && !/<w:trackRevisions[^>]*w:val="(0|false|off)"/.test(st)) m.docLock = '변경 내용 추적이 켜져 있다';
      else if (/<w:documentProtection[^>]*w:enforcement="(1|true|on)"/.test(st)) m.docLock = '문서 보호(편집 제한)가 걸려 있다';
    }
    m.#build(xml, full);
    return m;
  }

  #build(xml, full) {
    const index = this.px === null ? [] : indexParagraphs(xml, this.px);
    this.items = []; this.paras = []; this.undoStack = []; this.redoStack = []; this.dirty = false; this.nextId = 1; this.last = null; this.idIndex = null;
    // 최상위(깊이 0) 문단만 조각으로 둔다. 글상자 안 문단은 바깥 문단 조각 안에 들어 있다.
    let pos = 0;
    index.forEach((q, i) => {
      const pv = { depth: q.depth, all: q.all, xmlEditable: q.editable, why: q.why, block: -1, risky: false, orig: i, xml: null, text: null, checked: false, id: this.nextId++ };
      if (q.depth === 0) {
        if (q.start > pos) this.items.push(xml.slice(pos, q.start));
        pv.xml = xml.slice(q.start, q.end); this.items.push(pv); pos = q.end;
      }
      this.paras.push(pv);
    });
    this.items.push(xml.slice(pos));
    this.origCount = index.length;
    this.attach(full, index);
  }

  /**
   * IR(조판의 입력)과 문단들을 짝짓는다(처음 열 때, 그리고 IR을 다시 읽었을 때). 문단 조각은 그대로 두고 block·ghost만 다시 정한다.
   * 지금 문서 XML 문단 열이 기준이므로 편집 뒤에도 쓸 수 있다.
   */
  attach(full, index = null) {
    index ??= this.px === null ? [] : indexParagraphs(this.xml(), this.px);
    if (index.length !== this.paras.length) throw new EditError('internal', `문단 수가 어긋났다(${index.length} / ${this.paras.length})`);
    let blocks = null, align = null;
    if (full) { blocks = flattenIr(full); align = alignBlocks(blocks, index); }
    this.blocks = blocks;
    const blockOf = new Map();
    if (align) align.map.forEach((p, i) => { if (p >= 0) blockOf.set(p, i); });
    this.paras.forEach((pv, i) => { pv.block = blockOf.has(i) ? blockOf.get(i) : -1; pv.risky = !!align && align.risky.has(i); pv.ghost = undefined; pv.ghostAnchor = undefined; });
    this.hasIr = !!full;
    // 빈 문단은 IR에 글 블록이 없다. 글을 넣을 수 있게 하되, 바로 앞 글 문단(닻)이 IR과 확실히 짝지어져 있어야 한다(조판이 새 글 블록을 둘 자리를 알아야 한다).
    if (full) {
      // 닻 문단의 IR 블록 바로 다음 블록이 다음 짝지어진 블록이어야 한다(사이에 짝 없는 블록 — 차트 글·그림·쪽 나누기 등 — 이 있으면 새 글 블록의 자리를 알 수 없다)
      const mappedBlocks = [...blockOf.values()].sort((x, y) => x - y);
      const nextMapped = (b) => { let lo = 0, hi = mappedBlocks.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (mappedBlocks[mid] <= b) lo = mid + 1; else hi = mid; } return mappedBlocks[lo]; };
      const safeAfter = (b) => { const nb = nextMapped(b); return nb === undefined ? b === blocks.length - 1 : nb === b + 1; };
      const inBox = this.#paragraphsInContainers();
      let prev = -1;
      for (let i = 0; i < this.paras.length; i++) {
        const pv = this.paras[i];
        if (pv.all) { prev = pv.block >= 0 ? i : -2; continue; }
        if (inBox.has(pv)) continue;
        if (pv.depth !== 0 || !pv.xmlEditable || pv.block >= 0 || prev === -2) continue;
        const ab = prev === -1 ? -1 : this.paras[prev].block;
        if (!safeAfter(ab) || !this.#ghostContextOk(pv)) continue;
        pv.ghost = true; pv.ghostAnchor = prev;
      }
    }
  }

  /** 대체 콘텐츠·내용 컨트롤·글상자·변경 추적 같은 묶음 안에 든 최상위 문단 집합(IR이 이 안의 빈 문단·새 글을 다르게 다룬다). */
  #paragraphsInContainers() {
    const out = new Set(), depth = {};
    const re = /<(\/?)(?:[\w.-]+:)?(AlternateContent|Choice|Fallback|sdtContent|txbxContent|ins|del|moveFrom|moveTo|customXml|smartTag|fldSimple|hyperlink)(?=[\s>\/])[^>]*?(\/?)>/g;
    for (const it of this.items) {
      if (typeof it !== 'string') { if (Object.values(depth).some((n) => n > 0)) out.add(it); continue; }
      let m; re.lastIndex = 0;
      while ((m = re.exec(it))) { if (m[3]) continue; depth[m[2]] = (depth[m[2]] ?? 0) + (m[1] ? -1 : 1); }
    }
    return out;
  }
  /** 빈 문단 앞뒤의 태그: IR이 표와 표 사이 문단·합쳐진 칸 안 문단 같은 자리의 글을 다르게 다루는 경우를 피한다(코퍼스 시험에서 확인한 것). */
  #ghostContextOk(pv) {
    const i = this.items.indexOf(pv), before = typeof this.items[i - 1] === 'string' ? this.items[i - 1] : '', after = typeof this.items[i + 1] === 'string' ? this.items[i + 1] : '';
    const px = this.px === '' ? '' : `${this.px}:`;
    if (new RegExp(`</${px}tbl>\\s*$`).test(before) || new RegExp(`^\\s*<${px}tbl[\\s>]`).test(after)) return false;   // 표 바로 앞뒤
    const tc = before.lastIndexOf(`<${px}tc>`), tcA = before.lastIndexOf(`<${px}tc `);
    const cell = before.slice(Math.max(tc, tcA, 0));
    if (new RegExp(`<${px}vMerge(?![^>]*val="restart")`).test(cell)) return false;   // 위 칸과 합쳐진 칸
    return true;
  }

  get paragraphCount() { return this.paras.length; }
  /** 문단 id → 문단 번호(지금). 조판이 문단을 id로 가리킨다(번호는 나누기·합치기로 바뀐다). */
  indexOfId(id) {
    if (!this.idIndex) { this.idIndex = new Map(); this.paras.forEach((pv, i) => this.idIndex.set(pv.id, i)); }
    return this.idIndex.get(id) ?? -1;
  }

  /** 편집 가능 여부와 이유 */
  lock(p) {
    const pv = this.paras[p];
    if (!pv) return '문단이 없다';
    if (this.docLock) return this.docLock;
    if (pv.depth > 0) return '글상자 안 문단';
    if (!pv.xmlEditable) return `편집할 수 없는 요소(${pv.why})가 있다`;
    if (this.hasIr && pv.block < 0 && !pv.ghost) return 'IR과 짝이 맞지 않는다';
    if (this.hasIr && pv.risky) return 'IR과 짝이 확실하지 않다';
    if (!pv.checked) { pv.text = paraText(pv.xml, this.px); pv.checked = true; if (pv.text !== pv.all && pv.orig >= 0 && !pv.created) pv.mismatch = true; }
    if (pv.mismatch) return '문단 글이 IR과 다르다';
    return null;
  }
  canEdit(p) { return this.lock(p) === null; }
  text(p) { const pv = this.paras[p]; if (!pv) throw new EditError('range', `문단 ${p}이 없다`); if (pv.depth > 0 || !pv.xml || !pv.xmlEditable) return pv.all; if (pv.text === null) pv.text = paraText(pv.xml, this.px); return pv.text; }
  length(p) { return cpLen(this.text(p)); }
  /** 보이는 IR 블록 번호(-1이면 없음). 조판이 이 번호로 문단을 가리킨다. */
  blockOf(p) { return this.paras[p]?.block ?? -1; }

  #need(p) { const why = this.lock(p); if (why) throw new EditError('locked', `문단 ${p}은 편집할 수 없다: ${why}`); }
  #mk(xml, from, extra = {}) {
    const text = paraText(xml, this.px);
    const idx = indexParagraphs(xml, this.px);
    if (idx.length !== 1 || !idx[0].editable) throw new EditError('internal', `편집 결과가 일반 문단이 아니다(${idx[0]?.why})`);
    return { depth: 0, all: text, xmlEditable: true, why: '', block: from.block, risky: false, orig: from.orig, ghost: from.ghost, ghostAnchor: from.ghostAnchor, created: true, xml, text, checked: true, id: from.id, ...extra };
  }
  /** paras·items를 [p, p+n)에서 added로 바꾼다(되돌리기 기록 포함). */
  #splice(p, n, added, hint) {
    const removed = this.paras.slice(p, p + n);
    this.#apply(p, removed, added, hint);
    this.undoStack.push({ p, removed, added, hint }); this.redoStack.length = 0;
    this.dirty = true;
  }
  #apply(p, removed, added, hint) {
    this.last = { p, removed, added, hint }; this.idIndex = null;
    const first = this.items.indexOf(removed[0]), last = this.items.indexOf(removed[removed.length - 1]);
    if (first < 0 || last < first) throw new EditError('internal', '조각 목록이 어긋났다');
    this.items.splice(first, last - first + 1, ...added);
    this.paras.splice(p, removed.length, ...added);
  }
  /** a, b(p 번호)가 같은 부모 안에서 바로 이어진 문단인가(사이에 태그가 없다) */
  #siblings(p) {
    const a = this.paras[p], b = this.paras[p + 1];
    if (!a || !b) return false;
    const i = this.items.indexOf(a);
    const n = this.items[i + 1];
    if (n === b) return true;
    return typeof n === 'string' && WS.test(n) && this.items[i + 2] === b;
  }

  insertText(p, o, str) {
    this.#need(p);
    const len = this.length(p);
    if (o < 0 || o > len) throw new EditError('range', `글 위치 ${o}가 문단 길이 ${len} 밖이다`);
    if (!str) return { p, o };
    const old = this.paras[p], expect = cpSlice(old.text, 0, o) + str + cpSlice(old.text, o);
    const xml = pInsert(old.xml, this.px, o, str), pv = this.#mk(xml, old);
    if (pv.text !== expect) throw new EditError('internal', `글 넣기 결과가 다르다(기대 ${JSON.stringify(expect).slice(0, 60)}, 실제 ${JSON.stringify(pv.text).slice(0, 60)})`);
    this.#splice(p, 1, [pv], { p, o });
    return { p, o: o + cpLen(str) };
  }

  /** 범위 지우기(문단을 가로질러도 된다: 사이 문단은 지워지고 앞뒤가 합쳐진다). */
  deleteRange(a, b) {
    if (a.p > b.p || (a.p === b.p && a.o > b.o)) [a, b] = [b, a];
    for (let p = a.p; p <= b.p; p++) this.#need(p);
    for (let p = a.p; p < b.p; p++) if (!this.#siblings(p)) throw new EditError('not_sibling', '표 칸이나 다른 구역에 걸친 범위는 지울 수 없다');
    const la = this.length(a.p), lb = this.length(b.p);
    if (a.o < 0 || a.o > la || b.o < 0 || b.o > lb) throw new EditError('range', '지울 범위가 문단 밖이다');
    if (a.p === b.p) {
      if (a.o === b.o) return { p: a.p, o: a.o };
      const old = this.paras[a.p], expect = cpSlice(old.text, 0, a.o) + cpSlice(old.text, b.o);
      const pv = this.#mk(pDelete(old.xml, this.px, a.o, b.o), old);
      if (pv.text !== expect) throw new EditError('internal', '글 지우기 결과가 다르다');
      this.#splice(a.p, 1, [pv], { p: a.p, o: a.o });
      return { p: a.p, o: a.o };
    }
    const A = this.paras[a.p], B = this.paras[b.p];
    const expect = cpSlice(A.text, 0, a.o) + cpSlice(B.text, b.o);
    const ax = a.o < la ? pDelete(A.xml, this.px, a.o, la) : A.xml, bx = b.o > 0 ? pDelete(B.xml, this.px, 0, b.o) : B.xml;
    const pv = this.#mk(pMerge(ax, bx, this.px), A);
    if (pv.text !== expect) throw new EditError('internal', '문단을 가로지른 지우기 결과가 다르다');
    this.#splice(a.p, b.p - a.p + 1, [pv], { p: a.p, o: a.o });
    return { p: a.p, o: a.o };
  }

  /** 문단 나누기(Enter): 위치 이후가 새 문단이 된다. */
  splitParagraph(p, o) {
    this.#need(p);
    const len = this.length(p);
    if (o < 0 || o > len) throw new EditError('range', `글 위치 ${o}가 문단 길이 ${len} 밖이다`);
    const old = this.paras[p];
    const [x1, x2] = pSplit(old.xml, this.px, o);
    const a = this.#mk(x1, old), b = this.#mk(x2, old, { id: this.nextId++ });
    if (a.text + b.text !== old.text || a.text !== cpSlice(old.text, 0, o)) throw new EditError('internal', '문단 나누기 결과가 다르다');
    this.#splice(p, 1, [a, b], { p, o });
    return { p: p + 1, o: 0 };
  }

  /** 문단의 처음에서 Backspace: p를 앞 문단에 합친다. */
  mergeBack(p) {
    if (p <= 0) throw new EditError('range', '첫 문단이다');
    this.#need(p - 1); this.#need(p);
    if (!this.#siblings(p - 1)) throw new EditError('not_sibling', '표 칸이나 다른 구역에 걸친 문단은 합칠 수 없다');
    const A = this.paras[p - 1], B = this.paras[p], at = this.length(p - 1);
    const pv = this.#mk(pMerge(A.xml, B.xml, this.px), A);
    if (pv.text !== A.text + B.text) throw new EditError('internal', '문단 합치기 결과가 다르다');
    this.#splice(p - 1, 2, [pv], { p: p - 1, o: at });
    return { p: p - 1, o: at };
  }

  undo() { const r = this.undoStack.pop(); if (!r) return null; this.#apply(r.p, r.added, r.removed, r.hint); this.redoStack.push(r); this.dirty = true; return r.hint; }
  redo() { const r = this.redoStack.pop(); if (!r) return null; this.#apply(r.p, r.removed, r.added, r.hint); this.undoStack.push(r); this.dirty = true; return r.hint; }

  /** 지금의 document.xml 전체 */
  xml() { return this.items.map((x) => (typeof x === 'string' ? x : x.xml)).join(''); }

  /** 저장: 바뀐 부품(document.xml)만 새로 압축하고 나머지는 원본 바이트 그대로. */
  async save() {
    const body = te.encode(this.xml());
    const data = this.bom ? new Uint8Array([0xef, 0xbb, 0xbf, ...body]) : body;
    return rewriteZip(this.bytes, new Map([[this.docName, data]]));
  }

  /** 비어 있지 않은 문단(IR에 글 블록이 있어야 하는 것)을 기준으로 센다. */
  stats() {
    let editable = 0, mapped = 0, locked = {}, nonEmpty = 0, nonEmptyMapped = 0, nonEmptyEditable = 0;
    for (let p = 0; p < this.paras.length; p++) {
      const pv = this.paras[p], why = this.lock(p), ne = !!pv.all;
      if (!why) editable++; else locked[why] = (locked[why] ?? 0) + 1;
      if (pv.block >= 0) mapped++;
      if (ne) { nonEmpty++; if (pv.block >= 0) nonEmptyMapped++; if (!why) nonEmptyEditable++; }
    }
    return { paragraphs: this.paras.length, editable, mapped, locked, docLock: this.docLock, nonEmpty, nonEmptyMapped, nonEmptyEditable };
  }
}
