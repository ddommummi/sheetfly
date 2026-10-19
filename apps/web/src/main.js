import { S } from './strings.js';
import { Viewer, MIN_ZOOM, MAX_ZOOM } from './viewer.js';
import { DocWorker } from './client.js';
import { precheck, kindOf } from './format.js';

const $ = (id) => document.getElementById(id);
const meta = (n) => document.querySelector(`meta[name="${n}"]`)?.getAttribute('content') ?? '';
const cfg = { workerUrl: meta('sheetfly-worker'), wasmUrl: meta('sheetfly-wasm') };
const docxCfg = { workerUrl: meta('sheetfly-docx-worker'), wasmUrl: meta('sheetfly-docx-wasm') }; // DOCX 엔진은 열 때만 불러온다(지연 로딩)

const body = document.body;
const stage = $('stage');
const viewer = new Viewer(stage, $('pages'));
const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 3, 4];

let docWorker = null; // 지금 보여 주는 문서의 Worker
let warm = null;      // 다음 열기를 위해 미리 올려 둔 Worker (첫 열기 지연을 줄인다)
let opening = null;   // { worker, token }
let openToken = 0;
let docName = '';
let docKind = '';
let docMeta = {};
let editor = null;   // 편집기(지연 로딩). 문서 하나에 하나
let loadingTimer = 0;

// ── 공통 UI ──────────────────────────────────────────────────────────
const setState = (s) => { body.dataset.state = s; };
const status = (msg) => { $('status').textContent = msg; };

function showError(code, arg) {
  const f = S.errors[code] ?? S.errors.unknown;
  $('error-text').textContent = typeof f === 'function' ? f(arg) : f;
  $('error-title').textContent = S.errorTitle;
  $('error').hidden = false;
  status(`${S.errorTitle}: ${$('error-text').textContent}`);
}
const hideError = () => { $('error').hidden = true; };

function setLoading(on, name = '') {
  clearTimeout(loadingTimer);
  $('loading').hidden = !on;
  $('loading-slow').hidden = true;
  if (on) {
    $('loading-text').textContent = S.loading(name);
    status(S.loading(name));
    loadingTimer = setTimeout(() => { $('loading-slow').hidden = false; }, 8000);
  }
}

function spawn() { return new DocWorker(cfg); }
let warmedUp = false; // 같은 렌더러 안의 이후 Worker는 이미 최적화된 코드를 공유하므로 첫 Worker만 예열한다
function prewarm() {
  if (warm || !cfg.workerUrl) return;
  try {
    const w = spawn();
    warm = w;
    w.ready.then(() => {
      // 사용자가 파일을 고르는 동안 가상 문서로 엔진을 한 번 돌려 첫 문서의 열기 지연을 줄인다 (측정: docs/phase2/report.md)
      if (!warmedUp && warm === w) { warmedUp = true; w.request('warmup', { loops: 1, parse: true }).catch(() => {}); }
    }).catch(() => { if (warm === w) warm = null; });
  } catch { warm = null; }
}

// ── 열기 ─────────────────────────────────────────────────────────────
async function openFile(file, password) {
  if (editor?.dirty && !(await editor.confirmDiscard())) return;   // 저장하지 않은 편집이 있으면 먼저 묻는다
  cancelOpen(false);
  hideError();
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pre = precheck(file, head);
  if (pre) { showError(pre.code, pre.arg); return; }

  const token = ++openToken;
  const kind = await kindOf(file);
  if (token !== openToken) return;
  const lazy = kind !== 'hwp';   // docx·doc·rtf는 DOCX 엔진 Worker
  const worker = lazy ? new DocWorker(docxCfg) : (warm ?? spawn());
  if (!lazy) warm = null;
  opening = { worker, token };
  setLoading(true, file.name);
  try {
    const buffer = await file.arrayBuffer();
    if (token !== openToken) return;
    await worker.ready;
    const t0 = performance.now();
    const res = await worker.request('open', { buffer, password, kind }, [buffer]);
    const openMs = performance.now() - t0;
    if (token !== openToken) { worker.terminate(); return; }

    const old = docWorker;
    docWorker = worker;
    editor?.dispose(); editor = null; delete body.dataset.dirty; delete body.dataset.editing;
    docKind = kind; docMeta = { ...(res.meta ?? {}), openMs };
    // 편집은 HWP/HWPX만(암호 문서 제외, docs/phase4/design.md 5절)
    const editable = kind === 'hwp' && !docMeta.encrypted;
    $('edit-btn').hidden = !editable; $('edit-btn').setAttribute('aria-pressed', 'false'); $('edit-bar').hidden = true;
    closeSearch();
    $('pages').hidden = false;
    $('empty').hidden = true;
    viewer.load(res.sizes, (page) => worker.request('render', { page }).then((r) => r.svg));
    old?.terminate();
    docName = file.name;
    document.title = `${docName} – ${S.appName}`;
    $('doc-note').hidden = !lazy;
    $('doc-note').textContent = /^xls/.test(kind) ? S.docNotes.sheet : /^ppt/.test(kind) ? S.docNotes.slide : S.docxNote;
    $('file-name').textContent = docName;
    $('file-name').title = docName;
    $('page-total').textContent = S.pageOf(res.pageCount);
    $('page-input').max = String(res.pageCount);
    $('page-input').value = '1';
    setState('ready');
    status(S.opened(docName, res.pageCount));
    stage.focus({ preventScroll: true });
  } catch (err) {
    worker.terminate();
    if (token !== openToken || err.code === 'cancelled') return;
    if (err.code === 'password_required' || err.code === 'wrong_password') {
      askPassword(file, err.code === 'wrong_password');
    } else {
      showError(err.code, undefined);
    }
  } finally {
    if (token === openToken) { opening = null; setLoading(false); }
    prewarm();
  }
}

function cancelOpen(announce = true) {
  if (!opening) return;
  openToken++;
  opening.worker.terminate();
  opening = null;
  setLoading(false);
  if (announce) status(S.cancelled);
  prewarm();
}

// 암호 문서: 같은 파일을 비밀번호와 함께 다시 연다 (파일 객체는 그대로 들고 있다).
let pwFile = null;
function askPassword(file, wrong) {
  pwFile = file;
  $('pw-error').hidden = !wrong;
  $('pw-input').value = '';
  const dlg = $('pw-dialog');
  if (!dlg.open) dlg.showModal();
  $('pw-input').focus();
}

// ── 쪽 이동 / 배율 ───────────────────────────────────────────────────
viewer.addEventListener('pagechange', (e) => {
  const p = e.detail.page + 1;
  if (document.activeElement !== $('page-input')) $('page-input').value = String(p);
  $('prev-page').disabled = p <= 1;
  $('next-page').disabled = p >= viewer.pageCount;
});
viewer.addEventListener('zoomchange', (e) => {
  const sel = $('zoom-select');
  const { zoom, mode } = e.detail;
  let custom = sel.querySelector('option[value="custom"]');
  if (mode === 'custom') {
    if (!custom) { custom = document.createElement('option'); custom.value = 'custom'; sel.append(custom); }
    custom.textContent = `${Math.round(zoom * 100)}%`;
    sel.value = 'custom';
  } else {
    custom?.remove();
    sel.value = mode;
  }
});
viewer.addEventListener('rendererror', (e) => {
  const err = e.detail.error;
  if (err && err.code === 'worker_crashed') {
    docWorker?.terminate(); docWorker = null;
    viewer.clear();
    $('pages').hidden = true; $('empty').hidden = false;
    setState('empty');
    showError('worker_crashed');
  }
});

function stepZoom(dir) {
  const z = viewer.zoom;
  const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.005) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.005);
  viewer.setZoom(next ?? (dir > 0 ? MAX_ZOOM : MIN_ZOOM));
}

$('zoom-in').addEventListener('click', () => stepZoom(1));
$('zoom-out').addEventListener('click', () => stepZoom(-1));
$('fit-width').addEventListener('click', () => viewer.fit('fit-width'));
$('fit-page').addEventListener('click', () => viewer.fit('fit-page'));
$('zoom-select').addEventListener('change', (e) => {
  const v = e.target.value;
  if (v === 'auto' || v === 'fit-width' || v === 'fit-page') viewer.fit(v);
  else if (v !== 'custom') viewer.setZoom(Number(v));
});
$('prev-page').addEventListener('click', () => viewer.goTo(viewer.current - 1));
$('next-page').addEventListener('click', () => viewer.goTo(viewer.current + 1));
$('page-input').addEventListener('change', (e) => {
  const n = parseInt(e.target.value, 10);
  if (Number.isFinite(n)) viewer.goTo(n - 1);
  e.target.value = String(viewer.current + 1);
});
$('page-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

stage.addEventListener('wheel', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !viewer.pageCount) return;
  e.preventDefault();
  stepZoom(e.deltaY < 0 ? 1 : -1);
}, { passive: false });

// ── 검색 ─────────────────────────────────────────────────────────────
let searchSeq = 0;
let matchIndex = -1;
let searchTimer = 0;
let searching = false;
let truncated = false;

function updateSearchUi() {
  const n = viewer.matches.length;
  const out = $('search-count');
  if (!$('search-input').value) { out.textContent = ''; return; }
  if (n === 0) out.textContent = searching ? S.searchRunning(0, viewer.pageCount) : S.searchNone;
  else out.textContent = S.searchCount(matchIndex + 1, n, searching || truncated);
  $('search-prev').disabled = $('search-next').disabled = n === 0;
}

function openSearch() {
  if (!viewer.pageCount) return;
  $('searchbar').hidden = false;
  $('search-input').focus();
  $('search-input').select();
}

function closeSearch() {
  searchSeq++;
  clearTimeout(searchTimer);
  searchTimer = 0;
  docWorker?.post('cancelSearch');
  $('searchbar').hidden = true;
  viewer.clearMatches();
  matchIndex = -1; searching = false; truncated = false;
  $('search-count').textContent = '';
}

async function runSearch() {
  const q = $('search-input').value;
  const seq = ++searchSeq;
  viewer.clearMatches();
  matchIndex = -1; truncated = false;
  if (!q || !docWorker) { searching = false; updateSearchUi(); return; }
  searching = true;
  updateSearchUi();
  try {
    const res = await docWorker.request('search', { query: q, caseSensitive: $('search-case').checked }, [], (m) => {
      if (seq !== searchSeq) return;
      viewer.appendMatches(m.hits);
      if (matchIndex < 0 && viewer.matches.length) { matchIndex = 0; viewer.focusMatch(0); }
      if (m.hits.length === 0) $('search-count').textContent = S.searchRunning(m.scanned, m.total);
      else updateSearchUi();
    });
    if (seq !== searchSeq || res.cancelled) return;
    truncated = !!res.truncated;
  } catch (err) {
    if (seq !== searchSeq) return;
  }
  searching = false;
  updateSearchUi();
}

function gotoMatch(delta) {
  const n = viewer.matches.length;
  if (!n) return;
  matchIndex = (matchIndex + delta + n) % n;
  viewer.focusMatch(matchIndex);
  updateSearchUi();
}

$('search-btn').addEventListener('click', () => ($('searchbar').hidden ? openSearch() : closeSearch()));
$('search-close').addEventListener('click', () => { closeSearch(); stage.focus({ preventScroll: true }); });
$('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { searchTimer = 0; runSearch(); }, 250);
});
$('search-case').addEventListener('change', runSearch);
$('search-next').addEventListener('click', () => gotoMatch(1));
$('search-prev').addEventListener('click', () => gotoMatch(-1));
$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    if (searchTimer) { clearTimeout(searchTimer); searchTimer = 0; runSearch(); return; } // 입력 직후 Enter: 바로 검색
    gotoMatch(e.shiftKey ? -1 : 1);
  } else if (e.key === 'Escape') { closeSearch(); stage.focus({ preventScroll: true }); }
});

// ── 열기 입력: 버튼 / 드래그앤드롭 / 키보드 ──────────────────────────
const fileInput = $('file-input');
for (const id of ['open-btn', 'open-btn-empty', 'open-other']) $(id).addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  fileInput.value = ''; // 같은 파일을 다시 고를 수 있게
  if (f) openFile(f);
});

let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { e.preventDefault(); dragDepth++; body.dataset.drag = '1'; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) delete body.dataset.drag; });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0; delete body.dataset.drag;
  const f = e.dataTransfer.files?.[0];
  if (f) openFile(f);
});

window.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '');
  if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); fileInput.click(); return; }
  if (!viewer.pageCount) return;
  if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); openSearch(); return; }
  if (mod && (e.key === '+' || e.key === '=')) { e.preventDefault(); stepZoom(1); return; }
  if (mod && e.key === '-') { e.preventDefault(); stepZoom(-1); return; }
  if (mod && e.key === '0') { e.preventDefault(); viewer.fit('auto'); return; }
  if (typing || mod || e.altKey) return;
  if (e.key === 'Home') { e.preventDefault(); viewer.goTo(0); }
  else if (e.key === 'End') { e.preventDefault(); viewer.goTo(viewer.pageCount - 1); }
  else if (e.key === 'PageDown') { e.preventDefault(); viewer.goTo(viewer.current + 1); }
  else if (e.key === 'PageUp') { e.preventDefault(); viewer.goTo(viewer.current - 1); }
});


// ── 편집 (지연 로딩) ─────────────────────────────────────────────────
async function toggleEdit() {
  if (!docWorker || docKind !== 'hwp') return;
  const btn = $('edit-btn');
  if (editor?.active) { editor.stop(); btn.setAttribute('aria-pressed', 'false'); stage.focus({ preventScroll: true }); return; }
  btn.disabled = true;
  try {
    if (!editor) {
      await docWorker.request('editInit', { url: meta('sheetfly-hwp-edit') });
      const mod = await import(/* 편집기는 눌렀을 때만 받는다 */ meta('sheetfly-editor'));
      editor = mod.createEditor({
        viewer, stage, worker: docWorker, bar: $('edit-bar'), fileName: docName, meta: docMeta, status,
        onDirty: (d) => { if (d) body.dataset.dirty = '1'; else delete body.dataset.dirty; },
      });
      // 열기만 수 초 이상 걸린 문서는 글자마다 전체를 다시 조판하는 편집이 매우 느리다: 알리고 확인받는다
      if (!(await editor.confirmSlow(docMeta.openMs))) { editor.dispose(); editor = null; return; }
    }
    editor.start();
    btn.setAttribute('aria-pressed', 'true');
  } catch (e) {
    console.warn('edit', e);
    status(S.editFailed);
  } finally { btn.disabled = false; }
}
$('edit-btn').addEventListener('click', toggleEdit);
viewer.addEventListener('pagecount', (e) => { $('page-total').textContent = S.pageOf(e.detail.count); $('page-input').max = String(e.detail.count); });
window.addEventListener('beforeunload', (e) => { if (editor?.dirty) { e.preventDefault(); e.returnValue = ''; } });

$('loading-cancel').addEventListener('click', () => cancelOpen());
$('error-close').addEventListener('click', hideError);

$('pw-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const pw = $('pw-input').value;
  $('pw-dialog').close();
  if (pwFile && pw) openFile(pwFile, pw);
});
$('pw-cancel').addEventListener('click', () => { $('pw-dialog').close(); pwFile = null; });

// ── 테마 ─────────────────────────────────────────────────────────────
const THEMES = ['auto', 'light', 'dark'];
let theme = 'auto';
try { theme = THEMES.includes(localStorage.getItem('sheetfly.theme')) ? localStorage.getItem('sheetfly.theme') : 'auto'; } catch { /* 저장소를 못 쓰는 환경 */ }
function applyTheme() {
  document.documentElement.dataset.theme = theme;
  $('theme-btn').textContent = S.theme[theme];
  $('theme-btn').setAttribute('aria-label', S.theme[theme]);
}
$('theme-btn').addEventListener('click', () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
  try { localStorage.setItem('sheetfly.theme', theme); } catch { /* ignore */ }
  applyTheme();
});

// ── 정적 문구 ────────────────────────────────────────────────────────
for (const el of document.querySelectorAll('[data-s]')) {
  const v = S[el.dataset.s];
  if (typeof v === 'string') el.textContent = v;
}
for (const el of document.querySelectorAll('[data-s-title]')) {
  const v = S[el.dataset.sTitle];
  if (typeof v === 'string') { el.title = v; el.setAttribute('aria-label', v); }
}
$('search-input').placeholder = S.searchPlaceholder;
applyTheme();
setState('empty');
prewarm();
