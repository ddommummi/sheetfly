// 문서 조판: IR(sections) → 쪽 목록. 각 쪽은 { width, height, items } (좌표는 쪽 좌상단 기준 px).
import { twipsToPx } from './units.js';
import { placeBlocks, scratchFlow } from './flow.js';

const MAX_PAGES = 5000;
const DEFAULT_PAGE = { width_twips: 12240, height_twips: 15840, margin_top_twips: 1440, margin_bottom_twips: 1440, margin_left_twips: 1440, margin_right_twips: 1440, header_distance_twips: 720, footer_distance_twips: 720 };

function makeNotes() {
  const maps = { footnote_ref: new Map(), endnote_ref: new Map() };
  return {
    number(type, id) { const m = maps[type]; if (!m.has(id)) m.set(id, m.size + 1); return m.get(id); },
    peek(type, id) { return maps[type].get(id); },
  };
}

export function layoutDocument(ir, measure, opts = {}) {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const pages = [];
  const warnings = [];
  const notes = makeNotes();
  const notesOut = [];
  let cur = null;
  let pageNo = 0;
  const ctx = { measure, notes, notesOut, warn: (m) => { if (!warnings.includes(m)) warnings.push(m); }, pageCount: () => pages.length };

  const sections = ir.sections?.length ? ir.sections : [{ elements: [] }];
  let flow = null;
  let truncated = false;

  const hfCache = new Map();
  const hfLayout = (sec, kind, geo) => {
    const key = `${sections.indexOf(sec)}:${kind}`;
    if (hfCache.has(key)) return hfCache.get(key);
    const src = sec[kind];
    let r = null;
    if (src && src.content?.length) {
      const f = scratchFlow(geo.textW);
      placeBlocks(src.content, f, { ...ctx, notesOut: [] });
      r = { items: f.items, h: f.y };
    }
    hfCache.set(key, r);
    return r;
  };

  function startPage(sec, geo, firstInSection) {
    if (pages.length >= maxPages) { truncated = true; ctx.warn(`쪽 수가 상한(${maxPages})을 넘어 이후는 생략했다`); return false; }
    pageNo++;
    const items = [];
    const page = { width: geo.W, height: geo.H, items, no: pageNo };
    pages.push(page);
    const first = firstInSection && sec.first_page_header;
    const even = pageNo % 2 === 0 && sec.even_page_header;
    const hdr = hfLayout(sec, first ? 'first_page_header' : even ? 'even_page_header' : 'header', geo);
    const ftr = hfLayout(sec, 'footer', geo);
    let top = geo.mt, bottom = geo.H - geo.mb;
    if (hdr) {
      for (const it of hdr.items) items.push({ ...shift(it, geo.ml, geo.hd), hf: true });
      top = Math.max(top, geo.hd + hdr.h);
    }
    if (ftr) {
      const fy = geo.H - geo.fd - ftr.h;
      for (const it of ftr.items) items.push({ ...shift(it, geo.ml, fy), hf: true });
      bottom = Math.min(bottom, fy);
    }
    if (bottom - top < 24) { bottom = top + 24; }   // 머리글/바닥글이 본문을 다 먹지 않도록
    Object.assign(flow, { x0: geo.ml, width: geo.textW, y: top, top, bottom, items, paginated: true });
    cur = { sec, geo, page, top, bottom };
    return true;
  }

  const geoOf = (ps) => {
    const g = { ...DEFAULT_PAGE, ...(ps ?? {}) };
    const geo = {
      W: twipsToPx(g.width_twips), H: twipsToPx(g.height_twips), ml: twipsToPx(g.margin_left_twips), mr: twipsToPx(g.margin_right_twips),
      mt: twipsToPx(g.margin_top_twips), mb: twipsToPx(g.margin_bottom_twips), hd: twipsToPx(g.header_distance_twips), fd: twipsToPx(g.footer_distance_twips),
    };
    geo.textW = Math.max(24, geo.W - geo.ml - geo.mr);
    geo.start = g.page_number_start;
    return geo;
  };

  flow = { paginated: true, items: [], x0: 0, width: 0, y: 0, top: 0, bottom: 0, newPage() {} };
  let firstSection = true;
  for (let si = 0; si < sections.length && !truncated; si++) {
    const sec = sections[si];
    const geo = geoOf(sec.page_setup);
    const type = String(sec.break_type || 'next_page').toLowerCase();
    const sameSize = cur && Math.abs(cur.geo.W - geo.W) < 0.5 && Math.abs(cur.geo.H - geo.H) < 0.5;
    const continuous = !firstSection && type === 'continuous' && sameSize;
    if (!continuous) {
      if (!firstSection && geo.start != null) pageNo = geo.start - 1;
      else if (firstSection && geo.start != null) pageNo = geo.start - 1;
      if (!startPage(sec, geo, true)) break;
      const parity = type === 'odd_page' ? 1 : type === 'even_page' ? 0 : null;
      if (parity != null && pageNo % 2 !== parity) { if (!startPage(sec, geo, false)) break; }
    } else {
      cur.sec = sec;
    }
    firstSection = false;
    flow.newPage = () => { if (!truncated) startPage(sec, geo, false); else { flow.y = flow.top; flow.items = []; } };
    placeBlocks(sec.elements ?? [], flow, ctx);
    if (si === sections.length - 1 && notesOut.length && !truncated) {
      const rule = [{ k: 'l', x1: geo.ml, y1: flow.y + 6, x2: geo.ml + geo.textW * 0.33, y2: flow.y + 6, w: 0.75, color: '#000000' }];
      flow.y += 12; flow.items.push(...rule);
      const blocks = notesOut.flatMap((n) => {
        const type = n.type === 'footnote' ? 'footnote_ref' : 'endnote_ref';
        const num = notes.peek(type, n.id) ?? n.id;
        const paras = (n.content ?? []).map((p, i) => (i === 0 && p.type === 'paragraph'
          ? { ...p, content: [{ type: 'text', text: `${num} `, vertical_align: 'superscript', font_size_half_pt: 22 }, ...(p.content ?? [])] } : p));
        return paras;
      });
      placeBlocks(blocks, flow, { ...ctx, notesOut: [] });
    }
  }
  if (!pages.length) { startPage(sections[0], geoOf(sections[0].page_setup), true); }
  return { pages, warnings, truncated };
}

function shift(it, dx, dy) {
  const c = { ...it };
  if ('x' in c) c.x += dx; if ('y' in c) c.y += dy;
  if ('x1' in c) { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; }
  return c;
}
