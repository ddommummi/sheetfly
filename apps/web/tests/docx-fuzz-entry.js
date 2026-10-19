// 변이 시험용 번들 진입점: 브라우저 한 페이지에서 파싱(WASM) → 조판 → SVG까지 Worker와 같은 경로를 돌린다.
import init, { SheetflyDoc } from '../src/wasm/fmt_docx.js';
import { layoutDocument, pageToSvg, createCanvasMeasurer } from '../src/docx/index.js';

let measure = null;
export async function initEngine(wasmBytes) { await init({ module_or_path: wasmBytes }); measure = createCanvasMeasurer(); }

export function run(b64, maxPages = 60) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const t = performance.now();
  let status = 'ok', pages = 0, detail = '';
  try {
    const doc = new SheetflyDoc(bytes, 'docx');
    let full; try { full = JSON.parse(doc.toJson()); } finally { doc.free(); }
    const res = layoutDocument(full.ir, measure, { headingRuns: full.heading_runs });
    pages = res.pages.length;
    for (let i = 0; i < Math.min(pages, maxPages); i++) pageToSvg(res.pages[i], measure);
    if (res.truncated) status = 'truncated';
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (e instanceof WebAssembly.RuntimeError || /unreachable|out of bounds|call stack|memory access/i.test(msg)) { status = 'trap'; detail = msg.slice(0, 160); }
    else if (e instanceof RangeError || e instanceof TypeError || (e && e.stack && /layout|flow|paragraph|svg/.test(e.stack))) { status = 'js_error'; detail = (e.stack || msg).slice(0, 300); }
    else { status = 'rejected'; detail = msg.slice(0, 100); }
  }
  return { status, pages, ms: performance.now() - t, detail };
}
