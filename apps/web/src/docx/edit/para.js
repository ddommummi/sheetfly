// 문단 하나의 XML 문자열 위에서 하는 편집: 글 넣기·지우기·문단 나누기·합치기. 모두 문자열 → 문자열이다.
// 위치는 문단 글 안의 code point 번호다(탭·줄바꿈·비분리 하이픈은 한 글자로 센다).
import { parseTree, esc, cpLen, cpSlice } from './xml.js';

const TEXT1 = new Set(['w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen']);   // 글자 하나로 세는 요소
const isEl = (n) => n.name !== '#text';

/** 노드의 글 길이(code point) */
function lenOf(n) {
  if (n.name === 'w:t') return cpLen(n.text ?? '');
  if (TEXT1.has(n.name)) return 1;
  if (!n.children || n.name === 'w:rPr' || n.name === 'w:pPr') return 0;
  let s = 0; for (const c of n.children) s += lenOf(c); return s;
}
const textOf = (n) => (n.name === 'w:t' ? n.text ?? '' : n.name === 'w:tab' ? '\t' : (n.name === 'w:br' || n.name === 'w:cr') ? '\n' : n.name === 'w:noBreakHyphen' ? '‑' : n.children && n.name !== 'w:rPr' && n.name !== 'w:pPr' ? n.children.map(textOf).join('') : '');

/** 노드를 문자열로 쓴다. 바꾸지 않은 노드는 원문 조각 그대로. */
const tagOf = (open) => open.replace(/^<([^\s>/]+)[\s\S]*$/, '$1');
const openNoSelf = (open) => open.replace(/\s*\/>$/, '>');
function ser(n, xml) {
  if (n.name === '#text') return n.raw;
  if (!n.dirty) return xml.slice(n.start, n.end);
  const tag = tagOf(n.open);
  if (n.name === 'w:t') {
    let open = openNoSelf(n.open);
    if (!/xml:space=/.test(open)) open = open.replace(/^<([^\s>/]+)/, '<$1 xml:space="preserve"');
    return `${open}${esc(n.text)}</${tag}>`;
  }
  const kids = n.children.map((c) => ser(c, xml)).join('');
  if (/\/>$/.test(n.open) && !n.children.length) return n.open;   // 자식이 없는 자기 닫힘 요소
  return `${openNoSelf(n.open)}${kids}</${tag}>`;
}
/** 같은 열고 닫는 태그를 가진 빈 껍데기(자식은 호출자가 채운다) */
const shell = (n, children = []) => ({ name: n.name, open: openNoSelf(n.open), children, dirty: true });
const nameParts = (px) => (px ? `${px}:` : '');

function paraNode(T) {
  const p = T.root.children.find((c) => c.name === 'w:p');
  if (!p) throw new Error('not a paragraph');
  return p;
}
/** 글 단위 목록: 문단 직속 런과 하이퍼링크 안 런의 w:t·탭·줄바꿈·비분리 하이픈. */
function units(p) {
  const out = [];
  let acc = 0;
  const run = (r, container) => {
    for (let i = 0; i < r.children.length; i++) {
      const c = r.children[i];
      if (c.name === '#text') continue;
      const len = lenOf(c);
      if (len > 0 || c.name === 'w:t') { out.push({ node: c, run: r, runContainer: container, container: r.children, len, start: acc, end: acc + len }); acc += len; }
    }
  };
  for (const c of p.children) {
    if (c.name === 'w:r') run(c, p.children);
    else if (c.name === 'w:hyperlink') for (const r of c.children) if (r.name === 'w:r') run(r, c.children);
  }
  return { list: out, total: acc };
}
const mkText = (px, text) => ({ name: 'w:t', open: `<${nameParts(px)}t xml:space="preserve">`, children: [], text, dirty: true });
const mkTab = (px) => ({ name: 'w:tab', open: `<${nameParts(px)}tab/>`, children: [], dirty: true });

/** 문단 글 */
export function paraText(pxml, px) { const T = parseTree(pxml, px); return textOf(paraNode(T)); }
export function paraLength(pxml, px) { return lenOf(paraNode(parseTree(pxml, px))); }

function intoItems(px, str) {   // 글 → [t, tab, t …]
  const parts = str.split('\t'), out = [];
  parts.forEach((s, i) => { if (i > 0) out.push(mkTab(px)); if (s || parts.length === 1) out.push(mkText(px, s)); });
  return out;
}

/** 글 넣기: 위치가 든 w:t에 끼운다(앞 글자의 서식을 잇는다). w:t가 없으면 경계의 런에 새 w:t를 넣고, 런이 없는 문단이면 문단 부호 서식을 물려받은 런을 만든다. */
export function insertText(pxml, px, o, str) {
  if (!str) return pxml;
  if (/[\n\r]/.test(str)) throw new Error('newline in text');
  const T = parseTree(pxml, px), p = paraNode(T), { list, total } = units(p);
  if (o < 0 || o > total) throw new Error(`offset ${o} > ${total}`);
  const ts = list.filter((u) => u.node.name === 'w:t');
  const t = ts.find((u) => u.start < o && o <= u.end) ?? ts.find((u) => u.start === o);
  if (t) {
    const k = o - t.start, text = t.node.text ?? '';
    const items = intoItems(px, str);
    const left = cpSlice(text, 0, k), right = cpSlice(text, k);
    if (items.length === 1 && items[0].name === 'w:t') { t.node.text = left + items[0].text + right; t.node.dirty = true; touch(t); }
    else {
      const first = items[0].name === 'w:t' ? items.shift() : null;
      t.node.text = left + (first ? first.text : ''); t.node.dirty = true;
      const last = items[items.length - 1];
      if (last.name === 'w:t') last.text += right; else items.push(mkText(px, right));
      const idx = t.container.indexOf(t.node);
      t.container.splice(idx + 1, 0, ...items); touch(t);
    }
    return wrap(T, p);
  }
  const before = [...list].reverse().find((u) => u.end === o && u.len > 0), after = list.find((u) => u.start === o && u.len > 0);
  const anchor = before ?? after;
  if (anchor) {
    const items = intoItems(px, str), idx = anchor.container.indexOf(anchor.node);
    anchor.container.splice(before ? idx + 1 : idx, 0, ...items); touch(anchor);
    return wrap(T, p);
  }
  // 글이 전혀 없는 문단: 문단 부호 서식(w:pPr/w:rPr)을 물려받은 새 런
  const pPr = p.children.find((c) => c.name === 'w:pPr');
  const mark = pPr && pPr.children.find((c) => c.name === 'w:rPr');
  const rPr = mark ? { ...shell(mark, [...mark.children]), name: 'w:rPr', open: `<${nameParts(px)}rPr>` } : null;
  const run = { name: 'w:r', open: `<${nameParts(px)}r>`, children: [...(rPr ? [rPr] : []), ...intoItems(px, str)], dirty: true };
  p.children.push(run);
  return wrap(T, p);
}
const touch = (u) => { u.run.dirty = true; };
function wrap(T, p) {
  // 하이퍼링크 안 런을 바꿨다면 그 하이퍼링크도 다시 써야 한다: 바뀐 자손이 있는 조상을 dirty로
  const mark = (n) => { if (!n.children) return false; let d = !!n.dirty; for (const c of n.children) if (mark(c)) d = true; if (d) n.dirty = true; return d; };
  mark(p);
  p.dirty = true;
  return T.xml.slice(0, p.start) + ser(p, T.xml) + T.xml.slice(p.end);
}

/** 범위 지우기(한 문단 안, [a,b)). */
export function deleteRange(pxml, px, a, b) {
  if (b <= a) return pxml;
  const T = parseTree(pxml, px), p = paraNode(T), { list, total } = units(p);
  if (a < 0 || b > total) throw new Error('range outside paragraph');
  for (const u of list) {
    if (u.end <= a || u.start >= b) continue;
    if (u.node.name === 'w:t') {
      const k0 = Math.max(0, a - u.start), k1 = Math.min(u.len, b - u.start), text = u.node.text ?? '';
      u.node.text = cpSlice(text, 0, k0) + cpSlice(text, k1); u.node.dirty = true;
      if (!u.node.text) u.container.splice(u.container.indexOf(u.node), 1);
    } else u.container.splice(u.container.indexOf(u.node), 1);   // 탭·줄바꿈 한 글자(범위 안이면 통째로)
    u.run.dirty = true;
  }
  prune(p);
  return wrap(T, p);
}
/** 글이 하나도 없는 런(서식만 남은 것)·빈 하이퍼링크를 지운다. 표지(쪽 나눔 표시 등)가 든 런은 둔다. */
function prune(p) {
  const emptyRun = (r) => !r.children.some((c) => c.name !== '#text' && c.name !== 'w:rPr');
  const sweep = (n) => {
    n.children = n.children.filter((c) => {
      if (c.name === 'w:hyperlink') { sweep(c); return c.children.some((x) => x.name === 'w:r'); }
      if (c.name === 'w:r') return !emptyRun(c);
      return true;
    });
    n.dirty = true;
  };
  const before = p.children.length; sweep(p); return before;
}

/** 문단 나누기: [앞, 뒤] XML. 구역 나누기(w:sectPr)는 뒤 문단에 남는다. */
export function splitParagraph(pxml, px, o) {
  const T = parseTree(pxml, px), p = paraNode(T), total = lenOf(p);
  if (o < 0 || o > total) throw new Error(`offset ${o} > ${total}`);
  const [L, R] = cutNode(p, o, true);
  prune(L); prune(R);
  // 새로 생기는 뒤 문단은 문단 고유 번호(w14:paraId·textId)를 물려받으면 안 된다(Word는 고유해야 한다)
  R.open = R.open.replace(/\s+[\w.-]+:(paraId|textId)=("[^"]*"|'[^']*')/g, '');
  return [ser(L, T.xml), ser(R, T.xml)];
}
function cutNode(n, o, isPara = false) {
  if (n.name === 'w:t') {
    const text = n.text ?? '';
    return [{ ...n, text: cpSlice(text, 0, o), dirty: true }, { ...n, text: cpSlice(text, o), dirty: true }];
  }
  const L = shell(n), R = shell(n);
  let acc = 0, reached = false;
  for (const c of n.children) {
    if (c.name === 'w:pPr' && isPara) {
      const keepL = shell(c, c.children.filter((x) => x.name !== 'w:sectPr'));
      L.children.push(keepL); R.children.push(c); continue;
    }
    if (c.name === 'w:rPr') { L.children.push(c); R.children.push(c); continue; }
    if (c.name === '#text') { (reached ? R : L).children.push(c); continue; }
    const len = lenOf(c);
    if (reached) { R.children.push(c); continue; }
    if (len === 0) { L.children.push(c); continue; }
    if (acc + len <= o) { L.children.push(c); acc += len; if (acc === o) reached = true; continue; }
    if (acc >= o) { reached = true; R.children.push(c); continue; }
    const [lc, rc] = cutNode(c, o - acc); L.children.push(lc); R.children.push(rc); reached = true; acc = o;
  }
  return [L, R];
}

/** 뒤 문단(b)을 앞 문단(a)에 합친다: 앞 문단의 서식을 남기고, 뒤 문단에 구역 나누기가 있으면 앞 문단으로 옮긴다. */
export function mergeParagraphs(axml, bxml, px) {
  const TA = parseTree(axml, px), TB = parseTree(bxml, px), A = paraNode(TA), B = paraNode(TB);
  const bpPr = B.children.find((c) => c.name === 'w:pPr');
  const sect = bpPr && bpPr.children.find((c) => c.name === 'w:sectPr');
  const inner = A.children.map((c) => ser(c, TA.xml));
  const pPrIdx = A.children.findIndex((c) => c.name === 'w:pPr');
  if (sect && !(pPrIdx >= 0 && A.children[pPrIdx].children.some((c) => c.name === 'w:sectPr'))) {
    const sx = ser(sect, TB.xml), pn = nameParts(px);
    if (pPrIdx < 0) inner.unshift(`<${pn}pPr>${sx}</${pn}pPr>`);
    else {
      let x = inner[pPrIdx];
      if (/\/>$/.test(x)) x = openNoSelf(x) + `</${pn}pPr>`;
      const chg = x.search(new RegExp(`<${pn}pPrChange[\\s>/]`));
      x = chg >= 0 ? x.slice(0, chg) + sx + x.slice(chg) : x.replace(new RegExp(`</${pn}pPr>$`), sx + `</${pn}pPr>`);
      inner[pPrIdx] = x;
    }
  }
  for (const c of B.children) if (c.name !== 'w:pPr') inner.push(ser(c, TB.xml));
  return `${openNoSelf(A.open)}${inner.join('')}</${tagOf(A.open)}>`;
}


// ── 서식(4-2-4) ────────────────────────────────────────────────────────
// 글자 서식은 런(w:r)의 w:rPr에, 문단 서식은 w:pPr에 쓴다. 범위의 양끝에서 런을 쪼개 범위 안의 런에만 입히고, 속성은 스키마 순서대로 끼워 넣는다
// (Word는 rPr·pPr 자식의 순서가 어긋나면 파일이 손상됐다고 할 수 있다). 바뀌지 않은 노드는 원문 조각 그대로 쓴다.
const ORDER = (list) => new Map(list.split(' ').map((n, i) => [`w:${n}`, i]));
const RPR = ORDER('rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange');
const PPR = ORDER('pStyle keepNext keepLines pageBreakBefore framePr widowControl numPr suppressLineNumbers pBdr shd tabs suppressAutoHyphens kinsoku wordWrap overflowPunct topLinePunct autoSpaceDE autoSpaceDN bidi adjustRightInd snapToGrid spacing ind contextualSpacing mirrorIndents suppressOverlap jc textDirection textAlignment textboxTightWrap outlineLvl divId cnfStyle rPr sectPr pPrChange');
const attrEsc = (v) => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** 속성이 있는 자기 닫힘 요소 */
const mkEl = (px, name, attrs = {}) => ({ name: `w:${name}`, open: `<${nameParts(px)}${name}${Object.entries(attrs).map(([k, v]) => ` ${nameParts(px)}${k}="${attrEsc(v)}"`).join('')}/>`, children: [], dirty: true });
/** parent의 자식 중 node와 같은 이름(과 drop에 든 이름)을 지우고 node를 스키마 순서 자리에 넣는다. node가 null이면 지우기만 한다. */
function setChild(parent, order, node, drop = []) {
  const names = new Set([node?.name, ...drop].filter(Boolean));
  parent.children = parent.children.filter((c) => !names.has(c.name));
  parent.dirty = true;
  if (!node) return;
  const rank = order.get(node.name) ?? 999;
  let i = parent.children.findIndex((c) => c.name !== '#text' && (order.get(c.name) ?? 999) > rank);
  if (i < 0) i = parent.children.length;
  parent.children.splice(i, 0, node);
}
const hex6 = (c) => String(c).replace(/^#/, '').toUpperCase();
/** 요소의 속성 → { 이름(접두사 없이): 값 } (값은 원문 그대로, 이스케이프된 채) */
const attrsOf = (open) => { const o = {}; for (const m of open.matchAll(/\s(?:[\w.-]+:)?([\w.-]+)="([^"]*)"/g)) o[m[1]] = m[2]; return o; };
const mkRaw = (px, name, attrs) => ({ name: `w:${name}`, open: `<${nameParts(px)}${name}${Object.entries(attrs).map(([k, v]) => ` ${nameParts(px)}${k}="${v}"`).join('')}/>`, children: [], dirty: true });

/** 글자 서식 props: { bold, italic, underline, strikethrough: 참거짓, fontSize: 반포인트, color: '#rrggbb'|null, fontName, highlight: '#rrggbb'|null } 중 있는 것만. */
function applyChar(run, px, props) {
  let rPr = run.children.find((c) => c.name === 'w:rPr');
  if (!rPr) { rPr = { name: 'w:rPr', open: `<${nameParts(px)}rPr>`, children: [], dirty: true }; run.children.unshift(rPr); }
  run.dirty = true; rPr.dirty = true;
  const tog = (key, name) => { if (key in props) setChild(rPr, RPR, mkEl(px, name, props[key] ? {} : { val: 0 })); };
  // 굵게·기울임은 복합 문자(아랍·히브리 등)용 bCs·iCs도 함께 쓴다(Word가 하는 대로) — 읽는 쪽은 글자 종류에 따라 둘 중 하나를 본다
  tog('bold', 'b'); tog('bold', 'bCs'); tog('italic', 'i'); tog('italic', 'iCs'); tog('strikethrough', 'strike');
  if ('underline' in props) setChild(rPr, RPR, mkEl(px, 'u', { val: props.underline ? 'single' : 'none' }));
  if ('fontSize' in props) { const n = Math.max(2, Math.min(1638, Math.round(props.fontSize))); setChild(rPr, RPR, mkEl(px, 'sz', { val: n })); setChild(rPr, RPR, mkEl(px, 'szCs', { val: n })); }
  if ('color' in props) setChild(rPr, RPR, mkEl(px, 'color', { val: props.color ? hex6(props.color) : 'auto' }));
  if ('fontName' in props && props.fontName) { const f = props.fontName; setChild(rPr, RPR, mkEl(px, 'rFonts', { ascii: f, hAnsi: f, eastAsia: f, cs: f })); }   // 테마 글꼴 속성은 지운다(있으면 이쪽이 이긴다)
  if ('highlight' in props) {
    setChild(rPr, RPR, null, ['w:highlight', 'w:shd']);
    if (props.highlight) setChild(rPr, RPR, mkEl(px, 'shd', { val: 'clear', color: 'auto', fill: hex6(props.highlight) }));
  }
}
const JC = { left: 'left', center: 'center', right: 'right', justify: 'both' };
/** 문단 서식 props: { alignment, indentLeft: twips, firstLine: twips(음수=내어쓰기), spaceBefore, spaceAfter: twips, lineSpacing: 퍼센트 }. */
function applyPara(p, px, props) {
  let pPr = p.children.find((c) => c.name === 'w:pPr');
  if (!pPr) { pPr = { name: 'w:pPr', open: `<${nameParts(px)}pPr>`, children: [], dirty: true }; p.children.unshift(pPr); }
  p.dirty = true; pPr.dirty = true;
  if ('alignment' in props && JC[props.alignment]) setChild(pPr, PPR, mkEl(px, 'jc', { val: JC[props.alignment] }));
  const edit = (name, change) => {
    const cur = pPr.children.find((c) => c.name === `w:${name}`), a = cur ? attrsOf(cur.open) : {};
    change(a);
    setChild(pPr, PPR, Object.keys(a).length ? mkRaw(px, name, a) : null);
  };
  const num = (v) => String(Math.round(v));
  if ('indentLeft' in props || 'firstLine' in props) edit('ind', (a) => {
    if ('indentLeft' in props) { delete a.leftChars; delete a.start; delete a.startChars; a.left = num(Math.max(0, props.indentLeft)); }
    if ('firstLine' in props) { delete a.firstLineChars; delete a.hangingChars; delete a.firstLine; delete a.hanging; if (props.firstLine > 0) a.firstLine = num(props.firstLine); else if (props.firstLine < 0) a.hanging = num(-props.firstLine); }
  });
  if ('spaceBefore' in props || 'spaceAfter' in props || 'lineSpacing' in props) edit('spacing', (a) => {
    if ('spaceBefore' in props) { delete a.beforeLines; delete a.beforeAutospacing; a.before = num(Math.max(0, props.spaceBefore)); }
    if ('spaceAfter' in props) { delete a.afterLines; delete a.afterAutospacing; a.after = num(Math.max(0, props.spaceAfter)); }
    if ('lineSpacing' in props) { a.line = num(Math.max(24, Math.min(5760, props.lineSpacing * 2.4))); a.lineRule = 'auto'; }
  });
}
const cloneNode = (n) => ({ ...n, children: n.children ? n.children.map(cloneNode) : n.children });
function runsOf(p) {   // 문단 직속·하이퍼링크 안 런: 글 안 위치 범위와 함께
  const out = []; let acc = 0;
  const walk = (children) => { for (const c of children) { if (c.name === 'w:r') { const len = lenOf(c); out.push({ run: c, container: children, start: acc, end: acc + len }); acc += len; } else if (c.name === 'w:hyperlink') walk(c.children); } };
  walk(p.children);
  return out;
}
/** 위치 o가 런 한가운데면 그 런을 둘로 쪼갠다(양쪽이 같은 서식을 갖도록 rPr는 복사한다). */
function ensureBoundary(p, o) {
  for (const r of runsOf(p)) {
    if (!(r.start < o && o < r.end)) continue;
    const [L, R] = cutNode(r.run, o - r.start);
    R.children = R.children.map((c) => (c.name === 'w:rPr' ? cloneNode(c) : c));
    r.container.splice(r.container.indexOf(r.run), 1, L, R);
    return;
  }
}
/** 범위 [a, b)와 닿은 런 중 서식이 같은 이웃 런을 하나로 합친다(서식을 입히며 쪼갠 런이 조각조각 남지 않게). 글·탭만 든 바로 이웃한 런끼리만. */
function mergeRuns(p, T, a, b) {
  const key = (r) => { const rp = r.children.find((c) => c.name === 'w:rPr'); return rp ? ser(rp, T.xml) : ''; };
  const bareT = (n) => n.name === 'w:t' && /^<[^\s>/]+(\s+xml:space="preserve")?\s*>$/.test(n.open ?? '');
  const plain = (r) => r.children.every((c) => c.name === '#text' || c.name === 'w:rPr' || RUN_TEXT_ONLY.has(c.name));
  for (let again = true; again;) {
    again = false;
    const rs = runsOf(p);
    for (let i = 0; i + 1 < rs.length && !again; i++) {
      const x = rs[i], y = rs[i + 1], c = x.container, j = c.indexOf(x.run);
      if (c !== y.container || c[j + 1] !== y.run || x.end < a || x.start > b || x.start === x.end || y.start === y.end || !plain(x.run) || !plain(y.run) || key(x.run) !== key(y.run)) continue;
      x.run.children.push(...y.run.children.filter((n) => n.name !== 'w:rPr' && n.name !== '#text'));
      const k = x.run.children;
      for (let n = k.length - 1; n > 0; n--) if (bareT(k[n]) && bareT(k[n - 1])) { k[n - 1].text += k[n].text; k[n - 1].dirty = true; k.splice(n, 1); }   // 이어진 w:t도 하나로(읽는 쪽이 w:t마다 글 조각을 만든다)
      x.run.dirty = true; c.splice(j + 1, 1); again = true;
    }
  }
}
const RUN_TEXT_ONLY = new Set(['w:t', 'w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen']);
/** [a,b) 글에 글자 서식을 입힌다(한 문단 안). */
export function formatRange(pxml, px, a, b, props) {
  const T = parseTree(pxml, px), p = paraNode(T), total = lenOf(p);
  if (a < 0 || b > total || b < a) throw new Error(`format range [${a}, ${b}) outside`);
  if (b === a) return pxml;
  ensureBoundary(p, a); ensureBoundary(p, b);
  for (const r of runsOf(p)) if (r.end > r.start && r.start >= a && r.end <= b) applyChar(r.run, px, props);
  mergeRuns(p, T, a, b);
  return wrap(T, p);
}
/** 문단 서식을 입힌다. */
export function formatParagraph(pxml, px, props) {
  const T = parseTree(pxml, px), p = paraNode(T);
  applyPara(p, px, props);
  return wrap(T, p);
}
