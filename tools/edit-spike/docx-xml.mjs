// word/document.xml 문자열 위에서 문단·런의 글자 범위를 찾고, 바이트(문자) 단위로 부분 수정하는 스파이크.
// 읽는 쪽은 DOM이 아니라 태그 토크나이저다: 건드리지 않은 부분은 한 글자도 바뀌지 않는다(무손실 저장의 핵심).
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
export const unesc = (s) => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, n, d, h) => (n ? ENT[m] : String.fromCodePoint(d ? +d : parseInt(h, 16))));
export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 편집할 수 있는 런 안의 요소(글자·탭·줄바꿈)와 그 밖의 요소를 가른다. */
const RUN_OK = new Set(['w:rPr', 'w:t', 'w:tab', 'w:br', 'w:cr', 'w:noBreakHyphen']);
// 문단 직속 또는 하이퍼링크 안의 이 요소들만 "일반 텍스트 문단"으로 본다. 그 밖(필드·변경 추적·내용 컨트롤·도형 …)이 있으면 그 문단은 읽기 전용.
const PARA_OK = new Set(['w:pPr', 'w:r', 'w:hyperlink', 'w:bookmarkStart', 'w:bookmarkEnd', 'w:proofErr', 'w:lastRenderedPageBreak']);

/** 문단 목록: [{start, end, pPr:[s,e]|null, runs:[{start,end,rPr:[s,e]|null,items:[{kind,start,end,textStart,textEnd,text}]}], text, editable, why}] — start/end는 문서 문자열의 위치. */
export function indexParagraphs(xml) {
  const paras = [];
  const stack = [];        // {name, start, para?, run?}
  const open = [];         // 열려 있는 문단(중첩: 글상자 안 문단)
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;   // 주석·CDATA·처리 명령
    const [all, close, name, , selfClose] = m;
    const start = m.index, end = m.index + all.length;
    const parent = stack[stack.length - 1];
    if (close) {
      // 짝이 맞는 여는 태그까지 꺼낸다
      let i = stack.length - 1; while (i >= 0 && stack[i].name !== name) i--;
      if (i < 0) continue;
      const node = stack[i]; stack.length = i;
      if (name === 'w:p') { node.para.end = end; const k = open.lastIndexOf(node.para); if (k >= 0) open.splice(k, 1); finish(node.para); }
      else if (name === 'w:r' && node.run) { node.run.end = end; }
      else if (name === 'w:t' && node.item) { node.item.textEnd = start; node.item.end = end; node.item.text = unesc(xml.slice(node.item.textStart, start)); }
      else if (name === 'w:rPr' && node.rPr) node.rPr[1] = end;
      else if (name === 'w:pPr' && node.pPr) node.pPr[1] = end;
      continue;
    }
    const node = { name, start };
    const para = open[open.length - 1];
    if (name === 'w:p') {
      const p = { start, end: -1, pPr: null, runs: [], text: '', editable: true, why: '', depth: open.length };
      paras.push(p); node.para = p;
      if (selfClose) { p.end = end; finish(p); } else open.push(p);
    } else if (para && parent && (parent.name === 'w:p' || parent.name === 'w:hyperlink')) {
      if (!PARA_OK.has(name)) { para.editable = false; para.why ||= name; }
      if (name === 'w:pPr' && parent.name === 'w:p') { node.pPr = para.pPr = [start, selfClose ? end : -1]; }
      if (name === 'w:r') { const run = { start, end: selfClose ? end : -1, rPr: null, items: [], bad: false }; para.runs.push(run); node.run = run; }
    } else if (para && parent && parent.name === 'w:r' && parent.run) {
      const run = parent.run;
      if (name === 'w:rPr') { run.rPr = [start, selfClose ? end : -1]; node.rPr = run.rPr; }
      else if (RUN_OK.has(name)) {
        const item = { kind: name, start, end: selfClose ? end : -1, textStart: end, textEnd: end, text: name === 'w:tab' ? '\t' : (name === 'w:br' || name === 'w:cr') ? '\n' : name === 'w:noBreakHyphen' ? '-' : '' };
        if (name === 'w:br' && /w:type="(page|column)"/.test(all)) { run.bad = true; para.editable = false; para.why ||= 'w:br(page)'; }
        run.items.push(item); if (name === 'w:t' && !selfClose) node.item = item;
      } else { run.bad = true; para.editable = false; para.why ||= name; }
    }
    if (!selfClose) stack.push(node);
  }
  return paras;
  function finish(p) { p.text = p.runs.map((r) => r.items.map((i) => i.text).join('')).join(''); }
}

/** 문단 안 글자 위치(UTF-16이 아니라 code point) → {run, item, at(item 글자 안 위치)}. w:t 안에서만 찾는다. */
export function locate(para, offset) {
  let o = offset;
  for (const run of para.runs) for (const it of run.items) {
    const n = [...it.text].length;
    if (it.kind === 'w:t' ? o <= n : o < n) { if (it.kind === 'w:t') return { run, item: it, at: o }; }
    o -= n;
  }
  return null;
}

/** 글자 넣기: 위치의 w:t 안에 끼워 넣는다(런 구조·서식은 그대로). 끝에 닿으면 이전 w:t 끝에 붙인다. 없으면 null(런이 없는 빈 문단 등). */
export function insertText(xml, para, offset, text) {
  const loc = locate(para, offset);
  if (!loc) return null;
  const { item, at } = loc;
  const cps = [...item.text];
  const before = cps.slice(0, at).join(''), after = cps.slice(at).join('');
  const open = xml.slice(item.start, item.textStart);
  const tag = /xml:space=/.test(open) ? open : open.replace(/>$/, ' xml:space="preserve">');
  return xml.slice(0, item.start) + tag + esc(before + text + after) + xml.slice(item.textEnd);
}
