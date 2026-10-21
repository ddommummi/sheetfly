// 문서 조판: IR(sections) → 쪽 목록. 각 쪽은 { width, height, items } (좌표는 쪽 좌상단 기준 px).
import { twipsToPx, rgb } from './units.js';
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

/** 증분 재조판에서 "이 쪽부터는 예전 쪽과 같다"를 알리는 신호(예외로 조판을 멈춘다). */
class Stabilized { constructor(j) { this.j = j; } }

/**
 * IR(sections) → 쪽 목록.
 * opts.track: 편집용. 쪽마다 시작 정보(구역·시작 요소·이어짐 여부)를 달고 `session.relayout(요소)`를 돌려준다
 * — 편집한 요소가 든 쪽 앞의 "요소 경계에서 시작한 쪽"부터 다시 조판하고, 새 쪽이 예전 쪽과 같은 요소에서 시작하면 거기서 멈추고 나머지 예전 쪽을 그대로 쓴다.
 */
export function layoutDocument(ir, measure, opts = {}) {
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const track = !!opts.track;
  const pages = [];
  const warnings = [];
  const notes = makeNotes();
  const notesOut = [];
  notesOut.keys = [];   // 각주 요소마다 그것을 만난 최상위 요소(증분 재조판 때 어디까지 믿을지 가리는 용도)
  let cur = null;
  let pageNo = 0;
  let restartNext = false;
  let stab = null;       // 증분 재조판 중: 예전 쪽에서 요소 경계로 시작한 쪽 { 요소 → 예전 쪽 번호 }
  let oldTail = null;
  const ctx = { measure, notes, notesOut, headingRuns: opts.headingRuns ?? {}, warn: (m) => { if (!warnings.includes(m)) warnings.push(m); }, pageCount: () => pages.length };
  if (track) { ctx.pcache = new WeakMap(); ctx.pcacheEst = new WeakMap(); }   // 문단 조판 캐시(편집 중 다시 조판할 때 줄 나눔을 되풀이하지 않는다)
  if (track) {
    const push = notesOut.push;
    notesOut.push = function (...els) { for (let i = 0; i < els.length; i++) this.keys.push(flow.topEl ?? null); return push.apply(this, els); };
  }

  const sections = ir.sections?.length ? ir.sections : [{ elements: [] }];
  let flow = null;
  let truncated = false;

  const hfCache = new Map();
  const secOf = new Map();          // 쪽 → 구역(구역별 쪽 수 계산용)
  let fieldPages = [];              // 필드가 있는 머리글/바닥글을 가진 쪽: 본문 조판이 끝난 뒤 실제 전체 쪽 수로 다시 채운다
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
    if (sec.background_color) items.push({ k: 'r', x: 0, y: 0, w: geo.W, h: geo.H, fill: rgb(sec.background_color) ?? '#ffffff' });   // 슬라이드 배경
    const page = { width: geo.W, height: geo.H, items, no: pageNo };
    if (track) {
      // 증분 재조판용: 이 쪽이 어느 요소에서, 새 요소로(이어짐이 아니게) 시작했는가
      Object.assign(page, { sec, top: flow.topEl ?? null, cont: !!(flow.cont || flow.sub), skip: !!flow.skip, first: firstInSection, restart: restartNext, nf: !!flow.byFlow });
      flow.cont = false; flow.skip = false; restartNext = false;
    }
    pages.push(page); secOf.set(page, sec);
    const first = firstInSection && sec.first_page_header;
    const even = pageNo % 2 === 0 && sec.even_page_header;
    const hdr = hfLayout(sec, first ? 'first_page_header' : even ? 'even_page_header' : 'header', geo, page);
    const ftr = hfLayout(sec, 'footer', geo, page);
    if ((hdr && hdr.field) || (ftr && ftr.field)) fieldPages.push({ page, sec, geo, hdr, ftr, key: `${pageNo}|1|1` });
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

  const geoCache = new Map();
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
  const geoFor = (sec) => { let g = geoCache.get(sec); if (!g) { g = geoOf(sec.page_setup, sec); geoCache.set(sec, g); } return g; };

  flow = { paginated: true, items: [], x0: 0, width: 0, y: 0, top: 0, bottom: 0, newPage() {}, topEl: null, cont: false, sub: false, byFlow: false };
  const onEl = (_i, el) => { flow.topEl = el; flow.sub = false; flow.skip = false; };

  /** 구역 si의 from 번째 요소부터 끝까지(이어서 다음 구역들) 놓는다. resumed면 첫 구역의 쪽은 호출한 쪽에서 이미 시작했다. */
  const runSections = (si0, from0, resumed) => {
    for (let si = si0; si < sections.length && !truncated; si++) {
      const sec = sections[si];
      const geo = geoFor(sec);
      let from = 0;
      if (resumed && si === si0) from = from0;
      else {
        const type = String(sec.break_type || 'next_page').toLowerCase();
        const sameSize = cur && Math.abs(cur.geo.W - geo.W) < 0.5 && Math.abs(cur.geo.H - geo.H) < 0.5;
        const continuous = si > 0 && type === 'continuous' && sameSize;
        flow.topEl = sec.elements?.[0] ?? null; flow.sub = false; flow.cont = false; flow.skip = false; flow.byFlow = false;
        if (!continuous) {
          if (geo.start != null) { pageNo = geo.start - 1; restartNext = true; }
          if (!startPage(sec, geo, true)) break;
          const parity = type === 'odd_page' ? 1 : type === 'even_page' ? 0 : null;
          if (parity != null && pageNo % 2 !== parity) { if (!startPage(sec, geo, false)) break; }
        } else {
          cur.sec = sec;
        }
      }
      flow.newPage = () => {
        if (truncated) { flow.y = flow.top; flow.items = []; return; }
        if (stab && !flow.cont && !flow.sub) {   // 요소 경계에서 새 쪽이 시작: 예전 쪽과 같은 자리면 여기서부터는 예전 쪽 그대로다
          const j = stab.get(flow.topEl);
          if (j !== undefined && oldTail[j].sec === sec && oldTail[j].skip === !!flow.skip) throw new Stabilized(j);
        }
        flow.byFlow = true;
        startPage(sec, geo, false);
        flow.byFlow = false;
      };
      placeBlocks(sec.elements ?? [], flow, ctx, { from, onEl });
      if (si === sections.length - 1 && notesOut.length && !truncated) {
        flow.topEl = null; flow.cont = true; flow.skip = false;
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
  };

  /** 필드(쪽 번호·전체 쪽 수)를 실제 값으로 채운다. 높이는 처음 조판과 같다고 보고 항목만 바꾼다. 바뀐 쪽 목록을 돌려준다. */
  const refreshFields = () => {
    const changed = [];
    if (!fieldPages.length) return changed;
    const secPages = new Map();
    for (const pg of pages) { const sc = secOf.get(pg); secPages.set(sc, (secPages.get(sc) ?? 0) + 1); }
    for (const fp of fieldPages) {
      const { page, sec, geo } = fp;
      const n = secPages.get(sec) ?? 1;
      const key = `${page.no}|${pages.length}|${n}`;
      if (fp.key === key) continue;
      fp.key = key;
      const val = fieldValues(geo, page.no, pages.length, n);
      const redo = (lay) => (lay && lay.field ? layoutSrc(lay.src, geo, fillFields(lay.src.content, val)) : lay);
      const hdr = redo(fp.hdr), ftr = redo(fp.ftr);
      const body = page.items.filter((i) => !i.hf);
      const hf = [];
      if (hdr) for (const it of hdr.items) hf.push({ ...shift(it, geo.ml, geo.hd), hf: true });
      if (ftr) { const fy = geo.H - geo.fd - ftr.h; for (const it of ftr.items) hf.push({ ...shift(it, geo.ml, fy), hf: true }); }
      page.items.length = 0;
      page.items.push(...hf, ...body);
      page.lns = undefined;
      changed.push(page);
    }
    return changed;
  };

  runSections(0, 0, false);
  if (!pages.length) { flow.topEl = null; startPage(sections[0], geoFor(sections[0]), true); }
  refreshFields();
  return { pages, warnings, truncated, session: track ? makeSession() : undefined };

  function makeSession() {
    /** 최상위 요소 topEl이 바뀐 뒤: 영향받는 쪽만 다시 조판한다. 못 하면 null(호출자가 처음부터 다시 조판한다). */
    const relayout = (topEl) => {
      if (truncated || !topEl) return null;
      const posOf = new Map();
      sections.forEach((sec, si) => (sec.elements ?? []).forEach((el, idx) => posOf.set(el, [si, idx])));
      const at = posOf.get(topEl);
      if (!at) return null;
      // 바뀐 요소 바로 앞 요소가 시작한 쪽부터 다시 한다(앞 쪽의 남은 자리에 이 요소가 들어가게 되는 경우가 있다). 구역의 첫 요소면 앞 구역의 마지막 요소.
      const target = at[1] > 0 ? [at[0], at[1] - 1] : at[0] > 0 ? [at[0] - 1, Math.max(0, (sections[at[0] - 1].elements?.length ?? 1) - 1)] : [0, 0];
      const le = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]);
      let k = -1;
      for (let i = 0; i < pages.length; i++) {
        const pg = pages[i];
        if (pg.cont || !pg.top) continue;
        const pp = posOf.get(pg.top);
        if (!pp) continue;
        if (le(pp, target)) k = i; else break;
      }
      if (k < 0) return null;
      const old = pages.splice(k);
      const first = old[0], p0 = posOf.get(first.top);
      oldTail = old; stab = new Map();
      // 바뀐 요소 자신이나 그 앞에서 시작한 예전 쪽은 믿을 수 없다(바뀐 요소 뒤의 요소에서 시작한 쪽만)
      const after = (pp) => pp[0] > at[0] || (pp[0] === at[0] && pp[1] > at[1]);
      for (let j = 1; j < old.length; j++) { const o = old[j], pp = o.top && posOf.get(o.top); if (o.nf && !o.cont && pp && after(pp) && !stab.has(o.top)) stab.set(o.top, j); }
      const oldSet = new Set(old);
      const keepFields = fieldPages.filter((fp) => !oldSet.has(fp.page));
      const oldFields = fieldPages.filter((fp) => oldSet.has(fp.page));
      fieldPages = keepFields;
      const oldNotes = [...notesOut], oldKeys = [...notesOut.keys];
      const before = (el) => { const pp = el && posOf.get(el); return !!pp && (pp[0] < p0[0] || (pp[0] === p0[0] && pp[1] < p0[1])); };
      notesOut.length = 0; notesOut.keys.length = 0;
      oldNotes.forEach((n, i) => { if (before(oldKeys[i])) { Array.prototype.push.call(notesOut, n); notesOut.keys.push(oldKeys[i]); } });
      pageNo = first.no - 1; restartNext = !!first.restart;
      flow.topEl = first.top; flow.cont = false; flow.sub = false; flow.skip = !!first.skip; flow.byFlow = !!first.nf;
      let stabJ = -1;
      try {
        if (!startPage(first.sec, geoFor(first.sec), first.first)) return null;
        flow.byFlow = false;
        runSections(p0[0], p0[1] + (first.skip ? 1 : 0), true);
      } catch (e) { if (e instanceof Stabilized) stabJ = e.j; else throw e; }
      finally { stab = null; oldTail = null; }
      if (truncated) return null;
      const added = pages.length - k;
      let removed = old.length;
      if (stabJ >= 0) {
        const tail = old.slice(stabJ);
        removed = stabJ;
        // 같은 요소에서 시작하는 예전 쪽부터는 그대로 쓰고, 그 앞에서 만난 각주는 새로 센 것과 합친다
        const tailTop = tail[0].top, pt = posOf.get(tailTop);
        oldNotes.forEach((n, i) => { const pp = oldKeys[i] && posOf.get(oldKeys[i]); if (pp && (pp[0] > pt[0] || (pp[0] === pt[0] && pp[1] >= pt[1]))) { Array.prototype.push.call(notesOut, n); notesOut.keys.push(oldKeys[i]); } });
        pages.push(...tail);
        const tailSet = new Set(tail);
        for (const fp of oldFields) if (tailSet.has(fp.page)) fieldPages.push(fp);
        // 쪽 번호 다시 매기기(구역이 번호를 새로 시작하는 쪽은 그대로)
        const delta = pages[k + added].no - (pages[k + added - 1].no + 1);
        for (let i = k + added; i < pages.length; i++) { const pg = pages[i]; if (pg.restart) break; pg.no = pages[i - 1].no + 1; }
        if (delta % 2 !== 0 && sections.some((sec) => sec.even_page_header)) return null;   // 홀짝 머리글이 뒤집힌다
      }
      const changedPages = new Set(pages.slice(k, k + added));
      for (const pg of refreshFields()) changedPages.add(pg);
      const changed = [];
      pages.forEach((pg, i) => { if (changedPages.has(pg)) changed.push(i); });
      for (const pg of changedPages) pg.lns = undefined;
      return { from: k, removed, added, changed, pageCount: pages.length };
    };
    return { relayout, pages };
  }
}

function shift(it, dx, dy) {
  const c = { ...it };
  if ('x' in c) c.x += dx; if ('y' in c) c.y += dy;
  if ('x1' in c) { c.x1 += dx; c.x2 += dx; c.y1 += dy; c.y2 += dy; }
  return c;
}
