// 문서 조판: IR(sections) → 쪽 목록. 각 쪽은 { width, height, items } (좌표는 쪽 좌상단 기준 px).
import { twipsToPx } from './units.js';
import { placeBlocks, scratchFlow, naturalTableWidth } from './flow.js';
import { formatNumber } from './text.js';

const MAX_PAGES = 5000;
// 쪽 설정이 없는 구역(DOC 등)의 기본값: A4. 이 사용처는 한국어 문서가 많고 office_oxide가 DOC의 구역 설정을 읽지 못한다.
const MAX_FIT_PX = 8000;   // 시트를 키울 수 있는 쪽 너비 상한(약 83인치)
const DEFAULT_PAGE = { width_twips: 11906, height_twips: 16838, margin_top_twips: 1440, margin_bottom_twips: 1440, margin_left_twips: 1440, margin_right_twips: 1440, header_distance_twips: 720, footer_distance_twips: 720 };

function makeNotes() {
  const maps = { footnote_ref: new Map(), endnote_ref: new Map() };
  return {
    number(type, id) { const m = maps[type]; if (!m.has(id)) m.set(id, m.size + 1); return m.get(id); },
    peek(type, id) { return maps[type].get(id); },
  };
}

// ── 머리글/바닥글 필드 ─────────────────────────────────────────────────
// 어댑터(fmt-docx)가 필드 결과 글자를 표식(U+E000 종류[:서식] U+E001)으로 바꿔 준다: P=PAGE, N=NUMPAGES, S=SECTIONPAGES.
const FIELD = /\uE000([PNS])(?::(\w+))?\uE001/g;
const SWITCH_STYLE = { roman: 'lowerRoman', ROMAN: 'upperRoman', alphabetic: 'lowerLetter', ALPHABETIC: 'upperLetter', arabic: 'decimal' };

function containsField(els) {
  for (const el of els ?? []) {
    if (el.type === 'paragraph' || el.type === 'heading') { for (const r of el.content ?? []) if (r.type === 'text' && typeof r.text === 'string' && r.text.includes('\uE000')) return true; }
    else if (el.type === 'table') { for (const row of el.rows ?? []) for (const c of row.cells ?? []) if (containsField(c.content)) return true; }
    else if (el.type === 'text_box' && containsField(el.content)) return true;
  }
  return false;
}

/** 표식을 값으로 바꾼 복사본. val(kind, fmt) → 문자열. */
function fillFields(els, val) {
  return (els ?? []).map((el) => {
    if (el.type === 'paragraph' || el.type === 'heading') {
      return { ...el, content: (el.content ?? []).map((r) => (r.type === 'text' && typeof r.text === 'string' && r.text.includes('\uE000') ? { ...r, text: r.text.replace(FIELD, (_m, k, f) => val(k, f)) } : r)) };
    }
    if (el.type === 'table') return { ...el, rows: (el.rows ?? []).map((row) => ({ ...row, cells: (row.cells ?? []).map((c) => ({ ...c, content: fillFields(c.content, val) })) })) };
    if (el.type === 'text_box') return { ...el, content: fillFields(el.content, val) };
    return el;
  });
}

export function layoutDocument(ir, measure, opts = {}) {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const pages = [];
  const warnings = [];
  const notes = makeNotes();
  const notesOut = [];
  let cur = null;
  let pageNo = 0;
  const ctx = { measure, notes, notesOut, headingRuns: opts.headingRuns ?? {}, warn: (m) => { if (!warnings.includes(m)) warnings.push(m); }, pageCount: () => pages.length };

  const sections = ir.sections?.length ? ir.sections : [{ elements: [] }];
  let flow = null;
  let truncated = false;

  const hfCache = new Map();
  const fieldPages = [];            // 필드가 있는 머리글/바닥글을 가진 쪽: 본문 조판이 끝난 뒤 실제 전체 쪽 수로 다시 채운다
  const secPageCount = new Map();   // 구역별 쪽 수(SECTIONPAGES)
  const layoutSrc = (src, geo, content) => {
    const f = scratchFlow(geo.textW);
    placeBlocks(content, f, { ...ctx, notesOut: [] });
    return { items: f.items, h: f.y };
  };
  /** 쪽 번호 값: PAGE는 구역 번호 형식을 따르고 \* 스위치가 있으면 그것을 따른다. */
  const fieldValues = (geo, pageNo, total, secPages) => (kind, fmt) => {
    if (kind === 'P') return formatNumber(pageNo, SWITCH_STYLE[fmt] ?? geo.pnFmt ?? 'decimal');
    if (kind === 'N') return formatNumber(total, SWITCH_STYLE[fmt] ?? 'decimal');
    return formatNumber(secPages, SWITCH_STYLE[fmt] ?? 'decimal');
  };
  const hfLayout = (sec, kind, geo, page) => {
    const src = sec[kind];
    if (!src || !src.content?.length) return null;
    if (containsField(src.content)) {
      // 쪽마다 다른 값: 전체 쪽 수는 아직 모르므로 자리값으로 먼저 조판하고, 끝난 뒤 다시 채운다
      const val = fieldValues(geo, page.no, 1, 1);
      return { ...layoutSrc(src, geo, fillFields(src.content, val)), field: true, src };
    }
    const key = `${sections.indexOf(sec)}:${kind}`;
    if (hfCache.has(key)) return hfCache.get(key);
    const r = layoutSrc(src, geo, src.content);
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
    const hdr = hfLayout(sec, first ? 'first_page_header' : even ? 'even_page_header' : 'header', geo, page);
    const ftr = hfLayout(sec, 'footer', geo, page);
    secPageCount.set(sec, (secPageCount.get(sec) ?? 0) + 1);
    if ((hdr && hdr.field) || (ftr && ftr.field)) fieldPages.push({ page, sec, geo, hdr, ftr, no: pageNo });
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

  const geoOf = (ps, sec) => {
    const g = { ...DEFAULT_PAGE, ...(ps ?? {}) };
    const geo = {
      W: twipsToPx(g.width_twips), H: twipsToPx(g.height_twips), ml: twipsToPx(g.margin_left_twips), mr: twipsToPx(g.margin_right_twips),
      mt: twipsToPx(g.margin_top_twips), mb: twipsToPx(g.margin_bottom_twips), hd: twipsToPx(g.header_distance_twips), fd: twipsToPx(g.footer_distance_twips),
    };
    // 시트(스프레드시트)는 열이 쪽 밖으로 잘리지 않게 표를 펴서 한 줄 너비만큼 쪽을 넓힌다
    if (sec?.fit_width) {
      const tbl = (sec.elements ?? []).find((e) => e.type === 'table');
      if (tbl) geo.W = Math.min(MAX_FIT_PX, Math.max(geo.W, naturalTableWidth(tbl, ctx) + geo.ml + geo.mr + 2));
    }
    geo.textW = Math.max(24, geo.W - geo.ml - geo.mr);
    geo.start = g.page_number_start;
    geo.pnFmt = g.page_number_format;
    return geo;
  };

  flow = { paginated: true, items: [], x0: 0, width: 0, y: 0, top: 0, bottom: 0, newPage() {} };
  let firstSection = true;
  for (let si = 0; si < sections.length && !truncated; si++) {
    const sec = sections[si];
    const geo = geoOf(sec.page_setup, sec);
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
  if (!pages.length) { startPage(sections[0], geoOf(sections[0].page_setup, sections[0]), true); }
  // 필드(쪽 번호·전체 쪽 수)를 실제 값으로 다시 채운다. 높이는 처음 조판과 같다고 보고 항목만 바꾼다.
  for (const fp of fieldPages) {
    const { page, sec, geo } = fp;
    const val = fieldValues(geo, fp.no, pages.length, secPageCount.get(sec) ?? 1);
    const redo = (lay) => (lay && lay.field ? layoutSrc(lay.src, geo, fillFields(lay.src.content, val)) : lay);
    const hdr = redo(fp.hdr), ftr = redo(fp.ftr);
    const body = page.items.filter((i) => !i.hf);
    const hf = [];
    if (hdr) for (const it of hdr.items) hf.push({ ...shift(it, geo.ml, geo.hd), hf: true });
    if (ftr) { const fy = geo.H - geo.fd - ftr.h; for (const it of ftr.items) hf.push({ ...shift(it, geo.ml, fy), hf: true }); }
    page.items.length = 0;
    page.items.push(...hf, ...body);
  }
  return { pages, warnings, truncated };
}

function shift(it, dx, dy) {
  const c = { ...it };
  if ('x' in c) c.x += dx; if ('y' in c) c.y += dy;
  if ('x1' in c) { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; }
  return c;
}
