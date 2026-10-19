// 엔진 Worker: WASM(rhwp)을 올리고 문서 열기 / 쪽 SVG 렌더 / 텍스트 검색을 맡는다.
// 메인 스레드는 이 Worker와 메시지만 주고받는다 (파싱·조판이 화면을 멈추지 않게).
import init, { HwpDocument } from './wasm/rhwp.js';

let doc = null;
let searchToken = 0;
let editMod = null;
const enc = new TextEncoder();

// 엔진이 글자 폭 측정을 JS에 맡길 때 부르는 콜백. 1단계 측정(310개 문서)에서는 호출이 0회였지만
// 글꼴 메트릭에 없는 글꼴을 만나면 불릴 수 있어 안전장치로 둔다.
let mctx = null;
let lastFont = '';
globalThis.measureTextWidth = (font, text) => {
  try {
    if (!mctx) mctx = new OffscreenCanvas(1, 1).getContext('2d');
    if (font !== lastFont) { mctx.font = font; lastFont = font; }
    return mctx.measureText(text).width;
  } catch {
    const px = parseFloat(String(font).match(/([\d.]+)px/)?.[1] ?? '16');
    return [...text].length * px * 0.6;
  }
};

/** 엔진 오류를 UI가 이해하는 코드로 바꾼다. fatal=true면 인스턴스를 더 쓰지 않는다. */
function classify(e) {
  const message = String(e && e.message ? e.message : e);
  if (e instanceof WebAssembly.RuntimeError || /unreachable|out of bounds|call stack|memory access/i.test(message)) {
    return { code: 'worker_crashed', message, fatal: true };
  }
  if (/비밀번호가 필요/.test(message)) return { code: 'password_required', message };
  if (/비밀번호가 일치하지 않/.test(message)) return { code: 'wrong_password', message };
  if (/DRM/i.test(message)) return { code: 'drm', message };
  return { code: 'corrupt', message };
}

function openDocument({ buffer, password }) {
  const bytes = new Uint8Array(buffer);
  let d;
  try {
    d = password ? HwpDocument.openWithPassword(bytes, password) : new HwpDocument(bytes);
  } catch (e) {
    throw classify(e);
  }
  try {
    // 손상으로 구역(section)이 0개가 된 문서는 pageCount()가 1 이상인데 getPageInfo()가 panic한다
    // (엔진 index out of bounds, rendering.rs get_page_info_native). trap으로 Worker를 잃지 않도록 먼저 걸러낸다.
    // 시험: 손상 변형 코퍼스에서 같은 원인의 panic 5건 (docs/phase2/report.md).
    try {
      if (JSON.parse(d.getDocumentInfo()).sectionCount === 0) { d.free(); throw { code: 'corrupt', message: 'no sections' }; }
    } catch (e) { if (e && e.code) throw e; }
    const pageCount = d.pageCount();
    if (pageCount === 0) { d.free(); throw { code: 'no_pages', message: 'no pages' }; }
    const sizes = new Float32Array(pageCount * 2);
    for (let i = 0; i < pageCount; i++) {
      const info = JSON.parse(d.getPageInfo(i));
      sizes[i * 2] = info.width;
      sizes[i * 2 + 1] = info.height;
    }
    let meta = {};
    try {
      const di = JSON.parse(d.getDocumentInfo());
      meta = { version: di.version, encrypted: !!di.encrypted, hwp3: /^3\./.test(di.version || '') || !!di.hwp3Variant };
    } catch { /* 메타 정보는 없어도 된다 */ }
    if (doc) doc.free();
    doc = d;
    return { pageCount, sizes, meta };
  } catch (e) {
    if (e && e.code) throw e;
    try { d.free(); } catch { /* ignore */ }
    throw classify(e);
  }
}

function renderPage({ page }) {
  if (!doc) throw { code: 'render_failed', message: 'no document' };
  try {
    const svg = doc.renderPageSvg(page);
    return { svg: enc.encode(svg).buffer };
  } catch (e) {
    const c = classify(e);
    throw c.fatal ? c : { code: 'render_failed', message: c.message };
  }
}

// ── 검색 ──────────────────────────────────────────────────────────────
// 엔진의 searchAllText는 쪽 번호를 주지 않는다. 쪽별 텍스트 배치(TextRun의 위치·글자별 x 경계)를
// 직접 훑으면 쪽과 강조 사각형을 한 번에 얻는다. 한계: 같은 줄에서 이어지는 TextRun은 하나로 이어
// 붙여 찾지만, 줄 바꿈·셀 경계를 넘는 일치는 찾지 못한다.
const MAX_HITS = 5000;

function* codePoints(s) { for (const ch of s) yield ch; }

function buildLines(runs) {
  const lines = [];
  let line = null;
  let prev = null;
  for (const r of runs) {
    if (!r.text) continue;
    const sameLine = prev
      && Math.abs((r.y + r.h / 2) - (prev.y + prev.h / 2)) < Math.min(r.h, prev.h) * 0.5
      && r.x >= prev.x + prev.w - 1.5
      && r.x - (prev.x + prev.w) < prev.h * 4;
    if (!sameLine) { line = []; lines.push(line); }
    line.push(r);
    prev = r;
  }
  return lines;
}

function pageHits(layout, qChars, caseSensitive, budget) {
  const hits = [];
  const norm = (c) => (caseSensitive ? c : c.toLowerCase());
  for (const runs of buildLines(layout.runs || [])) {
    const chars = []; // { c, run, ci }  (run=null이면 구분용 공백)
    let prev = null;
    for (const r of runs) {
      if (prev && r.x - (prev.x + prev.w) > prev.h * 0.5) chars.push({ c: ' ', run: null, ci: 0 });
      let ci = 0;
      for (const ch of codePoints(r.text)) chars.push({ c: norm(ch), run: r, ci: ci++ });
      prev = r;
    }
    outer: for (let i = 0; i + qChars.length <= chars.length; i++) {
      for (let k = 0; k < qChars.length; k++) if (chars[i + k].c !== qChars[k]) continue outer;
      const rects = [];
      let k = 0;
      while (k < qChars.length) {
        const a = chars[i + k];
        if (!a.run) { k++; continue; }
        let last = a;
        let m = k + 1;
        while (m < qChars.length && chars[i + m].run === a.run) { last = chars[i + m]; m++; }
        const r = a.run;
        const cx = r.charX || [];
        const n = [...r.text].length;
        const x0 = r.x + (cx[a.ci] ?? (r.w * a.ci) / n);
        const x1 = r.x + (cx[last.ci + 1] ?? (r.w * (last.ci + 1)) / n);
        rects.push([x0, r.y, Math.max(x1 - x0, 1), r.h]);
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
  if (!doc) throw { code: 'render_failed', message: 'no document' };
  const q = String(query || '');
  const qChars = [...q].map((c) => (caseSensitive ? c : c.toLowerCase()));
  const total = doc.pageCount();
  if (!qChars.length) return { done: true, total: 0, hits: 0, truncated: false };
  let found = 0;
  let batch = [];
  let lastPost = performance.now();
  for (let p = 0; p < total; p++) {
    if (token !== searchToken) return { cancelled: true };
    let layout;
    try { layout = JSON.parse(doc.getPageTextLayout(p)); } catch (e) {
      const c = classify(e); if (c.fatal) throw c; continue;
    }
    const hits = pageHits(layout, qChars, caseSensitive, MAX_HITS - found);
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
    if (p % 8 === 7) await tick(); // 쪽 렌더 요청이 끼어들 틈을 준다
  }
  if (batch.length) self.postMessage({ type: 'progress', id, hits: batch, scanned: total, total });
  return { done: true, total, hits: found, truncated: false };
}

// ── 예열 ──────────────────────────────────────────────────────────────
// WASM은 처음 실행될 때 느린 기본 코드로 돌다가 반복 실행되면 최적화된다. 사용자가 파일을 고르는 동안
// 작은 가상 문서로 조판·렌더 경로를 몇 번 돌려 첫 문서의 열기 지연을 줄인다.
function warmup({ loops = 1, text = 40, parse = false }) {
  let d = HwpDocument.createEmpty();
  try {
    d.insertText(0, 0, 0, '가나다라마바사 Hello world 1234567890 '.repeat(text));
    if (parse) { // 가상 문서를 HWP로 내보냈다가 다시 읽어 파서 경로도 한 번 돌린다
      const bytes = d.exportHwp();
      d.free();
      d = new HwpDocument(bytes);
    }
    for (let i = 0; i < loops; i++) {
      d.pageCount(); d.getPageInfo(0); d.renderPageSvg(0); d.getPageTextLayout(0);
    }
  } finally { d.free(); }
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
    if (m.type === 'init') {
      ready = init({ module_or_path: m.wasmUrl });
      await ready;
      return reply({});
    }
    await ready;
    if (m.type === 'warmup') {
      const t0 = performance.now();
      try { warmup(m); } catch { /* 예열 실패는 무시한다 */ }
      return reply({ ms: performance.now() - t0 });
    }
    if (m.type === 'open') {
      const r = openDocument(m);
      return reply(r, [r.sizes.buffer]);
    }
    if (m.type === 'render') {
      const r = renderPage(m);
      return reply(r, [r.svg]);
    }
    if (m.type === 'search') {
      const r = await search(m);
      return reply(r);
    }
    // 편집: 편집 계층(hwp-edit.js)은 편집을 시작할 때만 받는다(지연 로딩, docs/phase4/design.md 7절)
    if (m.type === 'editInit') {
      if (!doc) throw { code: 'render_failed', message: 'no document' };
      editMod = editMod ?? await import(/* 편집 계층 URL은 메인이 알려 준다 */ m.url);
      return reply({});
    }
    if (m.type === 'edit') {
      if (!doc || !editMod) throw { code: 'render_failed', message: 'edit not ready' };
      const r = editMod.run(doc, HwpDocument, m);
      const transfer = [];
      if (r.sizes) transfer.push(r.sizes.buffer);
      if (r.bytes) transfer.push(r.bytes.buffer);
      return reply(r, transfer);
    }
    if (m.type === 'close') {
      if (doc) { doc.free(); doc = null; }
      return reply({});
    }
    fail({ code: 'unknown', message: `unknown message ${m.type}` });
  } catch (err) {
    if (m.type === 'init') return fail({ code: 'worker_failed', message: String(err && err.message || err) });
    fail(err && err.code ? err : classify(err));
  }
};
