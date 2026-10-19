// RTF → IR. office_oxide가 읽지 못하는 RTF를 우리 조판 엔진이 받는 IR(DOCX와 같은 모양)로 바꾼다.
// 신뢰할 수 없는 입력이므로 중첩 깊이·그림 크기·표 크기·글자 수에 상한을 둔다. 지원하지 않는 것은 건너뛴다(오류로 읽기를 막지 않는다).
// 지원: 글자 서식, 문단 서식(정렬·들여쓰기·간격·줄 간격·탭), 스타일시트, 표(병합·배경·테두리), 머리글/바닥글, 쪽 번호 필드,
//       그림(JPEG/PNG), 각주, 구역·용지·여백, 유니코드(\uN)와 코드페이지(\'hh, 한글 949 등).
const MAX_DEPTH = 200;
const MAX_TEXT = 8_000_000;       // 글자 수
const MAX_IMAGE = 32 * 1024 * 1024;
const MAX_ROWS = 20000;
const MAX_CELLS_PER_ROW = 500;
const MAX_ELEMENTS = 400000;

const CP_LABEL = { 437: 'ibm866', 874: 'windows-874', 932: 'shift_jis', 936: 'gbk', 949: 'euc-kr', 950: 'big5', 1250: 'windows-1250', 1251: 'windows-1251', 1252: 'windows-1252', 1253: 'windows-1253', 1254: 'windows-1254', 1255: 'windows-1255', 1256: 'windows-1256', 1257: 'windows-1257', 1258: 'windows-1258', 10000: 'macintosh', 65001: 'utf-8' };
const CHARSET_CP = { 0: null, 128: 932, 129: 949, 134: 936, 136: 950, 161: 1253, 162: 1254, 177: 1255, 178: 1256, 186: 1257, 204: 1251, 222: 874, 238: 1250 };
const SYMBOL = { emdash: '—', endash: '–', bullet: '•', lquote: '‘', rquote: '’', ldblquote: '“', rdblquote: '”', emspace: ' ', enspace: ' ', qmspace: ' ', zwj: '‍', zwnj: '‌' };
const decoders = new Map();
function decode(bytes, cp) {
  const label = CP_LABEL[cp] ?? 'windows-1252';
  let d = decoders.get(label);
  if (!d) { try { d = new TextDecoder(label); } catch { d = new TextDecoder('windows-1252'); } decoders.set(label, d); }
  return d.decode(Uint8Array.from(bytes));
}
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };

const defChar = () => ({ f: null, fs: 24, b: false, i: false, ul: null, strike: false, cf: 0, sup: 0, caps: false, scaps: false, hl: 0, expnd: 0 });
const defPara = () => ({ qa: 'left', li: 0, ri: 0, fi: 0, sb: 0, sa: 0, sl: 0, slmult: 0, keepn: false, keep: false, intbl: false, pagebb: false, tabs: [], tabAlign: 'Left', tabLeader: 'None', styleHeading: 0 });

export function parseRtf(input, opts = {}) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const warn = new Set();
  let pos = 0;
  const N = data.length;

  // ── 문서 수준 상태 ──
  const fonts = new Map();           // f번호 → { name, cp }
  let colors = [null];               // 색 번호 → [r,g,b] | null(자동)
  const styles = new Map();          // s번호 → { name, tokens:[[word,param]], basedon }
  const doc = { deff: 0, cp: 1252, uc: 1, paperw: 12240, paperh: 15840, margl: 1800, margr: 1800, margt: 1440, margb: 1440, headery: 720, footery: 720, landscape: false, titlepg: false, pgnstart: null, pgnfmt: null, facingp: false };
  let sec = newSection();
  const sections = [];
  const footnotes = [];
  let noteSeq = 0;
  let textCount = 0, elementCount = 0;

  function newSection() { return { elements: [], header: null, footer: null, headerFirst: null, headerEven: null, override: {}, titlepg: doc.titlepg, brk: 'next_page' }; }

  // ── 쓰기 대상(컨테이너)과 문단 구성 ──
  let container = sec.elements;
  const containerStack = [];
  let runs = [];                      // 현재 문단의 글자 조각
  let table = null;                   // 진행 중인 표 { rows:[...] }
  let row = null;                     // 진행 중인 행 { defs:[...], cells:[], cur:[] }
  let rowDef = null;                  // \trowd 이후 셀 정의 누적
  let cellDef = null;
  let curCell = null;                 // 현재 셀 내용 컨테이너

  const hasContent = () => runs.length > 0;
  const push = (arr, el) => { if (++elementCount > MAX_ELEMENTS) throw new Error('too many elements'); arr.push(el); };

  function charRun(text, c) {
    const f = fonts.get(c.f ?? doc.deff);
    const r = { type: 'text', text, font_size_half_pt: clamp(c.fs, 1, 2000) };
    if (f && f.name) r.font_name = f.name;
    if (c.b) r.bold = true;
    if (c.i) r.italic = true;
    if (c.ul) r.underline = c.ul;
    if (c.strike) r.strikethrough = true;
    const col = colors[c.cf]; if (col) r.color = col;
    const hl = colors[c.hl]; if (c.hl && hl) r.highlight = hl;
    if (c.sup) r.vertical_align = c.sup > 0 ? 'superscript' : 'subscript';
    if (c.caps) r.all_caps = true;
    if (c.scaps) r.small_caps = true;
    if (c.expnd) r.char_spacing_half_pt = c.expnd;     // 이름은 half_pt이나 값은 twips (D-032 메모)
    return r;
  }
  const sameStyle = (a, b) => ['font_size_half_pt', 'font_name', 'bold', 'italic', 'underline', 'strikethrough', 'vertical_align', 'all_caps', 'small_caps', 'char_spacing_half_pt'].every((k) => a[k] === b[k]) && JSON.stringify(a.color) === JSON.stringify(b.color) && JSON.stringify(a.highlight) === JSON.stringify(b.highlight);
  function addText(text, c) {
    if (!text) return;
    textCount += text.length; if (textCount > MAX_TEXT) throw new Error('too much text');
    const r = charRun(text, c);
    const last = runs[runs.length - 1];
    if (last && last.type === 'text' && last.text !== '\t' && text !== '\t' && sameStyle(last, r)) last.text += text; else runs.push(r);
  }

  function paraElement(p) {
    const el = { type: p.styleHeading ? 'heading' : 'paragraph', content: runs };
    if (p.styleHeading) el.level = p.styleHeading;
    el.alignment = p.qa === 'justify' ? 'justify' : p.qa;
    el.indent_left_twips = p.li; el.indent_right_twips = p.ri;
    if (p.fi) el.first_line_indent_twips = p.fi;
    if (p.sb) el.space_before_twips = p.sb;
    el.space_after_twips = p.sa;
    if (p.sl) el.line_spacing = p.slmult ? { auto: Math.abs(p.sl) } : p.sl < 0 ? { exact: -p.sl } : { at_least: p.sl };
    if (p.keepn) el.keep_with_next = true;
    if (p.keep) el.keep_together = true;
    if (p.tabs.length) el.tabs = p.tabs.map((t) => ({ position_twips: t.pos, alignment: t.align, leader: t.leader }));
    return el;
  }

  function flushTable() {
    if (!table) return;
    const t = buildTable(table);
    table = null;
    if (t) push(container, t);
  }

  function endParagraph(p, force) {
    const had = hasContent();
    if (!had && !force) return;
    if (!curCell) flushTable();
    if (p.pagebb && !curCell) push(container, { type: 'page_break' });
    const el = paraElement(p);
    runs = [];
    push(curCell ?? container, el);
  }

  // ── 표 ──
  function buildTable(tb) {
    const rows = tb.rows;
    if (!rows.length) return null;
    // 격자: 모든 셀 오른쪽 경계의 합집합
    const edges = new Set([0]);
    for (const r of rows) for (const d of r.defs) edges.add(d.x);
    const xs = [...edges].sort((a, b) => a - b).filter((v, i, a) => i === 0 || v - a[i - 1] > 8);
    const colW = []; for (let i = 1; i < xs.length; i++) colW.push(Math.max(1, xs[i] - xs[i - 1]));
    const idx = (x) => { let k = 0; for (let i = 0; i < xs.length; i++) if (Math.abs(xs[i] - x) <= 8 || xs[i] <= x) k = i; return k; };
    const outRows = [];
    for (const r of rows) {
      const cells = [];
      let left = 0;
      r.defs.forEach((d, ci) => {
        const content = r.cells[ci] ?? [];
        const c0 = idx(left), c1 = idx(d.x);
        left = d.x;
        if (d.hmrg) { const prev = cells[cells.length - 1]; if (prev) { prev.col_span += Math.max(1, c1 - c0); prev.width_twips += d.x - (d.x - 0) + 0; } return; }
        const cell = { content: content.length ? content : [{ type: 'paragraph', content: [] }], col_span: Math.max(1, c1 - c0), row_span: 1, width_twips: Math.max(1, Math.round(d.x - (r.defs[ci - 1]?.x ?? 0))) };
        if (d.bg) cell.background_color = d.bg;
        if (d.border) cell.border = d.border;
        if (d.vmrg) cell._vm = true; if (d.vmgf) cell._vf = true;
        cell._c0 = c0;
        if (d.va) cell.vertical_align = d.va;
        cells.push(cell);
      });
      outRows.push({ cells, ...(r.header ? { is_header: true, repeat_as_header: true } : {}) });
    }
    // 가로 병합 후 폭 보정, 세로 병합 계산(연속 셀은 버린다)
    for (let ri = 0; ri < outRows.length; ri++) {
      for (const cell of outRows[ri].cells) {
        if (cell._vf) {
          let n = 1;
          for (let k = ri + 1; k < outRows.length; k++) { const m = outRows[k].cells.find((c) => c._c0 === cell._c0 && c._vm); if (!m) break; m._drop = true; n++; }
          cell.row_span = n;
        }
      }
    }
    for (const r of outRows) {
      r.cells = r.cells.filter((c) => !c._drop);
      for (const c of r.cells) { delete c._vm; delete c._vf; delete c._c0; }
    }
    // \trautofit1이고 칸마다 지정 너비(\clwWidth)가 없으면 내용에 맞추는 표다: 칸 너비를 빼서 자동 맞춤 경로를 탄다.
    if (rows.some((r) => r.autofit) && !rows.some((r) => r.defs.some((d) => d.pref))) for (const r of outRows) for (const c of r.cells) delete c.width_twips;
    return { type: 'table', column_widths_twips: colW, rows: outRows };
  }

  function finishRow() {
    if (!row) return;
    if (!table) table = { rows: [] };
    if (table.rows.length < MAX_ROWS) table.rows.push({ defs: row.defs, cells: row.cells, header: row.header, autofit: row.autofit });
    row = null; curCell = null;
  }

  // ── 그룹 상태 ──
  const root = { char: defChar(), para: defPara(), uc: 1, cp: 1252, dest: 'doc', skip: false, ignorable: false, fontKey: null };
  let st = root;
  const stack = [];
  let skipLeft = 0;                 // \uN 뒤에 건너뛸 글자 수
  let pendingBytes = [];
  let ucSkipPending = 0;

  const flushBytes = () => {
    if (!pendingBytes.length) return;
    const bytes = pendingBytes; pendingBytes = [];
    const text = decode(bytes, st.cp);
    if (!st.skip) emitText(text);
  };

  // 목적지별 수집기
  let fontEntry = null, colorBuf = null, styleEntry = null, instrBuf = '', picState = null, fldState = null;

  function emitText(text) {
    if (st.skip) return;
    switch (st.dest) {
      case 'fonttbl': if (fontEntry) { const t = text.replace(/;/g, ''); fontEntry.name = ((fontEntry.name ?? '') + t).trim(); if (text.includes(';')) fontEntry.done = true; } return;
      case 'colortbl': return;
      case 'stylesheet': if (styleEntry) { styleEntry.name = ((styleEntry.name ?? '') + text.replace(/;/g, '')).trim(); } return;
      case 'fldinst': instrBuf += text; return;
      case 'pict': return;
      case 'doc': case 'fldrslt': case 'listtext': case 'footnote':
        addText(text, st.char); return;
      default: return;
    }
  }

  // 제어어 적용(스타일 재생에도 쓴다). 문단/글자 서식만 다룬다.
  function applyFormat(word, n, hasN, s) {
    const c = s.char, p = s.para;
    switch (word) {
      case 'plain': Object.assign(c, defChar(), { f: null }); return true;
      case 'pard': Object.assign(p, defPara()); return true;
      case 'b': c.b = !hasN || n !== 0; return true;
      case 'i': c.i = !hasN || n !== 0; return true;
      case 'ul': case 'uld': case 'uldb': case 'ulw': case 'ulth': case 'uldash': case 'ulwave': c.ul = word === 'uldb' || word === 'uld' ? 'double' : word === 'ulwave' ? 'wave' : 'single'; if (hasN && n === 0) c.ul = null; return true;
      case 'ulnone': c.ul = null; return true;
      case 'strike': case 'striked': c.strike = !hasN || n !== 0; return true;
      case 'fs': c.fs = clamp(n, 1, 2000); return true;
      case 'f': c.f = n; { const fe = fonts.get(n); if (fe && fe.cp) s.cp = fe.cp; } return true;
      case 'cf': c.cf = n; return true;
      case 'cb': case 'chcbpat': return true;
      case 'highlight': c.hl = n; return true;
      case 'super': c.sup = 1; return true;
      case 'sub': c.sup = -1; return true;
      case 'nosupersub': c.sup = 0; return true;
      case 'caps': c.caps = !hasN || n !== 0; return true;
      case 'scaps': c.scaps = !hasN || n !== 0; return true;
      case 'expndtw': c.expnd = clamp(n, -2000, 2000); return true;
      case 'expnd': c.expnd = clamp(Math.round(n * 5), -2000, 2000); return true;   // 1/4pt → twips
      case 'ql': p.qa = 'left'; return true;
      case 'qr': p.qa = 'right'; return true;
      case 'qc': p.qa = 'center'; return true;
      case 'qj': p.qa = 'justify'; return true;
      case 'qd': p.qa = 'distribute'; return true;
      case 'li': case 'lin': p.li = clamp(n, -100000, 100000); return true;
      case 'ri': case 'rin': p.ri = clamp(n, -100000, 100000); return true;
      case 'fi': p.fi = clamp(n, -100000, 100000); return true;
      case 'sb': p.sb = clamp(n, 0, 100000); return true;
      case 'sa': p.sa = clamp(n, 0, 100000); return true;
      case 'sl': p.sl = clamp(n, -100000, 100000); return true;
      case 'slmult': p.slmult = n; return true;
      case 'keep': p.keep = true; return true;
      case 'keepn': p.keepn = true; return true;
      case 'pagebb': p.pagebb = true; return true;
      case 'intbl': p.intbl = true; return true;
      case 'tqr': p.tabAlign = 'Right'; return true;
      case 'tqc': p.tabAlign = 'Center'; return true;
      case 'tqdec': p.tabAlign = 'Decimal'; return true;
      case 'tldot': case 'tlmdot': p.tabLeader = 'Dot'; return true;
      case 'tlhyph': p.tabLeader = 'Hyphen'; return true;
      case 'tlul': case 'tlth': p.tabLeader = 'Underscore'; return true;
      case 'tx': if (p.tabs.length < 64) p.tabs.push({ pos: clamp(n, 0, 100000), align: p.tabAlign, leader: p.tabLeader }); p.tabAlign = 'Left'; p.tabLeader = 'None'; return true;
      default: return false;
    }
  }

  function applyStyle(n, s, depth = 0) {
    const sty = styles.get(n);
    if (!sty || depth > 8) return;
    if (sty.basedon != null && sty.basedon !== n) applyStyle(sty.basedon, s, depth + 1);
    for (const [w, v, h] of sty.tokens) applyFormat(w, v, h, s);
    const m = /^heading\s*([1-9])$/i.exec(sty.name ?? '');
    if (m) s.para.styleHeading = Number(m[1]);
  }

  const pageSetup = () => {
    const o = sec.override;
    const w = o.pgw ?? doc.paperw, h = o.pgh ?? doc.paperh;
    const ps = {
      width_twips: clamp(w, 720, 200000), height_twips: clamp(h, 720, 200000),
      margin_left_twips: clamp(o.ml ?? doc.margl, 0, 100000), margin_right_twips: clamp(o.mr ?? doc.margr, 0, 100000),
      margin_top_twips: clamp(o.mt ?? doc.margt, 0, 100000), margin_bottom_twips: clamp(o.mb ?? doc.margb, 0, 100000),
      header_distance_twips: doc.headery, footer_distance_twips: doc.footery,
    };
    if (doc.landscape || o.landscape) ps.landscape = true;
    const start = o.pgnstart ?? doc.pgnstart; if (start != null) ps.page_number_start = start;
    const fmt = o.pgnfmt ?? doc.pgnfmt; if (fmt) ps.page_number_format = fmt;
    return ps;
  };

  function finishSection(final) {
    // 마지막으로 남은 글자/표를 비운다
    if (curCell == null) { endParagraph(st.para, false); flushTable(); }
    const out = { elements: sec.elements, page_setup: pageSetup(), break_type: sec.brk };
    if (sec.header) out.header = { content: sec.header };
    if (sec.footer) out.footer = { content: sec.footer };
    if (sec.headerFirst && sec.titlepg) out.first_page_header = { content: sec.headerFirst };
    if (sec.headerEven && doc.facingp) out.even_page_header = { content: sec.headerEven };
    sections.push(out);
    if (!final) {
      const keep = { header: sec.header, footer: sec.footer, headerFirst: sec.headerFirst, headerEven: sec.headerEven };
      sec = newSection(); Object.assign(sec, keep);
      container = sec.elements;
    }
  }

  // ── 목적지 시작 ──
  function enterDest(name, starred) {
    switch (name) {
      case 'fonttbl': st.dest = 'fonttbl'; return;
      case 'colortbl': st.dest = 'colortbl'; colorBuf = { r: null, g: null, b: null }; colors = []; return;
      case 'stylesheet': st.dest = 'stylesheet'; return;
      case 'header': case 'headerr': case 'headerl': case 'headerf': case 'footer': case 'footerr': case 'footerl': case 'footerf': {
        st.dest = 'doc'; st.hf = name; beginHF(); return;
      }
      case 'footnote': st.dest = 'footnote'; beginNote(); return;
      case 'pict': st.dest = 'pict'; picState = { fmt: null, hex: [], bin: null, goalw: 0, goalh: 0, w: 0, h: 0, sx: 100, sy: 100 }; return;
      case 'shppict': return;                                // 그림 그룹 안의 \pict를 읽는다(starred여도)
      case 'field': st.dest = 'doc'; startField(); return;
      case 'fldinst': st.dest = 'fldinst'; instrBuf = ''; return;
      case 'fldrslt': st.dest = 'fldrslt'; return;
      case 'listtext': case 'pntext': st.dest = 'listtext'; return;
      default:
        st.skip = true;                                       // nonshppict, info, generator, listtable, pn, 그 밖의 모든 무시 가능한 목적지
    }
  }

  // 머리글/바닥글: 같은 컨테이너 문법으로 별도 수집
  function beginHF() {
    flushPendingBefore();
    containerStack.push({ container, runs, table, row, curCell, rowDef, cellDef });
    container = []; runs = []; table = null; row = null; curCell = null;
    st.hfSink = container;
  }
  function endHF(name) {
    if (!curCell) { endParagraphIn(st); flushTable(); }
    const content = container;
    const prev = containerStack.pop();
    ({ container, runs, table, row, curCell, rowDef, cellDef } = prev);
    if (name.startsWith('header')) { if (name === 'headerf') sec.headerFirst = content; else if (name === 'headerl') sec.headerEven = content; else sec.header = content; }
    else if (name === 'footer' || name === 'footerr') sec.footer = content;
  }
  function endParagraphIn(s) { endParagraph(s.para, false); }
  function flushPendingBefore() { /* 머리글은 문단 중간에 오지 않는다고 본다 */ }

  function beginNote() {
    containerStack.push({ container, runs, table, row, curCell, rowDef, cellDef });
    container = []; runs = []; table = null; row = null; curCell = null;
  }
  function endNote() {
    endParagraph(st.para, false); flushTable();
    const content = container;
    const prev = containerStack.pop();
    ({ container, runs, table, row, curCell, rowDef, cellDef } = prev);
    const id = ++noteSeq;
    runs.push({ type: 'footnote_ref', note_id: id });
    footnotes.push({ type: 'footnote', id, content: content.length ? content : [{ type: 'paragraph', content: [] }] });
  }

  // 필드
  function startField() { fldState = { instr: '', rsltRuns: null, saved: runs, depth: stack.length }; runs = []; fldState.collect = true; }
  function finishField() {
    const f = fldState; fldState = null;
    const instr = f.instr.trim();
    const kind = /^(PAGE|NUMPAGES|SECTIONPAGES)\b/i.exec(instr);
    const sentinel = kind ? ({ PAGE: 'P', NUMPAGES: 'N', SECTIONPAGES: 'S' })[kind[1].toUpperCase()] : null;
    const result = runs; runs = f.saved;
    if (sentinel) {
      const fmt = /\\\*\s*(roman|ROMAN|alphabetic|ALPHABETIC|arabic)/.exec(instr);
      const base = result[0] ?? charRun('', st.char);
      runs.push({ ...base, type: 'text', text: `${sentinel}${fmt ? ':' + fmt[1] : ''}` });
    } else {
      const link = /^HYPERLINK\s+"([^"]*)"/i.exec(instr);
      for (const r of result) { if (link && r.type === 'text') r.hyperlink = link[1]; runs.push(r); }
    }
  }

  // ── 그림 ──
  function finishPict() {
    const p = picState; picState = null;
    if (!p || !p.fmt) return;
    let bytes = p.bin;
    if (!bytes) {
      const hex = p.hex; const len = hex.length >> 1;
      if (len > MAX_IMAGE) { warn.add('큰 그림은 건너뛰었다'); return; }
      bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = (hex[2 * i] << 4) | hex[2 * i + 1];
    }
    if (!bytes.length) return;
    const wTw = p.goalw ? p.goalw * (p.sx / 100) : (p.w * 56.7) * (p.sx / 100);
    const hTw = p.goalh ? p.goalh * (p.sy / 100) : (p.h * 56.7) * (p.sy / 100);
    if (!(wTw > 0 && hTw > 0)) return;
    const img = { type: 'image', format: p.fmt, data: b64(bytes), display_width_emu: Math.round(clamp(wTw, 1, 200000) * 635), display_height_emu: Math.round(clamp(hTw, 1, 200000) * 635), positioning: 'inline' };
    runs.push(img);
  }

  // ── 표 정의 ──
  const rowBorderWords = new Set(['trbrdrt', 'trbrdrl', 'trbrdrb', 'trbrdrr', 'trbrdrh', 'trbrdrv']);
  let curBorderSide = null;      // 'top'|'left'|'bottom'|'right' (셀 경계 정의 중)
  let curBorder = null;
  const sideOf = { clbrdrt: 'top', clbrdrl: 'left', clbrdrb: 'bottom', clbrdrr: 'right' };

  function tableControl(word, n, hasN) {
    switch (word) {
      case 'trowd':
        // Word는 \row 바로 앞에서 행 정의를 한 번 더 쓴다. 셀이 이미 쌓인 행이면 정의만 바꾸고 셀 내용은 둔다.
        if (row && row.cells.length) { row.defs = []; } else row = { defs: [], cells: [], header: false };
        rowDef = row.defs; cellDef = { x: 0 }; curCell = null; curBorderSide = null; return true;
      case 'trhdr': if (row) row.header = true; return true;
      case 'trautofit': if (row) row.autofit = n !== 0 || !hasN; return true;
      case 'clwWidth': if (cellDef) cellDef.pref = n; return true;
      case 'clcbpat': if (cellDef) { const c = colors[n]; if (c) cellDef.bg = c; } return true;
      case 'clvmgf': if (cellDef) cellDef.vmgf = true; return true;
      case 'clvmrg': if (cellDef) cellDef.vmrg = true; return true;
      case 'clmgf': if (cellDef) cellDef.hmgf = true; return true;
      case 'clmrg': if (cellDef) cellDef.hmrg = true; return true;
      case 'clvertalc': if (cellDef) cellDef.va = 'center'; return true;
      case 'clvertalb': if (cellDef) cellDef.va = 'bottom'; return true;
      case 'clbrdrt': case 'clbrdrl': case 'clbrdrb': case 'clbrdrr':
        curBorderSide = sideOf[word]; if (cellDef) { cellDef.border = cellDef.border ?? {}; cellDef.border[curBorderSide] = { style: 'none', size: 4 }; } return true;
      case 'brdrs': case 'brdrdb': case 'brdrdot': case 'brdrdash': case 'brdrth': if (cellDef && curBorderSide) cellDef.border[curBorderSide].style = word === 'brdrdb' ? 'double' : 'single'; return true;
      case 'brdrnil': case 'brdrnone': if (cellDef && curBorderSide) cellDef.border[curBorderSide].style = 'none'; return true;
      case 'brdrw': if (cellDef && curBorderSide) cellDef.border[curBorderSide].size = Math.max(1, Math.round(n * 0.4)); return true;   // twips → 1/8pt
      case 'brdrcf': if (cellDef && curBorderSide) { const c = colors[n] ?? [0, 0, 0]; cellDef.border[curBorderSide].color = c; } return true;
      case 'cellx': if (row && cellDef) { cellDef.x = n; if (row.defs.length < MAX_CELLS_PER_ROW) row.defs.push(cellDef); cellDef = { x: n }; curBorderSide = null; } return true;
      case 'cell': endCell(); return true;
      case 'nestcell': endCell(); return true;
      case 'row': case 'nestrow': endCell(true); finishRow(); return true;
      default: return false;
    }
  }
  function endCell(onRow) {
    if (!row) return;
    // 셀 안의 마지막 문단을 닫는다
    const cell = [];
    const saved = curCell; curCell = cell;
    if (hasContent() || !onRow) endParagraph(st.para, !onRow && !hasContent());
    curCell = saved;
    if (!onRow) { row.cells.push(cell); curCell = null; }
  }

  // ── 본 루프 ──
  const popGroup = () => {
    flushBytes();
    const ending = st;
    if (stack.length === 0) return false;
    // 목적지 종료 처리
    if (!ending.skip) {
      if (ending.hfName && ending.dest === 'doc') endHF(ending.hfName);
      else if (ending.dest === 'footnote' && ending.isNoteRoot) endNote();
      else if (ending.dest === 'pict' && ending.isPictRoot) finishPict();
      else if (ending.dest === 'fldinst' && fldState) fldState.instr = instrBuf;
      else if (ending.isFieldRoot && fldState) finishField();
      else if (ending.dest === 'fonttbl' && ending.fontRoot) { /* 글꼴 항목은 개별 그룹에서 이미 저장 */ }
      else if (ending.fontEntryRoot && fontEntry) { fonts.set(fontEntry.id, { name: fontEntry.name ?? '', cp: fontEntry.cp }); fontEntry = null; }
      else if (ending.styleRoot && styleEntry) { styles.set(styleEntry.id, styleEntry); styleEntry = null; }
    }
    st = stack.pop();
    return true;
  };

  const pushGroup = () => {
    if (stack.length >= MAX_DEPTH) throw new Error('too deep');
    flushBytes();
    stack.push(st);
    st = { char: { ...st.char }, para: { ...st.para, tabs: st.para.tabs.slice() }, uc: st.uc, cp: st.cp, dest: st.dest, skip: st.skip, hfName: null, isNoteRoot: false, isPictRoot: false, isFieldRoot: false, fontEntryRoot: false, styleRoot: false, fontRoot: false, hf: st.hf };
    ucSkipPending = 0;
  };

  const isLetter = (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
  const isDigit = (c) => c >= 48 && c <= 57;
  let groupStart = false;             // 방금 '{'를 만났다(첫 제어어가 목적지 이름일 수 있다)
  let starred = false;
  let startedDest = false;

  try {
    while (pos < N) {
      const ch = data[pos];
      if (ch === 0x7b) { pos++; pushGroup(); groupStart = true; starred = false; startedDest = false; continue; }
      if (ch === 0x7d) { pos++; groupStart = false; if (!popGroup()) break; continue; }
      if (ch === 0x5c) {
        pos++;
        const c = data[pos];
        if (c === undefined) break;
        if (isLetter(c)) {
          let s = pos; while (pos < N && isLetter(data[pos])) pos++;
          const word = String.fromCharCode(...data.subarray(s, pos));
          let n = 0, hasN = false;
          if (data[pos] === 0x2d || isDigit(data[pos])) {
            let neg = false; if (data[pos] === 0x2d) { neg = true; pos++; }
            let v = 0, digits = 0; while (pos < N && isDigit(data[pos]) && digits < 10) { v = v * 10 + (data[pos] - 48); pos++; digits++; }
            n = neg ? -v : v; hasN = digits > 0;
          }
          if (data[pos] === 0x20) pos++;     // 제어어 뒤의 구분 공백 하나
          const first = groupStart; groupStart = false;
          if (first && !startedDest && st.dest !== 'skipdone') {
            // 그룹의 첫 제어어: 목적지 이름인지 확인
            const known = ['fonttbl', 'colortbl', 'stylesheet', 'header', 'headerr', 'headerl', 'headerf', 'footer', 'footerr', 'footerl', 'footerf', 'footnote', 'pict', 'shppict', 'field', 'fldinst', 'fldrslt', 'listtext', 'pntext'];
            const ignorable = ['nonshppict', 'info', 'generator', 'listtable', 'listoverridetable', 'pn', 'pnseclvl', 'revtbl', 'rsidtbl', 'mmathPr', 'latentstyles', 'themedata', 'colorschememapping', 'datastore', 'xmlnstbl', 'userprops', 'docvar', 'fchars', 'lchars', 'bkmkstart', 'bkmkend', 'shpinst', 'shprslt', 'object', 'objdata', 'stylesheet2'];
            // \*는 "모르면 그룹째 무시"라는 표시다(RTF 규격). 아는 목적지만 읽고, 나머지는 건너뛴다.
            if (known.includes(word) || ignorable.includes(word) || starred) {
              startedDest = true;
              if (st.dest === 'fonttbl' && word === 'f') { /* 글꼴 항목 */ }
              else {
                const rootFlags = { hfName: null, isNoteRoot: false, isPictRoot: false, isFieldRoot: false };
                enterDest(word, starred);
                if (!st.skip) {
                  if (word.startsWith('header') || word.startsWith('footer')) st.hfName = word;
                  if (word === 'footnote') st.isNoteRoot = true;
                  if (word === 'pict') st.isPictRoot = true;
                  if (word === 'field') st.isFieldRoot = true;
                }
                void rootFlags;
                continue;
              }
            }
          }
          if (st.skip) { if (word === 'bin' && hasN) pos += Math.max(0, n) + 0; continue; }
          // 글꼴표·색표·스타일시트 안의 제어어
          if (st.dest === 'fonttbl') {
            if (word === 'f') { fontEntry = { id: n, name: '', cp: null }; st.fontEntryRoot = true; }
            else if (word === 'fcharset' && fontEntry) fontEntry.cp = CHARSET_CP[n] ?? null;
            continue;
          }
          if (st.dest === 'colortbl') {
            if (word === 'red') colorBuf.r = n; else if (word === 'green') colorBuf.g = n; else if (word === 'blue') colorBuf.b = n;
            continue;
          }
          if (st.dest === 'stylesheet') {
            if (word === 's' && !styleEntry) { styleEntry = { id: n, name: '', tokens: [], basedon: null }; st.styleRoot = true; }
            else if (styleEntry && word === 'basedon') styleEntry.basedon = n;
            else if (styleEntry && ['sbasedon', 'snext', 'sautoupd', 'additive', 'ssemihidden', 'styrsid', 'sqformat', 'spriority', 'slink', 'sunhideused', 'sbasedon'].includes(word)) { /* 무시 */ }
            else if (styleEntry) styleEntry.tokens.push([word, n, hasN]);
            continue;
          }
          if (st.dest === 'pict' && picState) {
            if (word === 'jpegblip') picState.fmt = 'jpeg'; else if (word === 'pngblip') picState.fmt = 'png';
            else if (word === 'emfblip' || word === 'wmetafile' || word === 'macpict' || word === 'pmmetafile' || word === 'dibitmap' || word === 'wbitmap') picState.fmt = picState.fmt ?? 'wmf';
            else if (word === 'picwgoal') picState.goalw = n; else if (word === 'pichgoal') picState.goalh = n;
            else if (word === 'picw') picState.w = n; else if (word === 'pich') picState.h = n;
            else if (word === 'picscalex') picState.sx = n || 100; else if (word === 'picscaley') picState.sy = n || 100;
            else if (word === 'bin' && hasN) { const len = clamp(n, 0, MAX_IMAGE + 1); if (len > MAX_IMAGE) { warn.add('큰 그림은 건너뛰었다'); } else picState.bin = data.slice(pos, pos + len); pos += len; }
            continue;
          }
          if (st.dest === 'fldinst' || st.dest === 'colortbl') continue;
          // 일반 본문 제어어
          if (word === 'uc') { st.uc = clamp(n, 0, 8); continue; }
          if (word === 'u') {
            flushBytes();
            let code = n < 0 ? n + 65536 : n; code = code & 0xffff;
            emitText(String.fromCharCode(code));
            skipLeft = st.uc;      // 대체 글자(보통 '?')를 건너뛴다
            continue;
          }
          if (tableControl(word, n, hasN)) { continue; }
          if (word === 'ansicpg') { doc.cp = n; st.cp = CP_LABEL[n] ? n : 1252; if (stack.length <= 1) root.cp = st.cp; continue; }
          if (word === 'deff') { doc.deff = n; continue; }
          if (word === 'paperw') { doc.paperw = n; continue; } if (word === 'paperh') { doc.paperh = n; continue; }
          if (word === 'margl') { doc.margl = n; continue; } if (word === 'margr') { doc.margr = n; continue; }
          if (word === 'margt') { doc.margt = n; continue; } if (word === 'margb') { doc.margb = n; continue; }
          if (word === 'headery') { doc.headery = n; continue; } if (word === 'footery') { doc.footery = n; continue; }
          if (word === 'landscape') { doc.landscape = true; continue; }
          if (word === 'facingp') { doc.facingp = true; continue; }
          if (word === 'titlepg') { sec.titlepg = true; doc.titlepg = true; continue; }
          if (word === 'pgwsxn') { sec.override.pgw = n; continue; } if (word === 'pghsxn') { sec.override.pgh = n; continue; }
          if (word === 'marglsxn') { sec.override.ml = n; continue; } if (word === 'margrsxn') { sec.override.mr = n; continue; }
          if (word === 'margtsxn') { sec.override.mt = n; continue; } if (word === 'margbsxn') { sec.override.mb = n; continue; }
          if (word === 'lndscpsxn') { sec.override.landscape = true; continue; }
          if (word === 'pgnstarts') { (stack.length <= 2 ? doc : sec.override).pgnstart = n; sec.override.pgnstart = n; continue; }
          if (word === 'pgndec') { sec.override.pgnfmt = 'decimal'; continue; } if (word === 'pgnlcrm') { sec.override.pgnfmt = 'lowerRoman'; continue; } if (word === 'pgnucrm') { sec.override.pgnfmt = 'upperRoman'; continue; }
          if (word === 'pgnlcltr') { sec.override.pgnfmt = 'lowerLetter'; continue; } if (word === 'pgnucltr') { sec.override.pgnfmt = 'upperLetter'; continue; }
          if (word === 'sectd') { sec.override = {}; continue; }
          if (word === 'sbknone') { sec.brk = 'continuous'; continue; } if (word === 'sbkpage') { sec.brk = 'next_page'; continue; }
          if (word === 'sbkeven') { sec.brk = 'even_page'; continue; } if (word === 'sbkodd') { sec.brk = 'odd_page'; continue; }
          if (word === 'sect') { finishSection(false); continue; }
          if (word === 'par') { endParagraph(st.para, true); st.para.tabs = st.para.tabs; continue; }
          if (word === 'line') { runs.push({ type: 'line_break' }); continue; }
          if (word === 'tab') { addText('\t', st.char); continue; }
          if (word === 'page') { endParagraph(st.para, false); if (!curCell) { flushTable(); push(container, { type: 'page_break' }); } continue; }
          if (word === 'cell' || word === 'row') continue;
          if (word === 'ltrch' || word === 'rtlch' || word === 'loch' || word === 'hich' || word === 'dbch' || word === 'ltrpar' || word === 'rtlpar') continue;
          if (word === 's') { applyStyle(n, st); continue; }
          if (SYMBOL[word]) { addText(SYMBOL[word], st.char); continue; }
          if (word === 'bin' && hasN) { pos += clamp(n, 0, N); continue; }
          if (!applyFormat(word, n, hasN, st)) { /* 알 수 없는 제어어는 무시 */ }
          continue;
        }
        // 제어 기호
        pos++;
        groupStart = false;
        if (c === 0x27) {                       // \'hh
          const h = (data[pos] ?? 0), l = (data[pos + 1] ?? 0);
          const hv = (x) => (x >= 48 && x <= 57 ? x - 48 : x >= 97 && x <= 102 ? x - 87 : x >= 65 && x <= 70 ? x - 55 : -1);
          if (hv(h) >= 0 && hv(l) >= 0) { pos += 2; if (skipLeft > 0) { skipLeft--; continue; } if (!st.skip) pendingBytes.push(hv(h) * 16 + hv(l)); }
          continue;
        }
        if (st.skip) continue;
        if (c === 0x2a) { starred = true; groupStart = true; continue; }    // \*: 다음 제어어가 목적지 이름
        flushBytes();
        if (c === 0x5c || c === 0x7b || c === 0x7d) { if (skipLeft > 0) { skipLeft--; continue; } emitText(String.fromCharCode(c)); }
        else if (c === 0x7e) emitText(' ');
        else if (c === 0x2d) { /* 선택적 하이픈 */ }
        else if (c === 0x5f) emitText('‑');
        else if (c === 0x0a || c === 0x0d) endParagraph(st.para, true);
        continue;
      }
      // 일반 글자
      groupStart = false;
      if (ch === 0x0a || ch === 0x0d) { pos++; continue; }
      if (st.skip) { pos++; continue; }
      if (st.dest === 'colortbl' && ch === 0x3b) { pos++; if (colorBuf) { colors.push(colorBuf.r == null ? null : [clamp(colorBuf.r, 0, 255), clamp(colorBuf.g ?? 0, 0, 255), clamp(colorBuf.b ?? 0, 0, 255)]); colorBuf = { r: null, g: null, b: null }; } continue; }
      if (st.dest === 'pict' && picState) {
        // 16진 그림 데이터
        const hv = (x) => (x >= 48 && x <= 57 ? x - 48 : x >= 97 && x <= 102 ? x - 87 : x >= 65 && x <= 70 ? x - 55 : -1);
        const v = hv(ch); pos++;
        if (v >= 0 && picState.hex.length < MAX_IMAGE * 2) picState.hex.push(v);
        continue;
      }
      if (skipLeft > 0) { skipLeft--; pos++; continue; }
      if (ch >= 0x80) { pendingBytes.push(ch); pos++; continue; }
      if (pendingBytes.length) flushBytes();
      // ASCII 글자는 모아서 한 번에
      let e = pos; while (e < N && data[e] < 0x80 && data[e] !== 0x5c && data[e] !== 0x7b && data[e] !== 0x7d && data[e] !== 0x0a && data[e] !== 0x0d && !(st.dest === 'colortbl' && data[e] === 0x3b) && !(st.dest === 'pict') && skipLeft === 0) e++;
      if (e === pos) e = pos + 1;
      emitText(String.fromCharCode(...data.subarray(pos, e)));
      pos = e;
    }
    flushBytes();
  } catch (e) {
    if (!/too (deep|many|much)/.test(String(e && e.message))) throw e;
    warn.add(`입력이 너무 커서 일부만 읽었다(${e.message})`);
  }

  // 남은 글자 정리 후 마지막 구역
  try { st = st; if (curCell == null) { endParagraph(st.para, false); flushTable(); } } catch { /* 상한 초과 */ }
  finishSection(true);
  if (footnotes.length) sections[sections.length - 1].elements.push(...footnotes);
  // 내용 없는 구역은 뺀다. 문서가 \sect로 끝나면 빈 마지막 구역이 생기는데, 남기면 머리글·바닥글만 있는 빈 쪽이 하나 더 붙는다.
  // 머리글·바닥글은 다음 구역으로 이어지므로 뺀 구역 때문에 잃는 것은 없다. 전부 비었으면 마지막 하나는 남긴다.
  const kept = sections.filter((s) => s.elements.length);
  const out = kept.length ? kept : sections.slice(-1);
  return { ir: { metadata: { format: 'rtf' }, sections: out }, warnings: [...warn] };
}
