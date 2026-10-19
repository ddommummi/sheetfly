// 흐름 배치: 문단·목록·표를 쪽에 채운다. 쪽을 넘기는 곳(본문)과 넘기지 않는 곳(표 칸, 머리글)을 같은 코드로 다룬다.
import { twipsToPx, emuToPx, rgb } from './units.js';
import { layoutParagraph, runStyle, DEFAULT_HALF_PT } from './paragraph.js';
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
      items.push({ k: 't', x, y: by, s: it.text, font: it.font, fill: st.color, ls: st.spacing || 0, w: it.w, link: st.link || undefined });
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

function placeTable(tbl, flow, st, ctx) {
  const grid = gridOf(tbl, flow.width);
  const gridW = grid.reduce((a, b) => a + b, 0);
  const pad = tbl.cell_padding_twips ?? {};
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

  const hdrRows = []; for (let r = 0; r < rows.length; r++) { if (rows[r].is_header || rows[r].repeat_as_header) hdrRows.push(r); else break; }
  const tb = tbl.border ?? {};
  const dx = flow.x0 + (String(tbl.alignment || '').toLowerCase() === 'center' ? Math.max(0, (flow.width - gridW) / 2) : 0);

  const drawRows = (from, to, y) => {
    // from..to-1 행을 y에서 그린다
    const off = y - rowTop[from];
    for (const cc of cells) {
      if (cc.r < from || cc.r >= to) continue;
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
    for (const cc of cells) if (cc.r <= r && cc.r + cc.rs > end && cc.r + cc.rs > r + 1) end = Math.max(end, cc.r + cc.rs);
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
  if (el.type === 'paragraph' || el.type === 'heading') {
    const par = layoutParagraph(el, paragraphCtx(flow, ctx));
    const k = Math.min(2, par.lines.length);
    return par.before + par.lines.slice(0, k).reduce((a, l) => a + l.height, 0);
  }
  return 0;
}

/** elements를 흐름에 놓는다. */
export function placeBlocks(elements, flow, ctx) {
  const st = { atTop: flow.y <= flow.top + EPS, lastAfter: 0 };
  for (let idx = 0; idx < elements.length; idx++) {
    const el = elements[idx];
    if (ctx.pageCount && ctx.pageCount() > MAX_PAGES) { ctx.warn('쪽 수 상한 초과'); return; }
    switch (el.type) {
      case 'paragraph': case 'heading': {
        const par = layoutParagraph(el, paragraphCtx(flow, ctx));
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
      case 'text_box': placeBlocks(el.content ?? [], flow, ctx); break;
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

export { pushRect, pushLine, shiftItem, MAX_ITEMS_PER_PAGE };
