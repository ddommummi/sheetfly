// word/document.xml을 모델과 무관하게 훑어 "정답지"를 만든다: ① <w:body> 직속 요소 범위 ② 글이 든 문단과 그 분류 ③ 기능별 출현 수.
// 두 엔진(office_oxide IR, docx-engine)을 같은 잣대로 재기 위한 독립 기준이라 어느 엔진의 코드도 쓰지 않는다.
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" };
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|apos);|&#(\d+);|&#x([0-9a-f]+);/gi, (m, n, d, h) => (n ? ENT[m] : String.fromCodePoint(d ? +d : parseInt(h, 16))));

/** 기능 정의: 이름 → document.xml에서 이 기능이 "있다"고 보는 정규식(mc:Fallback 중복은 존재 여부에는 영향 없음). */
export const FEATURES = {
  field: /<w:fldChar\b|<w:fldSimple\b|<w:instrText\b/,
  revision: /<w:ins\s|<w:del\s|<w:moveFrom\b|<w:moveTo\b|<w:rPrChange\b|<w:pPrChange\b/,
  comment: /<w:commentReference\b/,
  noteRef: /<w:footnoteReference\b|<w:endnoteReference\b/,
  columns: /<w:cols\b[^>]*\bw:num="([2-9]|\d\d+)"/,
  floating: /<wp:anchor\b|<w:framePr\b|<w:tblpPr\b/,
  inlineDrawing: /<wp:inline\b/,
  textbox: /<w:txbxContent\b/,
  math: /<m:oMath\b/,
  chart: /<c:chart\b/,
  sdt: /<w:sdt\b/,
  docGrid: /<w:docGrid\b[^>]*\bw:type="(lines|linesAndChars|snapToChars)"/,
  multiSection: null, // 아래에서 sectPr 수로 계산
  numbering: /<w:numPr\b/,
  hyperlink: /<w:hyperlink\b/,
  tab: /<w:tabs>/,
  pageBreak: /<w:br\b[^>]*w:type="page"|<w:pageBreakBefore\b/,
  ruby: /<w:ruby\b/,
  symbol: /<w:sym\b/,
  vml: /<v:shape\b|<v:rect\b|<v:oval\b/,
  dml_shape: /<wps:wsp\b/,
  smartart: /<dgm:relIds\b/,
};

export function scanDocumentXml(xml) {
  const tops = [];                // {name,start,end}
  const paras = [];               // {top, cat, text}
  const stack = [];               // 열린 요소 이름
  const openParas = [];           // 열린 문단 레코드
  let bodyDepth = -1, curTop = -1, fallback = 0;
  TAG.lastIndex = 0;
  let m;
  while ((m = TAG.exec(xml))) {
    if (!m[2]) continue;
    const [all, close, name, , self] = m;
    const start = m.index, end = start + all.length;
    if (close) {
      let i = stack.length - 1; while (i >= 0 && stack[i].name !== name) i--;
      if (i < 0) continue;
      const node = stack[i]; stack.length = i;
      if (name === 'mc:Fallback') fallback--;
      if (name === 'w:p' && node.para) { const k = openParas.lastIndexOf(node.para); if (k >= 0) openParas.splice(k, 1); }
      if (name === 'w:t' && node.textStart != null && openParas.length) openParas[openParas.length - 1].text += unesc(xml.slice(node.textStart, start));
      if (bodyDepth >= 0 && stack.length === bodyDepth && curTop >= 0 && tops[curTop].end < 0) tops[curTop].end = end;
      if (name === 'w:body') bodyDepth = -1;
      continue;
    }
    const parent = stack[stack.length - 1];
    if (name === 'w:body') { bodyDepth = stack.length + 1; }
    else if (bodyDepth >= 0 && stack.length === bodyDepth && parent?.name === 'w:body') {
      tops.push({ name, start, end: self ? end : -1 }); curTop = tops.length - 1;
    }
    if (name === 'mc:Fallback' && !self) fallback++;
    const node = { name, textStart: name === 'w:t' && !self ? end : null };
    if (name === 'w:p') {
      let cat;
      if (parent?.name === 'w:body') cat = 'body';
      else if (stack.some((s) => s.name === 'w:txbxContent')) cat = 'textbox';
      else { const t = tops[curTop]?.name; cat = t === 'w:tbl' ? 'table' : t === 'w:sdt' ? 'sdt' : 'other'; }
      const p = { top: curTop, cat, text: '', start, fb: fallback > 0 }; paras.push(p); node.para = p;
      if (!self) openParas.push(p);
    }
    if (!self) stack.push(node);
  }
  return { tops, paras: paras.filter((p) => !p.fb && p.text.trim() !== ''), rawParas: paras };
}

export function featureFlags(xml, extra = {}) {
  const out = {};
  for (const [k, re] of Object.entries(FEATURES)) if (re) out[k] = re.test(xml);
  out.multiSection = (xml.match(/<w:sectPr\b/g) ?? []).length > 1;
  return { ...out, ...extra };
}
