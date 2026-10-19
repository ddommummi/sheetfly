// 흐름 배치: 문단·목록·표를 쪽에 채운다. 쪽을 넘기는 곳(본문)과 넘기지 않는 곳(표 칸, 머리글)을 같은 코드로 다룬다.
import { twipsToPx, emuToPx, rgb } from './units.js';
import { layoutParagraph, runStyle, inlineTokens, DEFAULT_HALF_PT } from './paragraph.js';
import { formatNumber } from './text.js';

const MAX_PAGES = 5000;
const MAX_ITEMS_PER_PAGE = 60000;
const EPS = 0.01;
const BULLETS = ['•', '◦', '▪'];

/** 쪽을 넘기지 않는 구획용 흐름(표 칸·머리글). items는 구획 원점 기준 좌표. */
export function scratchFlow(width) { return { x0: 0, width, y: 0, top: 0, bottom: Infinity, items: [], paginated: false, newPage() {} }; }

function pushRect(items, x, y, w, h, fill) { if (w > 0 && h > 0) items.push({ k: 'r', x, y, w, h, fill }); }
function pushLine(items, x1, y1, x2, y2, w, color) { items.push({ k: 'l', x1, y1, x2, y2, w, color }); }
const HIGHLIGHT = {  // 이름 형광펜(IR은 RGB 배열도 준다)
  yellow: '#ffff00', green: '#00ff00', cyan: '#00ffff', magenta: '#ff00ff', blue: '#0000ff', red: '#ff0000', darkBlue: '#000080', darkCyan: '#008080', darkGreen: '#008000', darkMagenta: '#800080', darkRed: '#800000', darkYellow: '#808000', darkGray: '#808080', lightGray: '#c0c0c0', black: '#000000', white: '#ffffff' };

/** 줄 하나를 표시 항목으로 낸다. y는 줄 윗면. */
function emitLine(items, line, x0, y, par) {
  const dx = x0 + (line.dx || 0);
  for (const it of line.items) {
    const x = dx + it.x;
    if (it.k === 'tx') {
      const st = it.st;
      const by = y + line.base + (st.shift || 0);
      if (st.highlight) pushRect(items, x, y, it.w, line.height, (HIGHLIGHT[st.highlight] ?? st.highlight));
      items.push({ k: 't', x, y: by, s: it.text, font: it.font, fill: st.color, ls: st.spacing || 0, w: it.w, top: y, lh: line.height, link: st.link || undefined });
      const th = Math.max(1, st.px / 16);
      if (st.underline && st.underline !== 'none') {
        pushRect(items, x, by + st.px * 0.12, it.w, th, st.color);
        if (st.underline === 'double') pushRect(items, x, by + st.px * 0.12 + th * 2, it.w, th, st.color);
      }
      if (st.strike) pushRect(items, x, by - st.px * 0.3, it.w, th, st.color);
    } else if (it.k === 'sp') {
      const st = it.st;
      if (st.highlight) pushRect(items, x, y, it.w, line.height, (HIGHLIGHT[st.highlight] ?? st.highlight));
      if (st.underline && st.underline !== 'none') pushRect(items, x, y + line.base + st.px * 0.12 + (st.shift || 0), it.w, Math.max(1, st.px / 16), st.color);
    } else if (it.k === 'tab' && it.leader && it.leader !== 'none' && it.w > 4) {
      const ch = it.leader === 'dot' ? '.' : it.leader === 'hyphen' ? '-' : '_';
      items.push({ k: 'leader', x, y: y + line.base, w: it.w, ch, font: it.font, fill: it.color });
    } else if (it.k === 'img') {
      items.push({ k: 'i', x, y: y + line.base - it.h, w: it.w, h: it.h, img: it.img });
    }
  }
}

function borderStyle(b) {
  if (!b) return null;
  const st = String(b.style || 'single').toLowerCase();
  if (st === 'none' || st === 'nil') return null;
  return { w: Math.max(0.5, (b.size ?? 4) / 6), color: rgb(b.color) ?? '#000000' };
}

/** 문단 한 칸(조각)의 배경·테두리. */
function paragraphBox(items, par, x0, w, top, bottom) {
  if (par.background) pushRect(items, x0 + par.left, top, w - par.left - par.right, bottom - top, par.background);
  const b = par.border;
  if (b) {
    const l = x0 + par.left, r = x0 + w - par.right;
    const s = (e) => borderStyle(b[e]);
    if (s('top')) pushLine(items, l, top, r, top, s('top').w, s('top').color);
    if (s('bottom')) pushLine(items, l, bottom, r, bottom, s('bottom').w, s('bottom').color);
    if (s('left')) pushLine(items, l, top, l, bottom, s('left').w, s('left').color);
    if (s('right')) pushLine(items, r, top, r, bottom, s('right').w, s('right').color);
  }
}

/** 문단을 흐름에 놓는다. 쪽 경계에서 줄 단위로 나누며 과부/고아 줄(2줄)과 keep_together를 지킨다. */
export function placeParagraph(par, flow, st) {
  const lines = par.lines;
  const n = lines.length;
  let i = 0;
  let before = par.before;
  if (st.atTop && flow.paginated) before = 0;
  while (i < n) {
    const avail = flow.bottom - flow.y - (i === 0 ? before : 0);
    let k = 0, h = 0;
    while (i + k < n && h + lines[i + k].height <= avail + EPS) { h += lines[i + k].height; k++; }
    const remaining = n - i;
    if (flow.paginated && k < remaining) {
      // 쪽 경계: 한 줄만 남기거나 한 줄만 넘기지 않도록 조정
      if (par.keepTogether && i === 0) k = 0;
      else if (remaining >= 4) {
        if (i === 0 && k < 2) k = 0;
        else if (remaining - k < 2) k = Math.max(0, remaining - 2);
      } else if (i === 0 && remaining < 4) k = 0;
    }
    if (k === 0) {
      if (flow.paginated && !st.atTop) { flow.newPage(); st.atTop = true; before = 0; continue; }
      k = 1;   // 빈 쪽에도 안 들어가면 강제로 한 줄
    }
    const top = flow.y + (i === 0 ? before : 0);
    let y = top;
    for (let j = 0; j < k; j++) { emitLine(flow.items, lines[i + j], flow.x0, y, par); y += lines[i + j].height; }
    paragraphBox(flow.items, par, flow.x0, flow.width, top, y);
    flow.y = y;
    st.atTop = false;
    i += k;
    if (i < n && flow.paginated) { flow.newPage(); st.atTop = true; before = 0; }
  }
  flow.y += par.after;
  st.lastAfter = par.after;
}

// ── 목록 ───────────────────────────────────────────────────────────────
function markerFor(list, level, counters, parents) {
  if (!list.ordered) return BULLETS[level % BULLETS.length];
  const style = list.style;
  const nums = [...parents, counters];
  if (list.marker_pattern) {
    return list.marker_pattern.replace(/%(\d)/g, (_, d) => { const k = +d - 1; return k < nums.length ? formatNumber(nums[k], k === nums.length - 1 ? style : 'decimal') : ''; });
  }
  return `${formatNumber(counters, style)}.`;
}

/** 목록을 문단 목록(마커 포함)으로 펼친다. */
export function flattenList(list, level = 0, parents = []) {
  const out = [];
  let counter = (list.start_number ?? 1) - 1;
  for (const item of list.items ?? []) {
    counter++;
    const marker = markerFor(list.nested ? list : list, level, counter, parents);
    const paras = (item.content ?? []).filter((e) => e.type === 'paragraph' || e.type === 'heading');
    let first = true;
    for (const p of paras) {
      out.push({ p, level, marker: first ? marker : null }); first = false;
    }
    if (!paras.length) out.push({ p: { type: 'paragraph', content: [] }, level, marker });
    if (item.nested) out.push(...flattenList({ ...item.nested, start_number: item.nested.start_number }, level + 1, [...parents, counter]));
  }
  return out;
}

// ── 표 ─────────────────────────────────────────────────────────────────
// 셀 내용이 줄바꿈 없이 차지하는 폭(max)과 더는 줄일 수 없는 폭(min). 자동 맞춤 표의 열 폭 계산용.
function contentExtent(content, ctx) {
  let min = 0, max = 0;
  for (const el of content ?? []) {
    if (el.type === 'paragraph' || el.type === 'heading') {
      const tokens = inlineTokens(el.content, ctx.measure, ctx.notes);
      let line = 0;
      for (const t of tokens) {
        if (t.kind === 'br') { max = Math.max(max, line); line = 0; continue; }
        line += t.w || 0;
        if (t.kind !== 'space' && t.kind !== 'tab') min = Math.max(min, t.w || 0);
      }
      const ind = twipsToPx((el.indent_left_twips || 0) + (el.indent_right_twips || 0));
      max = Math.max(max, line + ind); min += 0;
    } else if (el.type === 'list') {
      for (const { p, level } of flattenList(el)) {
        const sub = contentExtent([p], ctx); const ind = twipsToPx(720 * (level + 1));
        min = Math.max(min, sub.min + ind); max = Math.max(max, sub.max + ind);
      }
    }
  }
  return { min, max };
}

/** 셀 너비가 지정되지 않은(자동 맞춤) 표의 열 폭: 내용이 한 줄에 들어가면 그 폭, 아니면 가용 폭을 배분. */
function autofitGrid(tbl, width, grid, padLR, ctx) {
  const rows = tbl.rows ?? [];
  const n = grid.length;
  const min = Array(n).fill(0), max = Array(n).fill(0);
  const occupied = [];
  const spans = [];
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] ?? new Set();
    let c = 0;
    for (const cell of row.cells ?? []) {
      while (occupied[r].has(c)) c++;
      const cs = Math.max(1, cell.col_span || 1), rs = Math.max(1, cell.row_span || 1);
      for (let dr = 0; dr < rs; dr++) { occupied[r + dr] = occupied[r + dr] ?? new Set(); for (let dc = 0; dc < cs; dc++) occupied[r + dr].add(c + dc); }
      const e = contentExtent(cell.content, ctx);
      if (cs === 1 && c < n) { min[c] = Math.max(min[c], e.min + padLR); max[c] = Math.max(max[c], e.max + padLR); }
      else spans.push({ c, cs, min: e.min + padLR, max: e.max + padLR });
      c += cs;
    }
  });
  for (const sp of spans) {
    const have = (arr) => { let t = 0; for (let i = sp.c; i < Math.min(n, sp.c + sp.cs); i++) t += arr[i]; return t; };
    for (const [arr, need] of [[min, sp.min], [max, sp.max]]) {
      const d = need - have(arr);
      if (d > 0) for (let i = sp.c; i < Math.min(n, sp.c + sp.cs); i++) arr[i] += d / sp.cs;
    }
  }
  const sumMax = max.reduce((a, b) => a + b, 0), sumMin = min.reduce((a, b) => a + b, 0);
  if (sumMax <= width) return max.map((m, i) => Math.max(m, min[i]));
  if (sumMin >= width) return min.slice();
  const extra = width - sumMin, span = sumMax - sumMin;
  return min.map((m, i) => m + (extra * (max[i] - m)) / span);
}

/** 고정 레이아웃 표: 격자값이 아니라 셀 너비(tcW)로 열 폭을 정한다 (Word가 그렇게 한다). */
function fixedGrid(tbl, grid, width) {
  const n = grid.length;
  const w = Array(n).fill(null);
  const occupied = [];
  (tbl.rows ?? []).forEach((row, r) => {
    occupied[r] = occupied[r] ?? new Set();
    let c = 0;
    for (const cell of row.cells ?? []) {
      while (occupied[r].has(c)) c++;
      const cs = Math.max(1, cell.col_span || 1), rs = Math.max(1, cell.row_span || 1);
      for (let dr = 0; dr < rs; dr++) { occupied[r + dr] = occupied[r + dr] ?? new Set(); for (let dc = 0; dc < cs; dc++) occupied[r + dr].add(c + dc); }
      if (cell.width_twips) {
        const px = twipsToPx(cell.width_twips);
        if (cs === 1 && c < n && w[c] == null) w[c] = px;
        else if (cs > 1) { const free = []; for (let i = c; i < Math.min(n, c + cs); i++) if (w[i] == null) free.push(i); if (free.length === cs) for (const i of free) w[i] = px / cs; }
      }
      c += cs;
    }
  });
  let out = w.map((v, i) => (v == null ? grid[i] : v));
  const sum = out.reduce((a, b) => a + b, 0);
  if (sum > width * 1.005 && sum > 0) out = out.map((c) => (c * width) / sum);
  return out;
}

function gridOf(tbl, width) {
  let cols = (tbl.column_widths_twips ?? []).map(twipsToPx);
  if (!cols.length) {
    const first = tbl.rows?.[0]?.cells ?? [];
    cols = first.flatMap((c) => Array(c.col_span || 1).fill(twipsToPx(c.width_twips || 1440) / (c.col_span || 1)));
  }
  const sum = cols.reduce((a, b) => a + b, 0);
  if (sum > width * 1.005 && sum > 0) cols = cols.map((c) => (c * width) / sum);
  return cols;
}

const MAX_SPAN = 1000;
/** 칸 병합 값이 터무니없으면(손상·악의적 문서) 반복문이 사실상 끝나지 않으므로 행·열 수 안으로 줄인다. */
function normalizeTable(tbl) {
  const rows = tbl.rows ?? [];
  const sane = (c) => (c.col_span ?? 1) >= 1 && (c.col_span ?? 1) <= MAX_SPAN && (c.row_span ?? 1) >= 1 && (c.row_span ?? 1) <= rows.length;
  if (rows.every((r) => (r.cells ?? []).every(sane))) return tbl;
  const clamp = (v, hi) => (Number.isFinite(v) ? Math.max(1, Math.min(hi, Math.floor(v))) : 1);
  return { ...tbl, rows: rows.map((r) => ({ ...r, cells: (r.cells ?? []).map((c) => (sane(c) ? c : { ...c, col_span: clamp(c.col_span ?? 1, MAX_SPAN), row_span: clamp(c.row_span ?? 1, Math.max(1, rows.length)) })) })) };
}

/** 자동 맞춤 표가 한 줄씩 다 펴졌을 때의 너비(px). 시트를 쪽 너비에 맞춰 키울 때 쓴다. */
export function naturalTableWidth(tbl, ctx) {
  tbl = normalizeTable(tbl);
  const grid = gridOf(tbl, Infinity);
  if (!grid.length) return 0;
  const cpx = tbl.cell_padding_twips;
  const lr = typeof cpx === 'number' ? twipsToPx(cpx) * 2 : twipsToPx((cpx?.left_twips ?? 108) + (cpx?.right_twips ?? 108));
  return autofitGrid(tbl, Infinity, grid, lr, ctx).reduce((a, b) => a + b, 0);
}

function placeTable(tbl, flow, st, ctx) {
  tbl = normalizeTable(tbl);
  let grid = gridOf(tbl, flow.width);
  const autoWidth = !(tbl.rows ?? []).some((r) => (r.cells ?? []).some((c) => c.width_twips));
  if (autoWidth && grid.length) {
    const cpx = tbl.cell_padding_twips;
    const lr = typeof cpx === 'number' ? twipsToPx(cpx) * 2 : twipsToPx((cpx?.left_twips ?? 108) + (cpx?.right_twips ?? 108));
    grid = autofitGrid(tbl, flow.width, grid, lr, ctx);
  } else if (!autoWidth) {
    grid = fixedGrid(tbl, grid, flow.width);
  }
  const gridW = grid.reduce((a, b) => a + b, 0);
  // IR는 표 셀 여백을 숫자(모든 변 같음) 또는 { top/left/bottom/right_twips }로 준다
  const cp = tbl.cell_padding_twips;
  const pad = typeof cp === 'number' ? { left_twips: cp, right_twips: cp, top_twips: cp, bottom_twips: cp } : (cp ?? {});
  const padL = twipsToPx(pad.left_twips ?? 108), padR = twipsToPx(pad.right_twips ?? 108);
  const padT = twipsToPx(pad.top_twips ?? 0), padB = twipsToPx(pad.bottom_twips ?? 0);
  const colX = [0]; for (const c of grid) colX.push(colX[colX.length - 1] + c);
  const rows = tbl.rows ?? [];
  // 각 셀의 시작 열 계산(행 병합 고려)
  const occupied = []; // occupied[r] = Set(col)
  const cells = [];
  rows.forEach((row, r) => {
    occupied[r] = occupied[r] ?? new Set();
    let c = 0;
    for (const cell of row.cells ?? []) {
      while (occupied[r].has(c)) c++;
      const cs = Math.max(1, cell.col_span || 1), rs = Math.max(1, cell.row_span || 1);
      for (let dr = 0; dr < rs; dr++) { occupied[r + dr] = occupied[r + dr] ?? new Set(); for (let dc = 0; dc < cs; dc++) occupied[r + dr].add(c + dc); }
      cells.push({ cell, r, c, cs, rs });
      c += cs;
    }
  });
  // 셀 내용 조판 (칸 원점 기준)
  for (const cc of cells) {
    const x = colX[Math.min(cc.c, grid.length)], x2 = colX[Math.min(cc.c + cc.cs, grid.length)];
    cc.x = x; cc.w = Math.max(1, x2 - x);
    const inner = scratchFlow(Math.max(1, cc.w - padL - padR));
    placeBlocks(cc.cell.content ?? [], inner, { ...ctx, depth: (ctx.depth || 0) + 1 });
    cc.items = inner.items; cc.h = inner.y + padT + padB;
  }
  // 행 높이: 병합 없는 셀로 먼저, 병합 셀은 부족분을 마지막 행에 얹는다
  const rh = rows.map(() => 0);
  for (const cc of cells) if (cc.rs === 1) rh[cc.r] = Math.max(rh[cc.r], cc.h);
  for (const cc of cells) if (cc.rs > 1) {
    const have = rh.slice(cc.r, cc.r + cc.rs).reduce((a, b) => a + b, 0);
    if (cc.h > have) rh[Math.min(cc.r + cc.rs - 1, rows.length - 1)] += cc.h - have;
  }
  const rowTop = [0]; for (const h of rh) rowTop.push(rowTop[rowTop.length - 1] + h);
  // 행별 색인: 큰 표(수천 행)에서 쪽마다 모든 셀을 훑으면 제곱으로 느려진다
  const byRow = rows.map(() => []);
  for (const cc of cells) if (cc.r < rows.length) byRow[cc.r].push(cc);
  const reach = rows.map((_, i) => i + 1);                           // reach[r]: r에서 시작하는 묶음이 걸치는 마지막 행 + 1 (병합이 이어지는 만큼)
  for (const cc of cells) if (cc.rs > 1) for (let r2 = cc.r; r2 < Math.min(rows.length, cc.r + cc.rs - 1); r2++) reach[r2] = Math.max(reach[r2], Math.min(rows.length, cc.r + cc.rs));

  const hdrRows = []; for (let r = 0; r < rows.length; r++) { if (rows[r].is_header || rows[r].repeat_as_header) hdrRows.push(r); else break; }
  const tb = tbl.border ?? {};
  const dx = flow.x0 + (String(tbl.alignment || '').toLowerCase() === 'center' ? Math.max(0, (flow.width - gridW) / 2) : 0);

  const drawRows = (from, to, y) => {
    // from..to-1 행을 y에서 그린다
    const off = y - rowTop[from];
    for (let r2 = from; r2 < to; r2++) for (const cc of byRow[r2]) {
      const top = off + rowTop[cc.r];
      const h = Math.min(rowTop[Math.min(cc.r + cc.rs, rows.length)], rowTop[to]) - rowTop[cc.r];
      const bg = rgb(cc.cell.background_color);
      if (bg) pushRect(flow.items, dx + cc.x, top, cc.w, h, bg);
      let vy = 0;
      const va = String(cc.cell.vertical_align || 'top').toLowerCase();
      const free = h - cc.h;
      if (free > 0 && va === 'center') vy = free / 2; else if (free > 0 && va === 'bottom') vy = free;
      for (const it of cc.items) flow.items.push(shiftItem(it, dx + cc.x + padL, top + padT + vy));
      const cb = cc.cell.border ?? {};
      const edge = (name, inside) => borderStyle(cb[name]) ?? borderStyle(tb[name]) ?? (inside ? borderStyle(tb[inside]) : null);
      const first = cc.c === 0, last = cc.c + cc.cs >= grid.length;
      const topB = edge('top', cc.r === from && !hdrRows.includes(cc.r) && cc.r === 0 ? null : 'inside_h') ?? (cc.r === 0 ? borderStyle(tb.top) : borderStyle(tb.inside_h));
      const bottomB = (cc.r + cc.rs >= rows.length ? borderStyle(cb.bottom) ?? borderStyle(tb.bottom) : borderStyle(cb.bottom) ?? borderStyle(tb.inside_h));
      const leftB = first ? borderStyle(cb.left) ?? borderStyle(tb.left) : borderStyle(cb.left) ?? borderStyle(tb.inside_v);
      const rightB = last ? borderStyle(cb.right) ?? borderStyle(tb.right) : borderStyle(cb.right) ?? borderStyle(tb.inside_v);
      void edge;
      if (topB) pushLine(flow.items, dx + cc.x, top, dx + cc.x + cc.w, top, topB.w, topB.color);
      if (bottomB) pushLine(flow.items, dx + cc.x, top + h, dx + cc.x + cc.w, top + h, bottomB.w, bottomB.color);
      if (leftB) pushLine(flow.items, dx + cc.x, top, dx + cc.x, top + h, leftB.w, leftB.color);
      if (rightB) pushLine(flow.items, dx + cc.x + cc.w, top, dx + cc.x + cc.w, top + h, rightB.w, rightB.color);
    }
    return rowTop[to] - rowTop[from];
  };

  let r = 0;
  let firstOnPage = true;
  const hdrH = hdrRows.length ? rowTop[hdrRows.length] : 0;
  while (r < rows.length) {
    // 머리글 행(첫 쪽이 아닌 경우 반복)
    const isHdr = hdrRows.includes(r);
    const rowH = rh[r];
    // 병합으로 걸친 행 묶음은 쪼개지 않는다
    let end = r + 1;
    end = Math.max(end, reach[r]);
    const blockH = rowTop[end] - rowTop[r];
    if (flow.paginated && flow.y + blockH > flow.bottom + EPS && !firstOnPage) {
      flow.newPage(); st.atTop = true; firstOnPage = true;
      if (hdrRows.length && !isHdr && r >= hdrRows.length) { flow.y += drawRows(0, hdrRows.length, flow.y); firstOnPage = false; }
    }
    flow.y += drawRows(r, end, flow.y);
    st.atTop = false; firstOnPage = false;
    r = end; void rowH; void hdrH;
  }
  st.lastAfter = 0;
}

function shiftItem(it, dx, dy) {
  const c = { ...it };
  if ('x' in c) c.x += dx; if ('y' in c) c.y += dy;
  if ('x1' in c) { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; }
  return c;
}

// ── 블록 목록 ──────────────────────────────────────────────────────────
function paragraphCtx(flow, ctx, extra = {}) {
  return { measure: ctx.measure, width: flow.width, notes: ctx.notes, defaultHalfPt: DEFAULT_HALF_PT, ...extra };
}

function estimateFirstHeight(el, flow, ctx) {
  if (el.type === 'heading') el = withHeadingStyle(el, ctx.headingRuns?.[String(el.level)]);
  if (el.type === 'paragraph' || el.type === 'heading') {
    const par = layoutParagraph(el, paragraphCtx(flow, ctx));
    const k = Math.min(2, par.lines.length);
    return par.before + par.lines.slice(0, k).reduce((a, l) => a + l.height, 0);
  }
  return 0;
}

/**
 * 제목 글자 서식 보완. office_oxide의 IR은 제목 스타일의 크기·굵기·색을 글자에 담지 않으므로
 * 어댑터(fmt-docx)가 준 제목 스타일 서식을 얹는다. 글자에 직접 지정된 굵게/기울임/색은 그대로 둔다.
 */
function withHeadingStyle(el, hr) {
  if (!hr) return el;
  const content = (el.content ?? []).map((r) => (r.type !== 'text' ? r : {
    ...r,
    font_size_half_pt: hr.font_size_half_pt ?? r.font_size_half_pt,
    bold: r.bold ?? hr.bold,
    italic: r.italic ?? hr.italic,
    color: r.color ?? hr.color,
    font_name: hr.font_name ?? r.font_name,
    char_spacing_half_pt: r.char_spacing_half_pt ?? hr.char_spacing_twips,
  }));
  return { ...el, content };
}

/** elements를 흐름에 놓는다. */
export function placeBlocks(elements, flow, ctx) {
  const st = { atTop: flow.y <= flow.top + EPS, lastAfter: 0 };
  for (let idx = 0; idx < elements.length; idx++) {
    let el = elements[idx];
    if (ctx.pageCount && ctx.pageCount() > MAX_PAGES) { ctx.warn('쪽 수 상한 초과'); return; }
    switch (el.type) {
      case 'paragraph': case 'heading': {
        if (el.type === 'heading') el = withHeadingStyle(el, ctx.headingRuns?.[String(el.level)]);
        const par = layoutParagraph(el, paragraphCtx(flow, ctx, el.marker_text ? { marker: el.marker_text } : {}));
        if (par.keepNext && flow.paginated && !st.atTop) {
          const next = elements[idx + 1];
          const own = par.before + par.lines.reduce((a, l) => a + l.height, 0);
          if (next && flow.y + own + estimateFirstHeight(next, flow, ctx) > flow.bottom + EPS) { flow.newPage(); st.atTop = true; }
        }
        placeParagraph(par, flow, st);
        break;
      }
      case 'list': {
        for (const { p, level, marker } of flattenList(el)) {
          const hang = 360, left = 720 * (level + 1);
          const q = { ...p, indent_left_twips: left + (p.indent_left_twips || 0), first_line_indent_twips: -hang };
          const par = layoutParagraph(q, paragraphCtx(flow, ctx, { marker }));
          placeParagraph(par, flow, st);
        }
        break;
      }
      case 'table': placeTable(el, flow, st, ctx); break;
      case 'image': {
        const w = emuToPx(el.display_width_emu || 0), h = emuToPx(el.display_height_emu || 0);
        const p = { type: 'paragraph', content: [{ type: 'image', ...el }], space_after_twips: 0 };
        void w; void h;
        placeParagraph(layoutParagraph(p, paragraphCtx(flow, ctx)), flow, st);
        break;
      }
      case 'text_box':
        // 슬라이드처럼 위치가 정해진 상자는 흐름과 무관하게 쪽 좌표에 놓는다
        if (flow.paginated && el.x_emu != null && el.y_emu != null && el.width_emu > 0) placeAbsolute(el, flow, ctx);
        else placeBlocks(el.content ?? [], flow, ctx);
        break;
      case 'page_break':
        if (flow.paginated) { flow.newPage(); st.atTop = true; }
        break;
      case 'footnote': case 'endnote': ctx.notesOut?.push(el); break;
      case 'thematic_break': {
        pushLine(flow.items, flow.x0, flow.y + 4, flow.x0 + flow.width, flow.y + 4, 1, '#808080'); flow.y += 8; break;
      }
      default: break;
    }
  }
}

/** 문단 목록의 글자 크기·간격을 비율로 줄인 사본. */
function scaleBlocks(blocks, sc) {
  return blocks.map((b) => (b.type !== 'paragraph' ? b : {
    ...b,
    content: (b.content ?? []).map((r) => (r.type === 'text' && r.font_size_half_pt ? { ...r, font_size_half_pt: r.font_size_half_pt * sc } : r)),
    space_before_twips: (b.space_before_twips || 0) * sc, space_after_twips: (b.space_after_twips || 0) * sc,
  }));
}

/**
 * x_emu/y_emu가 있는 상자(슬라이드 도형): 채우기·선을 그리고, 안쪽 여백을 둔 칸에 내용을 조판해 세로 정렬(위·가운데·아래)에 맞춰 얹는다.
 * 높이로 글을 자르지 않는다(넘치면 그대로 넘친다).
 */
function placeAbsolute(el, flow, ctx) {
  const W = emuToPx(el.width_emu), H = emuToPx(el.height_emu ?? 0);
  const ox = emuToPx(el.x_emu), oy = emuToPx(el.y_emu);
  const dx = el.h_anchor === 'page' ? ox : flow.x0 + ox, dy = el.v_anchor === 'page' ? oy : flow.top + oy;
  const color = (c) => rgb(c) ?? '#000000';
  if (el.shape === 'line') {
    const x1 = el.flipH ? dx + W : dx, x2 = el.flipH ? dx : dx + W, y1 = el.flipV ? dy + H : dy, y2 = el.flipV ? dy : dy + H;
    flow.items.push({ k: 'l', x1, y1, x2, y2, w: Math.max(0.5, emuToPx(el.stroke?.w ?? 12700)), color: color(el.stroke?.color) });
    return;
  }
  if ((el.fill || el.stroke) && W > 0 && H > 0) flow.items.push({ k: 's', shape: el.shape ?? 'rect', adj: el.adj, x: dx, y: dy, w: W, h: H, fill: el.fill ? color(el.fill) : null, stroke: el.stroke ? color(el.stroke.color) : null, sw: Math.max(0.5, emuToPx(el.stroke?.w ?? 12700)) });
  if (!el.content?.length) return;
  const [li, ti, ri, bi] = (el.inset ?? [0, 0, 0, 0]).map(emuToPx);
  let f = scratchFlow(Math.max(1, W - li - ri));
  placeBlocks(el.content, f, { ...ctx, notesOut: [] });
  // 이 기기에 원래 글꼴이 없으면 대체 글꼴이 더 넓어 상자 밖으로 넘치거나 한 줄이 두 줄이 된다. 글자를 조금 줄여 맞춘다(최대 30%).
  const avail = H - ti - bi;
  if (el.fit && avail > 0 && f.y > avail * 1.05) {
    for (let k = 1; k <= 8; k++) {
      const sc = 1 - k * 0.04;
      const g = scratchFlow(Math.max(1, W - li - ri));
      placeBlocks(scaleBlocks(el.content, sc), g, { ...ctx, notesOut: [] });
      f = g;
      if (g.y <= avail * 1.05) break;
    }
  }
  const free = H - ti - bi - f.y;
  const off = el.anchor === 'ctr' ? free / 2 : el.anchor === 'b' ? free : 0;
  for (const it of f.items) flow.items.push(shiftItem(it, dx + li, dy + ti + off));
}

export { pushRect, pushLine, shiftItem, MAX_ITEMS_PER_PAGE };
