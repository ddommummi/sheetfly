// 변이 시험용 번들 진입점: 브라우저 한 페이지에서 파싱(WASM) → 조판 → SVG까지 Worker와 같은 경로를 돌린다.
import init, { SheetflyDoc } from '../src/wasm/fmt_docx.js';
import { layoutDocument, pageToSvg, createCanvasMeasurer, parseRtf, adaptSheets, adaptSlides } from '../src/docx/index.js';

let measure = null;
export async function initEngine(wasmBytes) { await init({ module_or_path: wasmBytes }); measure = createCanvasMeasurer(); }

const EDGE = [0, 1, -1, 32767, 65535, 2147483647, 4294967295, 99999999, -2147483648, 1e15, -1e15];
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** IR의 숫자 값 몇 개를 극단값으로 바꾼다(office_oxide가 주지 못할 값이 조판·어댑터에 들어와도 멈추지 않는지 본다). */
function mutateIr(ir, seed) {
  const rand = rng(seed);
  const leaves = [];
  (function walk(o) {
    if (leaves.length > 60000) return;
    if (Array.isArray(o)) { o.forEach((v, i) => { if (typeof v === 'number') leaves.push([o, i]); else walk(v); }); }
    else if (o && typeof o === 'object') { for (const k of Object.keys(o)) { if (typeof o[k] === 'number') leaves.push([o, k]); else if (k !== 'data') walk(o[k]); } }
  })(ir);
  const n = 1 + Math.floor(rand() * 6);
  for (let i = 0; i < n && leaves.length; i++) { const [o, k] = leaves[Math.floor(rand() * leaves.length)]; o[k] = EDGE[Math.floor(rand() * EDGE.length)]; }
  return ir;
}

function parseKind(bytes, kind) {
  if (kind === 'rtf') return { ir: parseRtf(bytes).ir, kind };
  const doc = new SheetflyDoc(bytes, kind);
  try { return { ...JSON.parse(doc.toJson()), kind }; } finally { doc.free(); }
}

export function run(b64, maxPages = 60, kind = 'docx', seed = 0) {
  const bin = atob(b64); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const t = performance.now();
  let status = 'ok', pages = 0, detail = '';
  try {
    const mutant = kind.startsWith('ir-');            // 'ir-xlsx' 등: 정상 파일을 읽은 IR을 바꿔서 조판에 넣는다
    const full = parseKind(bytes, mutant ? kind.slice(3) : kind);
    if (mutant) mutateIr(full.ir, seed);
    let ir = full.ir;
    if (full.kind === 'xlsx' || full.kind === 'xls') ir = adaptSheets(ir);
    else if (full.kind === 'pptx' || full.kind === 'ppt') ir = adaptSlides(ir);
    const res = layoutDocument(ir, measure, { headingRuns: full.heading_runs });
    pages = res.pages.length;
    for (let i = 0; i < Math.min(pages, maxPages); i++) pageToSvg(res.pages[i], measure);
    if (res.truncated) status = 'truncated';
  } catch (e) {
    const msg = String(e && e.message ? e.message : e);
    if (e instanceof WebAssembly.RuntimeError || /unreachable|out of bounds|call stack|memory access/i.test(msg)) { status = 'trap'; detail = msg.slice(0, 160); }
    else if (e instanceof RangeError || e instanceof TypeError || (e && e.stack && /layout|flow|paragraph|svg|rtf|office/.test(e.stack))) { status = 'js_error'; detail = (e.stack || msg).slice(0, 300); }
    else { status = 'rejected'; detail = msg.slice(0, 100); }
  }
  return { status, pages, ms: performance.now() - t, detail };
}
