// word/document.xml 읽기: 태그 토크나이저로 문단·글 범위를 색인하고, 문단 하나의 XML을 가벼운 트리로 읽는다.
// DOM을 쓰지 않는다(Worker에는 DOMParser가 없고, 건드리지 않은 부분을 한 글자도 바꾸지 않으려면 원문 문자열 위에서 일해야 한다).
export const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export const unesc = (s) => (s.indexOf('&') < 0 ? s : s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, n, d, h) => { if (n) return ENT[m]; const c = d ? +d : parseInt(h, 16); return c > 0x10ffff ? m : String.fromCodePoint(c); }));
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const cpLen = (s) => { let n = s.length; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) { n--; i++; } } } return n; };
export const cpSlice = (s, a, b) => { if (a <= 0 && (b === undefined || b >= s.length)) return s; return [...s].slice(a, b).join(''); };

const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;

/** 루트 요소에서 WordprocessingML 이름 공간에 묶인 접두사를 찾는다. 못 찾으면 null(편집 불가). 기본 이름 공간이면 ''. */
export function wPrefix(xml) {
  const m = /<[A-Za-z_][\w:.-]*((?:[^>"']|"[^"]*"|'[^']*')*)>/.exec(xml.replace(/^﻿?<\?[\s\S]*?\?>\s*/, ''));
  if (!m) return null;
  const re = /xmlns(?::([\w.-]+))?\s*=\s*("([^"]*)"|'([^']*)')/g; let x;
  while ((x = re.exec(m[1]))) if ((x[3] ?? x[4]) === W_NS) return x[1] ?? '';
  return null;
}
/** 접두사를 w:로 통일한 태그 이름 */
const norm = (name, px) => (px === 'w' ? name : px === '' ? (name.includes(':') ? name : `w:${name}`) : name.startsWith(`${px}:`) ? `w:${name.slice(px.length + 1)}` : name);

// 문단 직속·하이퍼링크 안에 있어도 되는 요소와, 런 안에 있어도 되는 요소(이 밖의 것이 든 문단은 읽기 전용)
export const RUN_TEXT = new Set(['w:t', 'w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen']);
export const RUN_MARK = new Set(['w:lastRenderedPageBreak', 'w:softHyphen', 'w:commentReference']);   // 글이 아닌 표지(보존만)
export const RUN_OK = new Set(['w:rPr', ...RUN_TEXT, ...RUN_MARK]);
export const PARA_OK = new Set(['w:pPr', 'w:r', 'w:hyperlink', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:commentRangeStart', 'w:commentRangeEnd', 'w:permStart', 'w:permEnd']);

/**
 * 문서의 모든 문단(글상자 안 문단 포함)을 문서 순서로 색인한다.
 * 각 문단: {start, end, depth, all, editable, why} — all은 필드·변경 추적 안의 글까지 모은 문단 글(IR과 맞추는 데 쓴다), editable은 "문단 직속 일반 런만 든 문단"이다.
 */
export function indexParagraphs(xml, px = wPrefix(xml)) {
  const paras = [], stack = [], open = [];
  if (px === null) return paras;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;
    const close = m[1], name = norm(m[2], px), selfClose = m[4], start = m.index, end = start + m[0].length;
    const parent = stack[stack.length - 1], para = open[open.length - 1];
    if (close) {
      let i = stack.length - 1; while (i >= 0 && stack[i].name !== name) i--;
      if (i < 0) continue;
      const node = stack[i]; stack.length = i;
      if (name === 'w:p') { node.para.end = end; const k = open.lastIndexOf(node.para); if (k >= 0) open.splice(k, 1); }
      else if (name === 'w:t' && node.isText && open.length) open[open.length - 1].all += unesc(xml.slice(node.textStart, start));
      continue;
    }
    const node = { name, start, textStart: end };
    if (name === 'w:p') {
      const p = { start, end: selfClose ? end : -1, depth: open.length, all: '', editable: open.length === 0, why: open.length ? 'w:txbxContent' : '' };
      paras.push(p); node.para = p;
      if (!selfClose) open.push(p);
    } else if (para) {
      const parName = parent && parent.name;
      if (name === 'w:t') node.isText = true;
      if (parName === 'w:r' && (name === 'w:tab' || name === 'w:cr' || (name === 'w:br' && !/w:type="(page|column)"/.test(m[0])))) para.all += name === 'w:tab' ? '\t' : '\n';
      if (parName === 'w:r' && name === 'w:noBreakHyphen') para.all += '‑';
      if (parName === 'w:p' || parName === 'w:hyperlink') {
        if (!PARA_OK.has(name)) { para.editable = false; para.why ||= name; }
      } else if (parName === 'w:r') {
        if (!RUN_OK.has(name)) { para.editable = false; para.why ||= name; }
        else if (name === 'w:br' && /w:type="(page|column)"/.test(m[0])) { para.editable = false; para.why ||= 'w:br(page)'; }
      }
    }
    if (!selfClose) stack.push(node);
  }
  return paras;
}

// ── 문단 하나의 트리 ─────────────────────────────────────────────
// {name, open, close, self, children, start, end, dirty, text?(w:t)}. 바꾸지 않은 노드는 원문 조각(xml.slice(start,end))으로 다시 쓴다.
export function parseTree(xml, px = wPrefix(xml) ?? 'w') {
  const root = { name: '#root', children: [], start: 0, end: xml.length };
  const stack = [root];
  TAG.lastIndex = 0;
  let m, pos = 0;
  const textTo = (to) => { if (to > pos) stack[stack.length - 1].children.push({ name: '#text', start: pos, end: to, raw: xml.slice(pos, to) }); pos = to; };
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;      // 주석·CDATA·처리 명령은 글로 둔다
    textTo(m.index);
    const close = m[1], name = norm(m[2], px), start = m.index, end = start + m[0].length;
    if (close) {
      let i = stack.length - 1; while (i > 0 && stack[i].name !== name) i--;
      if (i === 0) { pos = end; continue; }
      const node = stack[i]; stack.length = i; node.close = m[0]; node.end = end; node.closeStart = start;
      if (node.name === 'w:t') node.text = unesc(xml.slice(node.open.length + node.start, start));
    } else {
      const node = { name, open: m[0], self: !!m[4], children: [], start, end };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
    }
    pos = end;
  }
  textTo(xml.length);
  return { root, xml, px };
}
