// DOCX 엔진 Worker: office_oxide(fmt-docx 어댑터, WASM)로 문서를 IR로 읽고, 우리 조판 엔진(docx/)으로 쪽을 나눈다.
// 메시지 계약은 worker.js(HWP)와 같다: init / open / render / search / close / warmup.
import init, { SheetflyDoc } from './wasm/fmt_docx.js';
import { layoutDocument, pageToSvg, createCanvasMeasurer, parseRtf } from './docx/index.js';

let pages = null;
let measure = null;
let searchToken = 0;
const enc = new TextEncoder();

function classify(e) {
  const message = String(e && e.message ? e.message : e);
  if (e instanceof WebAssembly.RuntimeError || /unreachable|out of bounds|call stack|memory access/i.test(message)) {
    return { code: 'worker_crashed', message, fatal: true };
  }
  if (/encrypt|password|암호/i.test(message)) return { code: 'docx_encrypted', message };
  return { code: 'corrupt', message };
}

const isOle = (b) => b.length >= 4 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0;
const isRtf = (b) => b.length >= 5 && b[0] === 0x7b && b[1] === 0x5c && b[2] === 0x72 && b[3] === 0x74 && b[4] === 0x66;

function readIr(bytes, kind) {
  if (isRtf(bytes)) { try { return { ir: parseRtf(bytes).ir }; } catch (e) { throw classify(e); } }
  // OLE(CFB)는 구형 Word(.doc)거나, 암호화된 DOCX가 담기는 껍데기다. DOCX로 온 OLE는 암호화로 본다. 복호는 지원하지 않는다.
  if (isOle(bytes) && kind !== 'doc') throw { code: 'docx_encrypted', message: 'OLE container' };
  try {
    const doc = new SheetflyDoc(bytes, kind === 'doc' && isOle(bytes) ? 'doc' : 'docx');
    try { return JSON.parse(doc.toJson()); } finally { doc.free(); }
  } catch (e) { throw classify(e); }
}

function openDocument({ buffer, kind }) {
  const full = readIr(new Uint8Array(buffer), kind);
  try {
    if (!measure) measure = createCanvasMeasurer();
    const res = layoutDocument(full.ir, measure, { headingRuns: full.heading_runs });
    if (!res.pages.length) throw { code: 'no_pages', message: 'no pages' };
    pages = res.pages;
    const sizes = new Float32Array(pages.length * 2);
    pages.forEach((p, i) => { sizes[i * 2] = p.width; sizes[i * 2 + 1] = p.height; });
    return { pageCount: pages.length, sizes, meta: { engine: 'docx', warnings: res.warnings, truncated: res.truncated } };
  } catch (e) {
    if (e && e.code) throw e;
    throw { code: 'corrupt', message: String(e && e.message || e) };
  }
}

function renderPage({ page }) {
  if (!pages || !pages[page]) throw { code: 'render_failed', message: 'no page' };
  return { svg: enc.encode(pageToSvg(pages[page], measure)).buffer };
}

// ── 검색 ──────────────────────────────────────────────────────────────
// 쪽의 글자 조각(t)을 줄(같은 baseline) 단위로 이어 붙여 찾는다. 줄 바꿈·표 칸을 넘는 일치는 찾지 못한다(HWP 검색과 같은 한계).
const MAX_HITS = 5000;

function pageLines(page) {
  const items = page.items.filter((i) => i.k === 't').sort((a, b) => (Math.abs(a.y - b.y) < 1 ? a.x - b.x : a.y - b.y));
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!cur || Math.abs(it.y - cur.y) >= 1) { cur = { y: it.y, items: [] }; lines.push(cur); }
    cur.items.push(it);
  }
  return lines;
}

function pageHits(page, qChars, caseSensitive, budget) {
  const hits = [];
  const norm = (c) => (caseSensitive ? c : c.toLowerCase());
  for (const line of pageLines(page)) {
    const chars = []; // { c, it, idx } (it=null이면 구분용 공백)
    let prev = null;
    for (const it of line.items) {
      if (prev && it.x - (prev.x + prev.w) > 2) chars.push({ c: ' ', it: null, idx: 0 });
      let idx = 0;
      for (const ch of it.s) { chars.push({ c: norm(ch), it, idx: idx++ }); }
      prev = it;
    }
    outer: for (let i = 0; i + qChars.length <= chars.length; i++) {
      for (let k = 0; k < qChars.length; k++) if (chars[i + k].c !== qChars[k]) continue outer;
      const rects = [];
      let k = 0;
      while (k < qChars.length) {
        const a = chars[i + k];
        if (!a.it) { k++; continue; }
        let last = a, m = k + 1;
        while (m < qChars.length && chars[i + m].it === a.it) { last = chars[i + m]; m++; }
        const it = a.it;
        const cps = [...it.s];
        const before = cps.slice(0, a.idx).join('');
        const upto = cps.slice(0, last.idx + 1).join('');
        const x0 = it.x + measure.width(it.font, before) + (it.ls || 0) * a.idx;
        const x1 = it.x + measure.width(it.font, upto) + (it.ls || 0) * (last.idx + 1);
        rects.push([x0, it.top, Math.max(x1 - x0, 1), it.lh]);
        k = m;
      }
      if (rects.length) { hits.push({ rects }); if (hits.length >= budget) return hits; }
      i += qChars.length - 1;
    }
  }
  return hits;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function search({ id, query, caseSensitive }) {
  const token = ++searchToken;
  if (!pages) throw { code: 'render_failed', message: 'no document' };
  const qChars = [...String(query || '')].map((c) => (caseSensitive ? c : c.toLowerCase()));
  const total = pages.length;
  if (!qChars.length) return { done: true, total: 0, hits: 0, truncated: false };
  let found = 0;
  let batch = [];
  let lastPost = performance.now();
  for (let p = 0; p < total; p++) {
    if (token !== searchToken) return { cancelled: true };
    const hits = pageHits(pages[p], qChars, caseSensitive, MAX_HITS - found);
    for (const h of hits) batch.push({ page: p, rects: h.rects });
    found += hits.length;
    const now = performance.now();
    if (batch.length && (now - lastPost > 60 || p === total - 1)) {
      self.postMessage({ type: 'progress', id, hits: batch, scanned: p + 1, total });
      batch = []; lastPost = now;
    } else if (now - lastPost > 60) {
      self.postMessage({ type: 'progress', id, hits: [], scanned: p + 1, total });
      lastPost = now;
    }
    if (found >= MAX_HITS) {
      if (batch.length) self.postMessage({ type: 'progress', id, hits: batch, scanned: p + 1, total });
      return { done: true, total, hits: found, truncated: true };
    }
    if (p % 8 === 7) await tick();
  }
  if (batch.length) self.postMessage({ type: 'progress', id, hits: batch, scanned: total, total });
  return { done: true, total, hits: found, truncated: false };
}

// ── 메시지 처리 ───────────────────────────────────────────────────────
let ready = null;

self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'cancelSearch') { searchToken++; return; }
  const reply = (extra, transfer = []) => self.postMessage({ id: m.id, ok: true, ...extra }, transfer);
  const fail = (err) => self.postMessage({
    id: m.id, ok: false,
    error: { code: err.code || 'unknown', message: String(err.message || err), fatal: !!err.fatal },
  });
  try {
    if (m.type === 'init') { ready = init({ module_or_path: m.wasmUrl }); await ready; return reply({}); }
    await ready;
    if (m.type === 'warmup') return reply({ ms: 0 });
    if (m.type === 'open') { const r = openDocument(m); return reply(r, [r.sizes.buffer]); }
    if (m.type === 'render') { const r = renderPage(m); return reply(r, [r.svg]); }
    if (m.type === 'search') return reply(await search(m));
    if (m.type === 'close') { pages = null; return reply({}); }
    fail({ code: 'unknown', message: `unknown message ${m.type}` });
  } catch (err) {
    if (m.type === 'init') return fail({ code: 'worker_failed', message: String(err && err.message || err) });
    fail(err && err.code ? err : classify(err));
  }
};
